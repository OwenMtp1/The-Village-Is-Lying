/**
 * Un salon et sa partie, côté serveur (source de vérité). Indépendant du transport : les messages sortent
 * par l'interface `RoomOutput`, ce qui permet de tester toute la logique sans réseau.
 *
 * Salon : composition des rôles validée à la création et à chaque modification (hôte seulement), places =
 * somme des rôles, départ possible uniquement avec une composition valide et exactement le bon nombre de
 * joueurs connectés. Départ de l'hôte : le plus ancien joueur restant le remplace.
 *
 * Partie : rôles tirés au hasard dans les quantités exactes, secret envoyé à chacun ; éliminations (délai
 * propre à chaque tueur), tir unique de chaque shérif, enquête unique de chaque détective, réunions et votes
 * des seuls vivants, victoire recalculée après chaque mort. La composition est verrouillée pendant la partie.
 */
import { randomBytes, randomInt } from 'node:crypto';
import { assignAppearances } from '../characters/appearance';
import type { Sex } from '../characters/catalog';
import { compositionErrors, campOf, startBlocker, totalOf, type Composition, type Role } from '../shared/roles';
import { RULES, assignRoles, winnerOf, type Winner } from '../shared/rules';
import type { EventKind, GameView, Gesture, HeldItem, LobbyView, PlayerPose, PrivateInfo } from '../shared/protocol';

export interface RoomOutput {
  lobby(view: LobbyView): void;
  game(view: GameView): void;
  secret(playerId: string, info: PrivateInfo): void;
  event(text: string, kind: EventKind, to?: string): void;
  /** geste (coup de couteau, tir) montré aux seuls joueurs qui peuvent le voir */
  gesture(g: Gesture, to: string[]): void;
}

interface Member {
  id: string;
  name: string;
  sex: Sex;
  token: string;
  connected: boolean;
  joinedAt: number;
  /** « prêt » affiché au salon (indication pour l'hôte, ne bloque pas le lancement) */
  ready: boolean;
}

interface Secret {
  role: Role;
  ammo: number;
  investigations: number;
  killReadyAt: number;
  emergencyLeft: number;
  findings: Record<string, boolean>;
}

export class RoomError extends Error {}

const cryptoRandom = () => randomInt(0, 2 ** 31) / 2 ** 31;

/** Point de visée : la poitrine d'un personnage (m au-dessus des pieds). */
const CHEST = 1.3;
export type SightTest = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => boolean;
const SPAWN_RADIUS = 6.5;

export class Room {
  readonly players = new Map<string, Member>();
  hostId = '';
  composition: Composition;
  phase: LobbyView['phase'] = 'salon';
  private seq = 0;
  // ── état de la partie ──
  private secrets = new Map<string, Secret>();
  private alive = new Map<string, boolean>();
  private poses = new Map<string, PlayerPose & { t: number }>();
  private appearances: Record<string, string> = {};
  private bodies: GameView['bodies'] = [];
  private meeting: (GameView['meeting'] & { votes: Map<string, string | null> }) | null = null;
  private log: string[] = [];
  private result: GameView['result'] = null;
  private gamePhase: GameView['phase'] = 'jeu';
  private startedAt = 0;

  constructor(
    readonly code: string,
    composition: Composition,
    private out: RoomOutput,
    private now: () => number = Date.now,
    private random: () => number = cryptoRandom,
    /** ligne de vue (murs, planchers, relief) : le serveur de jeu fournit celle du village */
    private sight: SightTest = () => true,
  ) {
    const errs = compositionErrors(composition);
    if (errs.length) throw new RoomError(errs[0]);
    this.composition = { ...composition };
  }

  get seats() {
    return totalOf(this.composition);
  }
  get connectedCount() {
    return [...this.players.values()].filter((p) => p.connected).length;
  }

  // ───────────────────────── salon ─────────────────────────

