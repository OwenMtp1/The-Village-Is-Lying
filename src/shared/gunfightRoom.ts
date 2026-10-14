/**
 * Salle Gunfight (source de vérité) : salon (réglages de l'hôte, équipes choisies par les joueurs), partie
 * (vie, munitions, cadence, rechargement, dégâts, réapparition loin des adversaires, score, temps), fin et retour
 * au salon. Logique pure, sans réseau ni Node : le serveur l'utilise pour les parties en ligne et le navigateur
 * pour le mode solo contre des robots. Chaque tir est recalculé ici : le navigateur n'envoie que le rayon de
 * visée (origine, direction de chaque balle) ; la salle vérifie l'arme, la cadence, les munitions, l'origine et
 * la direction du rayon, cherche le premier corps traversé (tête ou corps, positions récentes comprises pour
 * compenser la latence), la portée, la ligne de vue et l'équipe.
 */
import { assignAppearances } from '../characters/appearance';
import { VARIANTS, type Sex } from '../characters/catalog';
import type { PlayerPose } from './protocol';
import { insideMap, mapOf } from './gunfightMaps';
import { GF_RULES, GUNS, WEAPONS, damageAt, cleanSettings, isGun, normalize, rayHitBody, type GFGun, type GFShotResult, type GFWeapon, type Vec3, type GFEvent, type GFGameView, type GFKill, type GFLobbyView, type GFPlayerState, type GFSettings, type GFShot, type Team } from './gunfight';

export interface GFOutput {
  lobby(v: GFLobbyView): void;
  game(v: GFGameView): void;
  shot(s: GFShot): void;
  event(e: GFEvent): void;
}

export class GFError extends Error {}

interface Member {
  id: string;
  name: string;
  sex: Sex;
  token: string;
  connected: boolean;
  joinedAt: number;
  team: Team | null;
  bot: boolean;
}

type Sight = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => boolean;
const CHEST = 1.3;
const EYE = 1.5;
const fullAmmo = () => Object.fromEntries(GUNS.map((g) => [g, WEAPONS[g].magazine])) as Record<GFGun, number>;
const HEIGHTS = new Map(VARIANTS.map((v) => [v.id, v.heightM]));
type Past = { x: number; y: number; z: number; t: number };
const hex = (n: number, random: () => number) => Array.from({ length: n }, () => Math.floor(random() * 16).toString(16)).join('');

export class GunfightRoom {
  readonly players = new Map<string, Member>();
  hostId = '';
  settings: GFSettings;
  phase: GFLobbyView['phase'] = 'salon';
  private seq = 0;
  private state = new Map<string, GFPlayerState & { nextShotAt: number; nextStabAt: number }>();
  private poses = new Map<string, PlayerPose & { t: number }>();
  /** positions récentes (compensation de la latence des tirs) */
  private history = new Map<string, Past[]>();
  private appearances: Record<string, string> = {};
  private feed: GFKill[] = [];
  private result: GFGameView['result'] = null;
  private gamePhase: GFGameView['phase'] = 'jeu';
  private startedAt = 0;
  private endsAt = 0;
  private teamScores: Record<Team, number> = { rouge: 0, bleu: 0 };

  constructor(
    readonly code: string,
    settings: Partial<GFSettings> | undefined,
    private out: GFOutput,
    private now: () => number = Date.now,
    private random: () => number = Math.random,
    private sight: Sight = () => true,
  ) {
    this.settings = cleanSettings(settings);
  }

  // ───────────────────────── salon ─────────────────────────