  /** Entrée d'un joueur (ou reconnexion avec son jeton). */
  join(name: string, sex: Sex, token?: string): Member {
    if (token) {
      const back = [...this.players.values()].find((p) => p.token === token);
      if (back) {
        back.connected = true;
        this.publish();
        if (this.phase !== 'salon') this.sendSecret(back.id);
        return back;
      }
    }
    if (this.phase !== 'salon') throw new RoomError('La partie a déjà commencé : impossible de rejoindre ce salon.');
    const n = this.players.size;
    if (n >= this.seats) throw new RoomError(`Salon complet (${n} / ${this.seats} joueurs).`);
    const clean = String(name ?? '').trim().slice(0, 20) || `Joueur ${n + 1}`;
    const m: Member = { id: randomBytes(4).toString('hex'), name: clean, sex: sex === 'F' ? 'F' : 'M', token: randomBytes(16).toString('hex'), connected: true, joinedAt: this.seq++, ready: false };
    this.players.set(m.id, m);
    if (!this.hostId) this.hostId = m.id;
    this.publish();
    return m;
  }

  /** Départ ou déconnexion. Au salon, le joueur libère sa place ; en partie, il garde sa place (reconnexion). */
  leave(id: string, permanent: boolean) {
    const m = this.players.get(id);
    if (!m) return;
    if (this.phase === 'salon' && permanent) this.players.delete(id);
    else m.connected = false;
    if (id === this.hostId) {
      // l'hôte part : le joueur connecté le plus ancien prend la main ; sinon plus personne ne peut lancer
      const next = [...this.players.values()].filter((p) => p.connected && p.id !== id).sort((a, b) => a.joinedAt - b.joinedAt)[0];
      this.hostId = next?.id ?? (this.players.has(id) ? id : '');
      if (next) this.out.event(`${next.name} devient l'hôte du salon.`, 'info');
    }
    if (this.phase === 'partie' && this.gamePhase === 'reunion') this.maybeCloseVote();
    this.publish();
  }

  get empty() {
    return this.connectedCount === 0;
  }

  setSex(id: string, sex: Sex) {
    if (this.phase === 'partie') throw new RoomError('La partie a commencé : l’apparence est fixée.');
    const m = this.must(id);
    m.sex = sex === 'F' ? 'F' : 'M';
    this.publish();
  }

  setReady(id: string, ready: boolean) {
    if (this.phase !== 'salon') throw new RoomError('La partie a commencé.');
    this.must(id).ready = ready === true;
    this.publish();
  }

  /** Modification de la composition par l'hôte, avant le lancement. */
  setComposition(id: string, comp: Composition) {
    if (id !== this.hostId) throw new RoomError('Seul l’hôte peut modifier la composition.');
    if (this.phase === 'partie') throw new RoomError('La partie a commencé : la composition est verrouillée.');
    const errs = compositionErrors(comp);
    if (errs.length) throw new RoomError(errs[0]);
    const seats = totalOf(comp);
    if (seats < this.players.size) throw new RoomError(`${this.players.size} joueurs sont déjà dans le salon : la composition doit prévoir au moins ${this.players.size} places.`);
    this.composition = { tueur: comp.tueur, sherif: comp.sherif, detective: comp.detective, villageois: comp.villageois };
    this.publish();
  }

  lobbyView(): LobbyView {
    return {
      code: this.code,
      composition: { ...this.composition },
      seats: this.seats,
      players: [...this.players.values()].sort((a, b) => a.joinedAt - b.joinedAt).map((p) => ({ id: p.id, name: p.name, sex: p.sex, connected: p.connected, host: p.id === this.hostId, ready: p.ready })),
      blocker: this.phase === 'partie' ? 'Partie en cours.' : !this.hostId ? 'Aucun hôte : le salon ne peut pas être lancé.' : startBlocker(this.composition, this.connectedCount),
      phase: this.phase,
    };
  }

  // ───────────────────────── lancement ─────────────────────────

  start(id: string) {
    if (id !== this.hostId) throw new RoomError('Seul l’hôte peut lancer la partie.');
    if (this.phase === 'partie') throw new RoomError('La partie a déjà commencé.');
    const blocker = startBlocker(this.composition, this.connectedCount);
    if (blocker) throw new RoomError(blocker);
    if (this.players.size !== this.connectedCount) throw new RoomError('Un joueur est déconnecté.');
    const ids = [...this.players.keys()];
    const roles = assignRoles(ids, this.composition, this.random);
    const t = this.now();
    this.resetGame();
    for (const pid of ids)
      this.secrets.set(pid, {
        role: roles[pid],
        ammo: roles[pid] === 'sherif' ? RULES.sheriffAmmo : 0,
        investigations: roles[pid] === 'detective' ? RULES.detectiveUses : 0,
        killReadyAt: roles[pid] === 'tueur' ? t + RULES.firstKillDelay * 1000 : 0,
        emergencyLeft: RULES.emergencyMeetings,
        findings: {},
      });
    this.appearances = assignAppearances(
      ids.map((pid) => ({ playerId: pid, sex: this.players.get(pid)!.sex })),
      Math.floor(this.random() * 2 ** 31),
    );
    for (const pid of ids) this.alive.set(pid, true);
    // apparition en cercle autour du puits de la place
    shuffleInPlace(ids, this.random).forEach((pid, i) => {
      const a = (i / ids.length) * Math.PI * 2;
      const x = -2 + Math.cos(a) * SPAWN_RADIUS;
      const z = 0.5 + Math.sin(a) * SPAWN_RADIUS;
      this.poses.set(pid, { x, y: 0, z, yaw: Math.atan2(-2 - x, 0.5 - z), speed: 0, grounded: true, vy: 0, dir: 1, torch: false, pitch: 0, t: t });
    });
    this.phase = 'partie';
    this.startedAt = t;
    this.publish();
    for (const pid of ids) this.sendSecret(pid);
    this.out.event('La nuit tombe sur le village. Les rôles ont été distribués.', 'info');
  }

  // ───────────────────────── partie ─────────────────────────

  private must(id: string) {
    const m = this.players.get(id);
    if (!m) throw new RoomError('Joueur inconnu.');
    return m;
  }
  private inGame(id: string) {
    if (this.phase !== 'partie') throw new RoomError('Aucune partie en cours.');
    const s = this.secrets.get(id);
    if (!s) throw new RoomError('Joueur inconnu.');
    return s;
  }
  private requireAlive(id: string) {
    if (!this.alive.get(id)) throw new RoomError('Vous êtes éliminé.');
  }
  private requirePlaying() {
    if (this.gamePhase !== 'jeu') throw new RoomError(this.gamePhase === 'reunion' ? 'Une réunion est en cours.' : 'La partie est terminée.');
  }
  private dist(a: string, b: string) {
    const p = this.poses.get(a);
    const q = this.poses.get(b);
    if (!p || !q) return Infinity;
    return Math.hypot(p.x - q.x, p.z - q.z, (p.y - q.y) * 1.5);
  }
  /** Écart (rad) entre le regard horizontal de `a` et la direction de `b` (0 si l'un est sur l'autre). */
  private facing(a: string, b: string) {
    const p = this.poses.get(a);
    const q = this.poses.get(b);
    if (!p || !q) return Math.PI;
    const dx = q.x - p.x;
    const dz = q.z - p.z;
    if (Math.hypot(dx, dz) < 0.3) return 0;
    const d = Math.atan2(dx, dz) - p.yaw;
    return Math.abs(Math.atan2(Math.sin(d), Math.cos(d)));
  }
  private holding(id: string, item: HeldItem) {
    return this.poses.get(id)?.item === item;
  }
  /** Montre un geste aux joueurs à portée de vue (les autres n'apprennent rien de la position). */
  private showGesture(g: Gesture, range: number) {
    const p = this.poses.get(g.id);
    if (!p) return;
    const to = [...this.players.keys()].filter((pid) => {
      const q = this.poses.get(pid);
      return pid === g.id || (q && Math.hypot(q.x - p.x, q.z - p.z) <= range);
    });
    this.out.gesture(g, to);
  }