  join(name: string, sex: Sex, token?: string, bot = false): Member {
    if (token) {
      const back = [...this.players.values()].find((p) => p.token === token);
      if (back) {
        back.connected = true;
        this.publish();
        return back;
      }
    }
    if (this.phase !== 'salon') throw new GFError('La partie a déjà commencé : impossible de rejoindre cette salle.');
    if (this.players.size >= this.settings.maxPlayers) throw new GFError(`Salle complète (${this.players.size} / ${this.settings.maxPlayers}).`);
    const clean = String(name ?? '').trim().slice(0, 20) || `Joueur ${this.players.size + 1}`;
    const m: Member = { id: hex(8, this.random), name: clean, sex: sex === 'F' ? 'F' : 'M', token: hex(32, this.random), connected: true, joinedAt: this.seq++, team: null, bot };
    // en équipes, le nouveau venu rejoint l'équipe la moins nombreuse (il peut en changer)
    if (this.settings.mode === 'equipes') m.team = this.smallerTeam();
    this.players.set(m.id, m);
    if (!this.hostId && !bot) this.hostId = m.id;
    this.publish();
    return m;
  }

  private smallerTeam(): Team {
    const n = (t: Team) => [...this.players.values()].filter((p) => p.team === t).length;
    return n('rouge') <= n('bleu') ? 'rouge' : 'bleu';
  }

  leave(id: string, permanent: boolean) {
    const m = this.players.get(id);
    if (!m) return;
    if (this.phase === 'salon' && permanent) this.players.delete(id);
    else m.connected = false;
    if (id === this.hostId) {
      const next = [...this.players.values()].filter((p) => p.connected && !p.bot && p.id !== id).sort((a, b) => a.joinedAt - b.joinedAt)[0];
      this.hostId = next?.id ?? (this.players.has(id) ? id : '');
      if (next) this.out.event({ text: `${next.name} devient l'hôte.`, kind: 'info' });
    }
    this.publish();
  }

  get empty() {
    return ![...this.players.values()].some((p) => p.connected && !p.bot);
  }

  setTeam(id: string, team: Team) {
    if (this.phase === 'partie') throw new GFError('La partie a commencé : les équipes sont fixées.');
    if (this.settings.mode !== 'equipes') throw new GFError('Pas d’équipes en « chacun pour soi ».');
    const m = this.must(id);
    m.team = team === 'bleu' ? 'bleu' : 'rouge';
    this.publish();
  }

  setSettings(id: string, s: Partial<GFSettings>) {
    if (id !== this.hostId) throw new GFError('Seul l’hôte règle la partie.');
    if (this.phase === 'partie') throw new GFError('La partie a commencé.');
    const next = cleanSettings({ ...this.settings, ...s });
    if (next.maxPlayers < this.players.size) throw new GFError(`${this.players.size} joueurs sont déjà là : prévoyez au moins ${this.players.size} places.`);
    const modeChanged = next.mode !== this.settings.mode;
    this.settings = next;
    if (modeChanged) for (const p of [...this.players.values()].sort((a, b) => a.joinedAt - b.joinedAt)) p.team = next.mode === 'equipes' ? null : null;
    if (modeChanged && next.mode === 'equipes') for (const p of [...this.players.values()].sort((a, b) => a.joinedAt - b.joinedAt)) p.team = this.smallerTeam();
    this.publish();
  }

  private blocker(): string | null {
    const ps = [...this.players.values()].filter((p) => p.connected);
    if (this.phase === 'partie') return 'Partie en cours.';
    if (ps.length < 2) return 'Il faut au moins 2 joueurs (partagez le code de la salle).';
    if (this.settings.mode === 'equipes') {
      for (const t of ['rouge', 'bleu'] as Team[]) if (!ps.some((p) => p.team === t)) return `${t === 'rouge' ? 'L’équipe Rouge' : 'L’équipe Bleue'} est vide.`;
    }
    return null;
  }

  lobbyView(): GFLobbyView {
    return {
      code: this.code,
      settings: { ...this.settings },
      players: [...this.players.values()].sort((a, b) => a.joinedAt - b.joinedAt).map((p) => ({ id: p.id, name: p.name, sex: p.sex, team: p.team, connected: p.connected, host: p.id === this.hostId, bot: p.bot })),
      phase: this.phase,
      blocker: this.blocker(),
    };
  }

  // ───────────────────────── partie ─────────────────────────