  /** Les deux joueurs se voient-ils (poitrine à poitrine) ? */
  private seen(a: string, b: string) {
    const p = this.poses.get(a);
    const q = this.poses.get(b);
    if (!p || !q) return false;
    return this.sight({ x: p.x, y: p.y + CHEST, z: p.z }, { x: q.x, y: q.y + CHEST, z: q.z });
  }
  private name(id: string) {
    return this.players.get(id)?.name ?? '?';
  }

  /** Position envoyée par un joueur vivant ; un déplacement impossible (téléportation) est ignoré. */
  pose(id: string, p: PlayerPose) {
    if (this.phase !== 'partie' || !this.alive.get(id) || this.gamePhase !== 'jeu') return;
    if (![p.x, p.y, p.z, p.yaw, p.speed, p.vy, p.pitch ?? 0].every(Number.isFinite)) return;
    const prev = this.poses.get(id);
    const t = this.now();
    if (prev) {
      const dt = Math.max(0.05, (t - prev.t) / 1000);
      if (Math.hypot(p.x - prev.x, p.z - prev.z) / dt > RULES.maxSpeed && prev.t > 0) return;
    }
    // une arme n'est acceptée que pour le rôle qui la possède (un joueur ne peut pas en exhiber une fausse)
    const role = this.secrets.get(id)?.role;
    const item: HeldItem = p.item === 'couteau' && role === 'tueur' ? 'couteau' : p.item === 'pistolet' && role === 'sherif' ? 'pistolet' : null;
    this.poses.set(id, { x: p.x, y: p.y, z: p.z, yaw: p.yaw, speed: Math.min(p.speed, 6), grounded: !!p.grounded, vy: p.vy, dir: p.dir === -1 ? -1 : 1, torch: p.torch === true && !item, pitch: Math.max(-1.5, Math.min(1.5, p.pitch ?? 0)), item, t });
  }

  posesView(): Record<string, PlayerPose> {
    const out: Record<string, PlayerPose> = {};
    for (const [id, p] of this.poses) if (this.alive.get(id)) out[id] = { x: p.x, y: p.y, z: p.z, yaw: p.yaw, speed: p.speed, grounded: p.grounded, vy: p.vy, dir: p.dir, torch: p.torch, pitch: p.pitch, item: p.item ?? null };
    return out;
  }

  eliminate(id: string, target: string) {
    const s = this.inGame(id);
    this.requirePlaying();
    this.requireAlive(id);
    if (s.role !== 'tueur') throw new RoomError('Seuls les tueurs peuvent éliminer.');
    if (target === id || !this.alive.get(target)) throw new RoomError('Cible invalide.');
    if (this.secrets.get(target)?.role === 'tueur') throw new RoomError('C’est un autre tueur.');
    if (this.now() < s.killReadyAt) throw new RoomError(`Patience : encore ${Math.ceil((s.killReadyAt - this.now()) / 1000)} s.`);
    if (!this.holding(id, 'couteau')) throw new RoomError('Sortez votre couteau (touche 2).');
    if (this.dist(id, target) > RULES.killRange) throw new RoomError('Trop loin.');
    if (!this.seen(id, target)) throw new RoomError('Un obstacle vous sépare de votre cible.');
    if (this.facing(id, target) > RULES.stabAngle) throw new RoomError('Faites face à votre cible.');
    s.killReadyAt = this.now() + RULES.killCooldown * 1000;
    this.showGesture({ id, kind: 'couteau' }, RULES.stabSeenRange);
    this.kill(target);
    this.sendSecret(id);
    this.afterDeath();
  }