  start(id: string) {
    if (id !== this.hostId) throw new GFError('Seul l’hôte lance la partie.');
    const b = this.blocker();
    if (b) throw new GFError(b);
    for (const [pid, m] of this.players) if (!m.connected) this.players.delete(pid);
    const ids = [...this.players.keys()];
    const t = this.now();
    this.appearances = assignAppearances(
      ids.map((pid) => ({ playerId: pid, sex: this.players.get(pid)!.sex })),
      Math.floor(this.random() * 2 ** 31),
    );
    this.state.clear();
    this.poses.clear();
    this.history.clear();
    this.feed = [];
    this.result = null;
    this.teamScores = { rouge: 0, bleu: 0 };
    this.gamePhase = 'jeu';
    this.phase = 'partie';
    this.startedAt = t;
    this.endsAt = t + this.settings.minutes * 60_000;
    for (const pid of ids) {
      this.state.set(pid, { hp: GF_RULES.health, alive: true, kills: 0, deaths: 0, headshots: 0, ammo: fullAmmo(), reloadUntil: 0, reloading: null, respawnAt: 0, spawn: { x: 0, y: null, z: 0, yaw: 0, n: 0 }, shieldUntil: 0, nextShotAt: 0, nextStabAt: 0 });
      this.respawn(pid);
    }
    this.publish();
    this.out.event({ text: this.settings.mode === 'equipes' ? 'Match à mort par équipe : que la meilleure équipe gagne !' : 'Chacun pour soi : éliminez tout le monde !', kind: 'info' });
  }

  /** Réapparition au point le plus éloigné des adversaires vivants (un peu de hasard entre les meilleurs). */
  private respawn(id: string) {
    const s = this.state.get(id)!;
    const team = this.players.get(id)?.team ?? null;
    const enemies = [...this.state]
      .filter(([pid, o]) => pid !== id && o.alive && (this.settings.mode === 'ffa' || this.players.get(pid)?.team !== team))
      .map(([pid]) => this.poses.get(pid))
      .filter((p): p is PlayerPose & { t: number } => !!p);
    const scored = mapOf(this.settings.map).spawns.map(({ x, y, z }) => ({ x, y: y ?? null, z, d: enemies.length ? Math.min(...enemies.map((e) => Math.hypot(e.x - x, e.z - z))) : this.random() * 100 }))
      .sort((a, b) => b.d - a.d)
      .slice(0, 4);
    const p = scored[Math.floor(this.random() * scored.length)] ?? { x: 0, y: null, z: 0 };
    // regard tourné vers le cœur de la carte
    const sp = mapOf(this.settings.map).spawns;
    const cx = sp.reduce((a, q) => a + q.x, 0) / sp.length;
    const cz = sp.reduce((a, q) => a + q.z, 0) / sp.length;
    const yaw = Math.atan2(cx - p.x, cz - p.z);
    const t = this.now();
    s.alive = true;
    s.hp = GF_RULES.health;
    s.ammo = fullAmmo();
    s.reloadUntil = 0;
    s.reloading = null;
    s.respawnAt = 0;
    s.shieldUntil = t + GF_RULES.spawnShield * 1000;
    s.spawn = { x: p.x, y: p.y, z: p.z, yaw, n: s.spawn.n + 1 };
    this.poses.set(id, { x: p.x, y: p.y ?? 0, z: p.z, yaw, speed: 0, grounded: true, vy: 0, dir: 1, torch: false, pitch: 0, item: 'pistolet', t });
    this.history.set(id, []);
  }

  private must(id: string) {
    const m = this.players.get(id);
    if (!m) throw new GFError('Joueur inconnu.');
    return m;
  }

  private live(id: string) {
    if (this.phase !== 'partie' || this.gamePhase !== 'jeu') throw new GFError('Aucune partie en cours.');
    const s = this.state.get(id);
    if (!s) throw new GFError('Joueur inconnu.');
    if (!s.alive) throw new GFError('Vous êtes à terre.');
    return s;
  }

  pose(id: string, p: PlayerPose) {
    if (this.phase !== 'partie' || this.gamePhase !== 'jeu') return;
    const s = this.state.get(id);
    if (!s?.alive) return;
    if (![p.x, p.y, p.z, p.yaw, p.speed, p.vy, p.pitch ?? 0].every(Number.isFinite)) return;
    // hors de la carte choisie : position refusée
    if (!insideMap(mapOf(this.settings.map), p.x, p.y, p.z, 3)) return;
    const prev = this.poses.get(id);
    const t = this.now();
    if (prev) {
      const dt = Math.max(0.05, (t - prev.t) / 1000);
      if (Math.hypot(p.x - prev.x, p.z - prev.z) / dt > GF_RULES.maxSpeed && prev.t > 0) return;
    }
    const item: GFWeapon = p.item === 'couteau' || isGun(p.item) ? p.item : 'pistolet';
    if (prev) {
      const h = this.history.get(id) ?? [];
      h.push({ x: prev.x, y: prev.y, z: prev.z, t: prev.t });
      while (h.length && h[0].t < t - GF_RULES.lagMs) h.shift();
      this.history.set(id, h);
    }
    this.poses.set(id, { x: p.x, y: p.y, z: p.z, yaw: p.yaw, speed: Math.min(p.speed, 6), grounded: !!p.grounded, vy: p.vy, dir: p.dir === -1 ? -1 : 1, torch: false, pitch: Math.max(-1.5, Math.min(1.5, p.pitch ?? 0)), item, t });
  }

  posesView(): Record<string, PlayerPose> {
    const out: Record<string, PlayerPose> = {};
    for (const [id, p] of this.poses) if (this.state.get(id)?.alive) out[id] = { x: p.x, y: p.y, z: p.z, yaw: p.yaw, speed: p.speed, grounded: p.grounded, vy: p.vy, dir: p.dir, torch: false, pitch: p.pitch, item: p.item ?? 'pistolet' };
    return out;
  }

  private enemy(a: string, b: string) {
    return a !== b && (this.settings.mode === 'ffa' || this.players.get(a)?.team !== this.players.get(b)?.team);
  }
  private facing(a: string, b: string) {
    const p = this.poses.get(a)!;
    const q = this.poses.get(b)!;
    const dx = q.x - p.x;
    const dz = q.z - p.z;
    if (Math.hypot(dx, dz) < 0.3) return 0;
    const d = Math.atan2(dx, dz) - p.yaw;
    return Math.abs(Math.atan2(Math.sin(d), Math.cos(d)));
  }

  /** Taille du personnage (zones de touche). */
  bodyHeight(id: string) {
    return HEIGHTS.get(this.appearances[id]) ?? 1.75;
  }