  /**
   * Tir du shérif, pistolet en main : la balle part toujours (munition consommée, détonation entendue de tout le
   * village). Elle touche la cible désignée seulement si celle-ci est vivante, à portée, dans l'axe du regard et
   * sans obstacle ; sinon c'est un tir manqué. Abattre un innocent coûte la vie au shérif.
   */
  shoot(id: string, target: string | null): { hit: boolean } {
    const s = this.inGame(id);
    this.requirePlaying();
    this.requireAlive(id);
    if (s.role !== 'sherif') throw new RoomError('Seuls les shérifs ont une arme.');
    if (!this.holding(id, 'pistolet')) throw new RoomError('Sortez votre pistolet (touche 2).');
    if (s.ammo <= 0) throw new RoomError('Vous n’avez plus de balle.');
    s.ammo--;
    this.showGesture({ id, kind: 'tir' }, RULES.shotSeenRange);
    const hit =
      target !== null && target !== id && !!this.alive.get(target) && this.dist(id, target) <= RULES.shootRange && this.facing(id, target) <= RULES.aimAngle && this.seen(id, target);
    if (!hit) {
      this.log.push('Un coup de feu a retenti, sans victime.');
      this.out.event('Un coup de feu retentit dans le village.', 'tir');
      this.sendSecret(id);
      this.publishGame();
      return { hit: false };
    }
    const innocent = campOf(this.secrets.get(target!)!.role) === 'innocents';
    this.kill(target!);
    this.log.push(`Un coup de feu : ${this.name(target!)} est mort.`);
    this.out.event(`Un coup de feu retentit dans le village : ${this.name(target!)} est mort.`, 'tir');
    if (innocent && RULES.sheriffDiesOnMistake) {
      this.kill(id);
      this.log.push(`${this.name(id)} a abattu un innocent et l’a payé de sa vie.`);
      this.out.event(`${this.name(id)} a abattu un innocent et l’a payé de sa vie.`, 'mort');
    }
    this.sendSecret(id);
    this.afterDeath();
    return { hit: true };
  }

  investigate(id: string, target: string): boolean {
    const s = this.inGame(id);
    this.requirePlaying();
    this.requireAlive(id);
    if (s.role !== 'detective') throw new RoomError('Seuls les détectives enquêtent.');
    if (s.investigations <= 0) throw new RoomError('Vous avez déjà mené votre enquête.');
    if (target === id || !this.alive.get(target)) throw new RoomError('Cible invalide.');
    if (this.dist(id, target) > RULES.investigateRange) throw new RoomError('Approchez-vous pour enquêter.');
    if (!this.seen(id, target)) throw new RoomError('Un obstacle vous sépare de cette personne.');
    s.investigations--;
    const killer = this.secrets.get(target)!.role === 'tueur';
    s.findings[target] = killer;
    this.sendSecret(id);
    return killer;
  }

  report(id: string, body: string) {
    this.inGame(id);
    this.requirePlaying();
    this.requireAlive(id);
    const b = this.bodies.find((x) => x.id === body && !x.reported);
    if (!b) throw new RoomError('Aucun corps à signaler ici.');
    const p = this.poses.get(id);
    if (!p || Math.hypot(p.x - b.x, p.z - b.z) > RULES.reportRange) throw new RoomError('Trop loin du corps.');
    this.openMeeting(id, 'corps', body);
  }

  emergency(id: string) {
    const s = this.inGame(id);
    this.requirePlaying();
    this.requireAlive(id);
    if (s.emergencyLeft <= 0) throw new RoomError('Vous avez déjà convoqué une réunion.');
    s.emergencyLeft--;
    this.sendSecret(id);
    this.openMeeting(id, 'urgence');
  }

  vote(id: string, target: string | null) {
    this.inGame(id);
    if (this.gamePhase !== 'reunion' || !this.meeting) throw new RoomError('Aucun vote en cours.');
    this.requireAlive(id);
    if (target !== null && !this.alive.get(target)) throw new RoomError('On ne vote que pour un joueur vivant.');
    if (this.meeting.votes.has(id)) throw new RoomError('Vous avez déjà voté.');
    this.meeting.votes.set(id, target);
    this.meeting.voted = [...this.meeting.votes.keys()];
    this.maybeCloseVote();
    this.publishGame();
  }

  /** Horloge (fin des votes à échéance). */
  tick() {
    if (this.phase === 'partie' && this.gamePhase === 'reunion' && this.meeting && this.now() >= this.meeting.endsAt) this.closeVote();
  }

  private openMeeting(by: string, reason: 'urgence' | 'corps', body?: string) {
    this.gamePhase = 'reunion';
    this.meeting = { by, reason, body, endsAt: this.now() + RULES.meetingSeconds * 1000, voted: [], votes: new Map() };
    for (const b of this.bodies) b.reported = true;
    const text = reason === 'corps' ? `${this.name(by)} a découvert le corps de ${this.name(body!)}. Réunion !` : `${this.name(by)} convoque une réunion d’urgence.`;
    this.log.push(text);
    this.out.event(text, 'reunion');
    this.publishGame();
  }

  private maybeCloseVote() {
    if (!this.meeting) return;
    // les joueurs déconnectés ne bloquent pas le vote
    const voters = [...this.alive].filter(([pid, a]) => a && this.players.get(pid)?.connected).map(([pid]) => pid);
    if (voters.every((v) => this.meeting!.votes.has(v))) this.closeVote();
  }

  private closeVote() {
    const m = this.meeting;
    if (!m) return;
    const tally = new Map<string, number>();
    let skip = 0;
    for (const [voter, t] of m.votes) {
      if (!this.alive.get(voter)) continue;
      if (t === null) skip++;
      else tally.set(t, (tally.get(t) ?? 0) + 1);
    }
    const sorted = [...tally].sort((a, b) => b[1] - a[1]);
    const top = sorted[0];
    const tie = sorted.length > 1 && sorted[1][1] === top?.[1];
    const votes = (n: number) => `${n} voix`;
    // décompte public : chacun voit pourquoi quelqu'un est (ou n'est pas) éliminé
    const detail = [...sorted.map(([id, n]) => `${this.name(id)} ${votes(n)}`), ...(skip ? [`personne ${votes(skip)}`] : [])].join(', ');
    const absent = [...this.alive].filter(([pid, a]) => a && !m.votes.has(pid)).length;
    const missing = absent ? ` ; ${absent} sans vote` : '';
    let text: string;
    if (!top) text = `Le village n’a désigné personne : aucun vote contre un joueur (${skip ? `${votes(skip)} pour « personne »` : 'aucun vote'}${missing}).`;
    else if (tie) text = `Égalité, personne n’est éliminé (${detail}${missing}).`;
    else if (top[1] <= skip) text = `Le village a choisi de ne désigner personne (${detail}${missing}).`;
    else {
      this.kill(top[0], false);
      text = `Le village a voté : ${this.name(top[0])} est éliminé (${detail}${missing}).`;
    }
    this.meeting = null;
    this.gamePhase = 'jeu';
    this.log.push(text);
    this.out.event(text, 'reunion');
    // après une réunion, les tueurs repartent avec un délai (pas de meurtre à la sortie de la réunion)
    const t = this.now();
    for (const s of this.secrets.values()) if (s.role === 'tueur') s.killReadyAt = Math.max(s.killReadyAt, t + (RULES.killCooldown * 1000) / 2);
    for (const pid of this.secrets.keys()) this.sendSecret(pid);
    this.afterDeath();
  }

  private kill(id: string, body = true) {
    if (!this.alive.get(id)) return;
    this.alive.set(id, false);
    const p = this.poses.get(id);
    if (body && p) this.bodies.push({ id, x: p.x, y: p.y, z: p.z, yaw: p.yaw, reported: false });
    this.out.event('Vous avez été éliminé. Vous pouvez suivre la partie, sans voter ni agir.', 'mort', id);
  }

  /** Après chaque mort : victoire recalculée sur les joueurs réellement vivants. */
  private afterDeath() {
    const alive = [...this.alive].filter(([, a]) => a).map(([pid]) => this.secrets.get(pid)!.role);
    const w = winnerOf(alive);
    if (w) this.finish(w);
    else this.publishGame();
  }