  /**
   * Tir : `origin` est l'œil de la caméra du tireur, `dirs` la direction de chaque balle (plusieurs plombs au fusil
   * à pompe), `ends` les points d'impact vus par le navigateur (traçantes seulement, jamais pris pour des touches).
   */
  shoot(id: string, weapon: GFGun, origin: Vec3, dirs: Vec3[], ends: Vec3[] = []): GFShotResult {
    const s = this.live(id);
    if (!isGun(weapon)) throw new GFError('Arme inconnue.');
    const W = WEAPONS[weapon];
    const t = this.now();
    const p = this.poses.get(id)!;
    if (p.item !== weapon) throw new GFError('Sortez d’abord cette arme.');
    this.settleReload(s, t);
    if (s.reloadUntil > t && s.reloading === weapon) throw new GFError('Rechargement…');
    if (s.ammo[weapon] <= 0) throw new GFError('Chargeur vide : rechargez (R).');
    if (t < s.nextShotAt) throw new GFError('Trop rapide.');
    const eye: Vec3 = [p.x, p.y + EYE, p.z];
    if (!origin || !origin.every(Number.isFinite) || Math.hypot(origin[0] - eye[0], origin[1] - eye[1], origin[2] - eye[2]) > GF_RULES.aimOrigin) throw new GFError('Visée invalide.');
    const rays = (Array.isArray(dirs) ? dirs : []).slice(0, W.pellets).map((d) => (Array.isArray(d) && d.length === 3 ? normalize(d as Vec3) : null));
    if (!rays.length || rays.some((d) => !d)) throw new GFError('Visée invalide.');
    s.ammo[weapon]--;
    s.nextShotAt = t + W.fireDelay * 1000 * 0.9;
    s.shieldUntil = 0;
    // dégâts cumulés par cible (plombs), tête si au moins une balle à la tête
    const dmg = new Map<string, { d: number; head: boolean }>();
    const to: Vec3[] = [];
    rays.forEach((dir, i) => {
      const hit = this.trace(id, origin, dir!, W.range, eye);
      const e = ends[i];
      if (hit) {
        to.push(hit.at);
        const cur = dmg.get(hit.id) ?? { d: 0, head: false };
        cur.d += damageAt(W, Math.hypot(hit.at[0] - eye[0], hit.at[1] - eye[1], hit.at[2] - eye[2]), hit.head);
        cur.head ||= hit.head;
        dmg.set(hit.id, cur);
      } else
        to.push(
          Array.isArray(e) && e.length === 3 && e.every(Number.isFinite) && Math.hypot(e[0] - eye[0], e[1] - eye[1], e[2] - eye[2]) <= W.range + 8
            ? (e as Vec3)
            : [origin[0] + dir![0] * W.range, origin[1] + dir![1] * W.range, origin[2] + dir![2] * W.range],
        );
    });
    const best = [...dmg].sort((a, b) => b[1].d - a[1].d)[0];
    this.out.shot({ by: id, from: eye, to, hit: best?.[0] ?? null, head: !!best?.[1].head, weapon });
    if (!dmg.size) {
      this.publishGame();
      return { hit: false, killed: false, head: false };
    }
    let killed = false;
    for (const [victim, { d, head }] of dmg) if (this.damage(victim, id, Math.round(d), weapon, head)) killed = true;
    return { hit: true, killed, head: !!best[1].head };
  }

  /**
   * Premier adversaire traversé par le rayon (position actuelle ou récente, au choix la plus favorable au tireur),
   * dans la portée, devant le tireur, visible depuis ses yeux et depuis la caméra.
   */
  private trace(id: string, o: Vec3, d: Vec3, range: number, eye: Vec3): { id: string; head: boolean; at: Vec3 } | null {
    const p = this.poses.get(id)!;
    // le corps du tireur suit la caméra : un rayon tiré dans son dos est refusé
    const yawDiff = Math.atan2(d[0], d[2]) - p.yaw;
    if (Math.hypot(d[0], d[2]) > 0.2 && Math.abs(Math.atan2(Math.sin(yawDiff), Math.cos(yawDiff))) > GF_RULES.aimAngle) return null;
    const t = this.now();
    let best: { id: string; head: boolean; at: Vec3; t: number } | null = null;
    for (const [vid, q] of this.poses) {
      const vs = this.state.get(vid);
      if (!vs?.alive || !this.enemy(id, vid) || vs.shieldUntil > t) continue;
      const h = this.bodyHeight(vid);
      let found: { t: number; head: boolean } | null = null;
      for (const pos of [q, ...(this.history.get(vid) ?? []).filter((x) => x.t >= t - GF_RULES.lagMs)]) {
        const r = rayHitBody(o, d, pos, h);
        if (r && (!found || (r.head && !found.head))) found = r;
      }
      if (!found) continue;
      const at: Vec3 = [o[0] + d[0] * found.t, o[1] + d[1] * found.t, o[2] + d[2] * found.t];
      // devant les yeux du tireur, à portée
      const fx = at[0] - eye[0];
      const fy = at[1] - eye[1];
      const fz = at[2] - eye[2];
      if (fx * d[0] + fy * d[1] + fz * d[2] < 0.2 || Math.hypot(fx, fy, fz) > range) continue;
      if (best && found.t >= best.t) continue;
      best = { id: vid, head: found.head, at, t: found.t };
    }
    if (!best) return null;
    const pt = { x: best.at[0], y: best.at[1], z: best.at[2] };
    // un mur entre le tireur (ou sa caméra) et l'impact arrête la balle
    if (!this.sight({ x: eye[0], y: eye[1], z: eye[2] }, pt) || !this.sight({ x: o[0], y: o[1], z: o[2] }, pt)) return null;
    return best;
  }