  private finish(w: Winner) {
    this.gamePhase = 'fin';
    this.phase = 'fin';
    const roles: Record<string, Role> = {};
    for (const [pid, s] of this.secrets) roles[pid] = s.role;
    const alive = [...this.alive].filter(([, a]) => a).map(([pid]) => pid);
    const nTueurs = alive.filter((pid) => roles[pid] === 'tueur').length;
    const reason =
      w === 'tueurs'
        ? `Il reste ${nTueurs} tueur${nTueurs > 1 ? 's' : ''} pour ${alive.length - nTueurs} innocent${alive.length - nTueurs > 1 ? 's' : ''} : les innocents ne peuvent plus l’emporter au vote.`
        : 'Tous les tueurs ont été éliminés.';
    this.result = { winner: w, roles, reason, survivors: alive };
    const text = w === 'tueurs' ? `Les tueurs ont gagné. ${reason}` : `Les innocents ont gagné. ${reason}`;
    this.log.push(text);
    this.out.event(text, 'fin');
    this.publish();
  }

  /**
   * Fin de partie → retour au salon (n'importe quel joueur, après avoir lu les résultats) : l'état de la
   * partie est entièrement effacé, les joueurs partis libèrent leur place, l'hôte peut relancer.
   */
  backToLobby(id: string) {
    this.must(id);
    if (this.phase === 'salon') return;
    if (this.phase !== 'fin') throw new RoomError('La partie est en cours.');
    for (const [pid, m] of this.players) if (!m.connected) this.players.delete(pid);
    if (!this.players.has(this.hostId)) {
      const next = [...this.players.values()].sort((a, b) => a.joinedAt - b.joinedAt)[0];
      this.hostId = next?.id ?? '';
    }
    this.resetGame();
    for (const m of this.players.values()) m.ready = false;
    this.phase = 'salon';
    this.publish();
  }

  private resetGame() {
    this.secrets.clear();
    this.alive.clear();
    this.poses.clear();
    this.appearances = {};
    this.bodies = [];
    this.meeting = null;
    this.log = [];
    this.result = null;
    this.gamePhase = 'jeu';
    this.startedAt = 0;
  }

  gameView(): GameView {
    const alive: Record<string, boolean> = {};
    for (const [pid, a] of this.alive) alive[pid] = a;
    return {
      phase: this.gamePhase,
      appearances: { ...this.appearances },
      alive,
      bodies: this.bodies.map((b) => ({ ...b })),
      meeting: this.meeting ? { by: this.meeting.by, reason: this.meeting.reason, body: this.meeting.body, endsAt: this.meeting.endsAt, voted: [...this.meeting.voted] } : null,
      log: this.log.slice(-12),
      result: this.result,
      startedAt: this.startedAt,
      serverNow: this.now(),
    };
  }

  /** Secret d'un joueur (lui seul le reçoit). */
  privateInfo(id: string): PrivateInfo | null {
    const s = this.secrets.get(id);
    if (!s) return null;
    return {
      role: s.role,
      allies: s.role === 'tueur' ? [...this.secrets].filter(([pid, o]) => pid !== id && o.role === 'tueur').map(([pid]) => pid) : [],
      ammo: s.ammo,
      investigations: s.investigations,
      killReadyAt: s.killReadyAt,
      emergencyLeft: s.emergencyLeft,
      findings: { ...s.findings },
    };
  }

  private sendSecret(id: string) {
    const info = this.privateInfo(id);
    if (info) this.out.secret(id, info);
  }

  private publishGame() {
    if (this.phase !== 'salon') this.out.game(this.gameView());
  }

  private publish() {
    this.out.lobby(this.lobbyView());
    this.publishGame();
  }

  /** Rôle d'un joueur (tests et journal serveur uniquement : jamais envoyé aux autres). */
  roleOf(id: string) {
    return this.secrets.get(id)?.role;
  }
  isAlive(id: string) {
    return !!this.alive.get(id);
  }
}

function shuffleInPlace<T>(a: T[], random: () => number): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