  stab(id: string, target: string): GFShotResult {
    const s = this.live(id);
    if (this.poses.get(id)?.item !== 'couteau') throw new GFError('Sortez d’abord le couteau.');
    const t = this.now();
    if (t < s.nextStabAt) throw new GFError('Trop rapide.');
    s.nextStabAt = t + GF_RULES.knifeDelay * 1000;
    const p = this.poses.get(id)!;
    const q = this.poses.get(target);
    const ts = this.state.get(target);
    const ok = !!q && !!ts && ts.alive && this.enemy(id, target) && ts.shieldUntil <= t && Math.hypot(q.x - p.x, q.z - p.z, (q.y - p.y) * 1.5) <= GF_RULES.knifeRange && this.facing(id, target) <= GF_RULES.knifeAngle && this.sight({ x: p.x, y: p.y + CHEST, z: p.z }, { x: q.x, y: q.y + CHEST, z: q.z });
    this.out.shot({ by: id, from: [p.x, p.y + CHEST, p.z], to: [q ? [q.x, q.y + CHEST, q.z] : [p.x, p.y + CHEST, p.z]], hit: ok ? target : null, head: false, weapon: 'couteau' });
    if (!ok) return { hit: false, killed: false, head: false };
    return { hit: true, killed: this.damage(target, id, GF_RULES.knifeDamage, 'couteau', false), head: false };
  }

  /** Rechargement de l'arme en main (ou de celle désignée). */
  reload(id: string, weapon?: GFGun) {
    const s = this.live(id);
    const t = this.now();
    this.settleReload(s, t);
    const held = this.poses.get(id)?.item;
    const w = weapon && isGun(weapon) ? weapon : isGun(held) ? held : null;
    if (!w || s.ammo[w] >= WEAPONS[w].magazine || s.reloadUntil > t) return;
    s.reloading = w;
    s.reloadUntil = t + WEAPONS[w].reload * 1000;
    this.publishGame();
  }

  private settleReload(s: GFPlayerState, t: number) {
    if (s.reloadUntil && t >= s.reloadUntil) {
      if (s.reloading) s.ammo[s.reloading] = WEAPONS[s.reloading].magazine;
      s.reloadUntil = 0;
      s.reloading = null;
    }
  }

  private damage(victim: string, by: string, dmg: number, weapon: GFWeapon, head: boolean): boolean {
    const v = this.state.get(victim)!;
    v.hp = Math.max(0, v.hp - dmg);
    if (v.hp > 0) {
      this.publishGame();
      return false;
    }
    const t = this.now();
    v.alive = false;
    v.deaths++;
    v.respawnAt = t + GF_RULES.respawnSeconds * 1000;
    const k = this.state.get(by)!;
    k.kills++;
    if (head) k.headshots++;
    const team = this.players.get(by)?.team;
    if (this.settings.mode === 'equipes' && team) this.teamScores[team]++;
    this.feed.push({ killer: by, victim, weapon, head, t });
    if (this.feed.length > 8) this.feed.shift();
    this.checkEnd();
    this.publishGame();
    return true;
  }

  private checkEnd() {
    const L = this.settings.scoreLimit;
    if (this.settings.mode === 'equipes') {
      for (const tm of ['rouge', 'bleu'] as Team[]) if (this.teamScores[tm] >= L) return this.finish(tm, `${tm === 'rouge' ? 'L’équipe Rouge' : 'L’équipe Bleue'} atteint ${L} éliminations.`);
    } else {
      const best = [...this.state].find(([, s]) => s.kills >= L);
      if (best) return this.finish(best[0], `${this.players.get(best[0])?.name} atteint ${L} éliminations.`);
    }
  }

  /** Fin à l'heure : meilleur score (joueur ou équipe), égalité possible. */
  private finishOnTime() {
    if (this.settings.mode === 'equipes') {
      const { rouge, bleu } = this.teamScores;
      return this.finish(rouge === bleu ? null : rouge > bleu ? 'rouge' : 'bleu', `Temps écoulé (${rouge} – ${bleu}).`);
    }
    const sorted = [...this.state].sort((a, b) => b[1].kills - a[1].kills);
    const tie = sorted.length > 1 && sorted[0][1].kills === sorted[1][1].kills;
    this.finish(tie ? null : sorted[0][0], `Temps écoulé : ${tie ? 'égalité en tête' : `${this.players.get(sorted[0][0])?.name} mène avec ${sorted[0][1].kills} éliminations`}.`);
  }

  private finish(winner: string | Team | null, reason: string) {
    if (this.gamePhase === 'fin') return;
    this.gamePhase = 'fin';
    this.phase = 'fin';
    this.result = { winner, reason };
    this.out.event({ text: reason, kind: 'fin' });
    this.publish();
  }

  /** Horloge (toutes les 66 ms) : réapparitions, fin du temps, rechargements terminés. */
  tick() {
    if (this.phase !== 'partie' || this.gamePhase !== 'jeu') return;
    const t = this.now();
    let changed = false;
    for (const [pid, s] of this.state) {
      if (!s.alive && s.respawnAt && t >= s.respawnAt) {
        this.respawn(pid);
        changed = true;
      }
      if (s.reloadUntil && t >= s.reloadUntil) {
        this.settleReload(s, t);
        changed = true;
      }
    }
    if (t >= this.endsAt) this.finishOnTime();
    else if (changed) this.publishGame();
  }

  backToLobby(id: string) {
    this.must(id);
    if (this.phase === 'salon') return;
    if (this.phase !== 'fin') throw new GFError('La partie est en cours.');
    for (const [pid, m] of this.players) if (!m.connected) this.players.delete(pid);
    if (!this.players.has(this.hostId)) this.hostId = [...this.players.values()].filter((p) => !p.bot).sort((a, b) => a.joinedAt - b.joinedAt)[0]?.id ?? '';
    this.state.clear();
    this.poses.clear();
    this.history.clear();
    this.feed = [];
    this.result = null;
    this.phase = 'salon';
    this.publish();
  }

  gameView(): GFGameView {
    const players: Record<string, GFPlayerState> = {};
    const t = this.now();
    for (const [pid, s] of this.state) {
      this.settleReload(s, t);
      players[pid] = { hp: s.hp, alive: s.alive, kills: s.kills, deaths: s.deaths, headshots: s.headshots, ammo: { ...s.ammo }, reloadUntil: s.reloadUntil, reloading: s.reloading, respawnAt: s.respawnAt, spawn: { ...s.spawn }, shieldUntil: s.shieldUntil };
    }
    const teams: Record<string, Team | null> = {};
    for (const [pid, m] of this.players) teams[pid] = m.team;
    return {
      phase: this.gamePhase,
      settings: { ...this.settings },
      startedAt: this.startedAt,
      endsAt: this.endsAt,
      serverNow: t,
      appearances: { ...this.appearances },
      teams,
      players,
      teamScores: { ...this.teamScores },
      feed: [...this.feed],
      result: this.result,
    };
  }

  private publishGame() {
    if (this.phase !== 'salon') this.out.game(this.gameView());
  }
  private publish() {
    this.out.lobby(this.lobbyView());
    this.publishGame();
  }

  stateOf(id: string) {
    return this.state.get(id);
  }
}
