/**
 * Partie Gunfight dans la scène : le personnage du joueur et ses cinq armes (touches 1 à 5 ou molette), la visée
 * (rayon partant du viseur au centre de l'écran, visée épaulée au clic droit avec grossissement, lunette du fusil
 * de précision), la dispersion (plus large à la hanche et en mouvement), le recul, les autres joueurs (positions
 * reçues, interpolées) ou les robots du mode solo, les tirs (éclair, traçantes, son localisé), la chute des
 * joueurs éliminés et les réapparitions. Le navigateur n'envoie que le rayon de chaque balle : le serveur — ou la
 * salle locale en solo — cherche ce qu'elle touche (tête ou corps) et décide de chaque dégât.
 */
import * as THREE from 'three';
import { loadCharacter } from '../characters/assets';
import { CharacterAnimator } from '../characters/animator';
import { PlayerCamera } from '../characters/camera';
import { Character } from '../characters/character';
import { readMove } from '../characters/game';
import { GF_MOVE } from '../characters/config';
import type { MoveInput } from '../characters/controller';
import type { Input } from '../input';
import type { Village } from '../village/village';
import type { PlayerPose } from '../shared/protocol';
import { GF_RULES, GRENADES, PRIMARIES, SECONDARIES, SLOTS, WEAPONS, isGun, type GFGrenade, type GFGrenadeThrow, type GFGun, type GFShot, type GFShotResult, type GFWeapon, type Team, type Vec3 } from '../shared/gunfight';
import { sfx } from '../audio/sfx';
import { LocalGF, type GFClient } from './gfNet';
import { insideMap, mapOf, type GFMap } from '../shared/gunfightMaps';
import { lookDir, type Flashlights } from '../characters/flashlight';
import { gunfightProps } from '../shared/gunfightWorld';
import { buildPropsGroup, propObstacles } from '../village/gunfightPropsMesh';
import { rayHitBody } from '../shared/gunfight';
import type { MiniDot } from '../ui/gfMinimap';

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const TEAM_COLOR: Record<Team, string> = { rouge: '#e0574a', bleu: '#5a9be6' };

interface Remote {
  anim: CharacterAnimator;
  pos: THREE.Vector3;
  yaw: number;
  target: PlayerPose | null;
  grounded: boolean;
  tag: THREE.Sprite;
  fall: number;
}

interface Bot {
  ch: Character;
  weapon: GFWeapon;
  /** lacet de la visée (amorti) */
  aim: number;
  tag: THREE.Sprite;
  spawnN: number;
  target: string | null;
  waypoint: [number, number];
  stuck: number;
  nextShot: number;
  strafe: number;
  fall: number;
  thinkAt: number;
}

function nameTag(text: string, color: string) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 48;
  const g = c.getContext('2d')!;
  g.font = 'bold 26px Cinzel, Georgia, serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 5;
  g.strokeStyle = 'rgba(0,0,0,0.75)';
  g.strokeText(text, 128, 24);
  g.fillStyle = color;
  g.fillText(text, 128, 24);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: true, transparent: true }));
  s.scale.set(1.6, 0.3, 1);
  s.renderOrder = 5;
  return s;
}

export class GunfightGame {
  readonly cam: PlayerCamera;
  player: Character | null = null;
  private remotes = new Map<string, Remote>();
  private bots = new Map<string, Bot>();
  private loading = false;
  private generation = 0;
  private sendAcc = 0;
  private spawnN = 0;
  private tracers: { line: THREE.Line; life: number }[] = [];
  /** grenades en vol, explosions (boules de feu, éclats), nuages de fumée affichés */
  private flying = new Map<number, { g: GFGrenadeThrow; mesh: THREE.Mesh; done: boolean }>();
  private blasts: { s: THREE.Sprite; life: number; max: number; grow: number }[] = [];
  private blastLight: THREE.PointLight;
  private blastLife = 0;
  private smokeSprites = new Map<number, THREE.Sprite[]>();
  private nextThrow = 0;
  /** couverts de la carte jouée (maillages par carte, collisions activées seulement sur cette carte) */
  private propsMap: string | null = null;
  private propMeshes = new Map<string, THREE.Group>();
  /** ouverture du choix d'équipement (touche B) ; panneau ouvert : commandes gelées */
  onLoadout: () => void = () => {};
  kitOpen = false;
  private fallMe = 0;
  item: GFWeapon = 'pistolet';
  /** visée épaulée (0 à 1), dispersion actuelle (rad), prochain tir permis (s) */
  ads = 0;
  spread = 0;
  private nextFire = 0;
  private bloom = 0;
  private aimTarget = new THREE.Vector3();
  private aimDist = 20;
  /** sprint en cours ; sprint interdit jusqu'à (après un tir) */
  sprinting = false;
  private sprintBlock = 0;
  /** recul encore à rattraper (rad) : il revient en partie de lui-même */
  private recoilDebt = 0;
  /** dernier tir de chaque joueur (s, horloge locale) : points rouges sur la mini-carte */
  private lastShot = new Map<string, number>();
  /** dernière position valable dans la carte (limite invisible) */
  private lastGood = new WeakMap<Character, { x: number; y: number; z: number }>();
  /** on bute contre la limite de la carte */
  atLimit = 0;
  /** nuit : lampe (L) et laser (O) montés sur l'arme */
  torchOn = true;
  laserOn = true;
  private laserLine: THREE.Line;
  private dots: THREE.Sprite[] = [];
  paused = false;
  client: GFClient | null = null;
  /** retour visuel (marqueur de touche, élimination, dégâts) pour l'interface */
  onHitMarker: (killed: boolean, head: boolean) => void = () => {};
  onDamaged: () => void = () => {};
  onFeedback: (text: string) => void = () => {};

  constructor(
    readonly village: Village,
    readonly scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    readonly input: Input,
    readonly torches: Flashlights,
  ) {
    this.cam = new PlayerCamera(camera);
    this.cam.tight = true;
    // le fil du laser n'est visible que par le joueur qui vise ; les autres n'en voient que le point
    this.laserLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, 1)]),
      new THREE.LineBasicMaterial({ color: '#ff2a1a', transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.laserLine.frustumCulled = false;
    this.laserLine.visible = false;
    scene.add(this.laserLine);
    // une seule lumière d'explosion, créée d'avance (le nombre de lumières ne change jamais)
    this.blastLight = new THREE.PointLight('#ffb35a', 0, 22, 1.6);
    scene.add(this.blastLight);
  }

  /** lampe et laser montés sur les armes : de nuit, et toujours aux Souterrains */
  get gear() {
    return this.night || !!this.map.underground;
  }

  get night() {
    return !!this.client?.game?.settings.night;
  }

  attach(client: GFClient) {
    this.dispose();
    this.client = client;
    client.onShot = (s) => this.onShot(s);
    client.onGrenade = (g) => this.onGrenade(g);
  }

  get map(): GFMap {
    return mapOf(this.client?.game?.settings.map);
  }

  get alive() {
    const c = this.client;
    return !!c?.game?.players[c.me]?.alive;
  }

  private teamOf(id: string): Team | null {
    return this.client?.game?.teams[id] ?? null;
  }
  private isEnemy(id: string) {
    const g = this.client?.game;
    if (!g || id === this.client!.me) return false;
    return g.settings.mode === 'ffa' || this.teamOf(id) !== this.teamOf(this.client!.me);
  }
  private tagColor(id: string) {
    const t = this.teamOf(id);
    return t ? TEAM_COLOR[t] : '#f0d9a6';
  }

  /** Couverts de la carte (ou aucun) : maillages visibles et collisions actives. */
  private setProps(map: string | null) {
    if (map === this.propsMap) return;
    this.propsMap = map;
    const props = map ? gunfightProps(map) : [];
    this.village.collision.setGunfightProps(map ? `gf:${map}` : null, () => propObstacles(props));
    if (map && !this.propMeshes.has(map)) this.propMeshes.set(map, buildPropsGroup(props));
    for (const [k, g] of this.propMeshes) {
      if (k === map) this.scene.add(g);
      else g.removeFromParent();
    }
  }

  /** Crée les personnages (apparences tirées par la salle). */
  async ensure() {
    const c = this.client;
    const g = c?.game;
    if (!c || !g || this.player || this.loading) return;
    this.setProps(g.settings.map);
    this.loading = true;
    const gen = this.generation;
    try {
      const ids = Object.keys(g.appearances);
      const bases = await Promise.all(ids.map((id) => loadCharacter(g.appearances[id])));
      if (gen !== this.generation || this.player) return;
      const world = this.village.collision;
      const local = c instanceof LocalGF ? c : null;
      ids.forEach((id, i) => {
        const sp = g.players[id]?.spawn ?? { x: 0, y: null, z: 0, yaw: 0, n: 0 };
        if (id === c.me) {
          this.player = new Character(id, bases[i], world, sp.x, sp.z, sp.yaw);
          this.player.controller.move = GF_MOVE;
          this.scene.add(this.player.root);
          this.cam.yaw = sp.yaw;
          this.cam.pitch = -0.1;
          // placement exact (souterrains, obstacles) à la première image
          this.spawnN = sp.n - 1;
          if (this.cam.mode === 'subjective') this.player.animator.setFirstPerson(true);
        } else if (local?.bots.includes(id)) {
          const ch = new Character(id, bases[i], world, sp.x, sp.z, sp.yaw);
          ch.controller.move = GF_MOVE;
          const tag = nameTag(c.nameOf(id), this.tagColor(id));
          ch.root.add(tag);
          tag.position.y = ch.height + 0.35;
          this.scene.add(ch.root);
          this.bots.set(id, { ch, weapon: g.players[id]?.weapons[0] ?? 'pistolet', aim: sp.yaw, tag, spawnN: sp.n - 1, target: null, waypoint: this.randomSpawn(), stuck: 0, nextShot: 0, strafe: Math.random() * 6, fall: 0, thinkAt: 0 });
        } else {
          const anim = new CharacterAnimator(bases[i]);
          const y = world.groundAt(sp.x, sp.z, sp.y !== null && sp.y !== undefined ? sp.y + 1 : 1e6);
          anim.root.position.set(sp.x, y, sp.z);
          const tag = nameTag(c.nameOf(id), this.tagColor(id));
          anim.root.add(tag);
          tag.position.y = (bases[i].variant.heightM ?? 1.75) + 0.35;
          this.scene.add(anim.root);
          this.remotes.set(id, { anim, pos: new THREE.Vector3(sp.x, y, sp.z), yaw: sp.yaw, target: null, grounded: true, tag, fall: 0 });
        }
      });
    } finally {
      this.loading = false;
    }
  }

  dispose() {
    this.generation++;
    this.player?.dispose();
    this.player = null;
    for (const r of this.remotes.values()) r.anim.dispose();
    this.remotes.clear();
    for (const b of this.bots.values()) b.ch.dispose();
    this.bots.clear();
    for (const t of this.tracers) t.line.removeFromParent();
    this.tracers = [];
    document.body.classList.remove('aiming', 'scoped');
    this.cam.zoom = 1;
    this.torches.off();
    for (const f of this.flying.values()) f.mesh.removeFromParent();
    this.flying.clear();
    for (const b of this.blasts) b.s.removeFromParent();
    this.blasts = [];
    for (const list of this.smokeSprites.values()) for (const sp of list) sp.removeFromParent();
    this.smokeSprites.clear();
    this.blastLight.intensity = 0;
    this.setProps(null);
    this.laserLine.visible = false;
    for (const d of this.dots) d.visible = false;
    this.torchOn = this.laserOn = true;
  }

  /** Personnages en mouvement (sons de pas). */
  walkers() {
    const out: { id: string; x: number; y: number; z: number; grounded: boolean; local: boolean }[] = [];
    const c = this.client;
    if (!c?.game || !this.player) return out;
    const p = this.player.controller;
    if (this.alive) out.push({ id: c.me, x: p.x, y: p.y, z: p.z, grounded: p.grounded, local: true });
    for (const [id, r] of this.remotes) if (c.game.players[id]?.alive) out.push({ id, x: r.pos.x, y: r.pos.y, z: r.pos.z, grounded: r.grounded, local: false });
    for (const [id, b] of this.bots) if (c.game.players[id]?.alive) out.push({ id, x: b.ch.controller.x, y: b.ch.controller.y, z: b.ch.controller.z, grounded: b.ch.controller.grounded, local: false });
    return out;
  }

  /**
   * Nuit : faisceau de la lampe du joueur (avec ombres) et des autres (les plus proches), fil du laser du joueur
   * jusqu'à ce qu'il touche, et seulement le point rouge pour les lasers des autres.
   */
  private updateNight(armed: boolean) {
    const p = this.player!;
    if (!this.gear) {
      this.torches.off();
      this.laserLine.visible = false;
      for (const d of this.dots) d.visible = false;
      return;
    }
    const camDir = this.cam.camera.getWorldDirection(new THREE.Vector3());
    const aim = p.animator.aimTarget ?? this.cam.camera.position.clone().addScaledVector(camDir, 20);
    const tf = armed && this.torchOn ? p.animator.gunAccessory('torch') : null;
    this.torches.setLocal(!!tf, tf ?? aim, tf ? aim.clone().sub(tf).normalize() : camDir);
    const beams: { from: THREE.Vector3; dir: THREE.Vector3 }[] = [];
    const lasers: { from: THREE.Vector3; dir: THREE.Vector3; id: string }[] = [];
    const g = this.client!.game!;
    const others: [string, { anim: CharacterAnimator; yaw: number; pitch: number; torch: boolean; laser: boolean }][] = [];
    for (const [id, r] of this.remotes) {
      const t = r.target;
      if (t && g.players[id]?.alive) others.push([id, { anim: r.anim, yaw: r.yaw, pitch: t.pitch, torch: !!t.torch, laser: !!t.laser }]);
    }
    for (const [id, b] of this.bots) if (g.players[id]?.alive) others.push([id, { anim: b.ch.animator, yaw: b.ch.yaw, pitch: b.ch.animator.aimPitch, torch: true, laser: true }]);
    for (const [id, o] of others) {
      const dir = lookDir(o.yaw, o.pitch);
      const tfrom = o.torch ? o.anim.gunAccessory('torch') : null;
      if (tfrom) beams.push({ from: tfrom, dir });
      const lfrom = o.laser ? o.anim.gunAccessory('laser') : null;
      if (lfrom) lasers.push({ from: lfrom, dir, id });
    }
    this.torches.setRemotes(beams, p.root.position);
    // laser du joueur : le fil (lui seul le voit) et le point
    const mine = armed && this.laserOn ? p.animator.gunAccessory('laser') : null;
    let n = 0;
    if (mine) {
      const end = this.laserEnd(mine, aim.clone().sub(mine).normalize(), this.client!.me);
      const pos = this.laserLine.geometry.attributes.position as THREE.BufferAttribute;
      pos.setXYZ(0, mine.x, mine.y, mine.z);
      pos.setXYZ(1, end.x, end.y, end.z);
      pos.needsUpdate = true;
      this.laserLine.visible = true;
      this.dot(n++, end);
    } else this.laserLine.visible = false;
    for (const l of lasers) this.dot(n++, this.laserEnd(l.from, l.dir, l.id));
    for (let i = n; i < this.dots.length; i++) this.dots[i].visible = false;
  }

  /** Bout d'un laser : premier corps (tête comprise) ou premier obstacle du décor, à 80 m au plus. */
  private laserEnd(from: THREE.Vector3, dir: THREE.Vector3, ignore: string): THREE.Vector3 {
    const o: Vec3 = [from.x, from.y, from.z];
    const d: Vec3 = [dir.x, dir.y, dir.z];
    let best = 80;
    const test = (id: string, pos: THREE.Vector3, h: number) => {
      if (id === ignore || !this.client?.game?.players[id]?.alive) return;
      const r = rayHitBody(o, d, pos, h);
      if (r && r.t < best) best = r.t;
    };
    if (this.player && this.alive) test(this.client!.me, this.player.root.position, this.player.height);
    for (const [id, r] of this.remotes) test(id, r.pos, r.anim.base.variant.heightM);
    for (const [id, b] of this.bots) test(id, b.ch.root.position, b.ch.height);
    const w = this.village.collision;
    for (let t = 0.3; t < best; t += 0.4) if (w.blocksPoint(from.x + dir.x * t, from.y + dir.y * t, from.z + dir.z * t, 0)) return from.clone().addScaledVector(dir, Math.max(0, t - 0.2));
    return from.clone().addScaledVector(dir, best - 0.02);
  }

  private dot(i: number, at: THREE.Vector3) {
    if (!this.dots[i]) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTexture(), color: '#ff3020', blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: false, transparent: true }));
      s.scale.setScalar(0.014);
      s.renderOrder = 6;
      this.scene.add(s);
      this.dots[i] = s;
    }
    this.dots[i].position.copy(at);
    this.dots[i].visible = true;
  }

  /** Lancer : depuis les yeux, dans l'axe du viseur, un peu vers le haut ; la salle calcule la trajectoire. */
  private throwGrenade(kind: GFGrenade) {
    const c = this.client!;
    const me = c.game!.players[c.me];
    const now = performance.now() / 1000;
    if (!me?.grenades || me.grenades[kind] <= 0 || now < this.nextThrow) {
      if (me?.grenades && me.grenades[kind] <= 0) sfx.dryFire();
      return;
    }
    this.nextThrow = now + 0.8;
    const p = this.player!;
    const dir = this.cam.camera.getWorldDirection(new THREE.Vector3());
    const k = p.controller;
    const origin: Vec3 = [k.x + dir.x * 0.4, k.y + 1.55, k.z + dir.z * 0.4];
    const sp = 17;
    const vel: Vec3 = [dir.x * sp + k.realVx * 0.5, dir.y * sp + 4, dir.z * sp + k.realVz * 0.5];
    p.animator.throwGrenade();
    sfx.swing();
    this.sendPoseNow();
    c.throwGrenade(kind, origin, vel).catch((e: Error) => this.onFeedback(e.message));
  }

  /** Grenade lancée (par n'importe qui) : un objet suit la trajectoire calculée par la salle. */
  private onGrenade(g: GFGrenadeThrow) {
    const anim = g.by === this.client?.me ? this.player?.animator : (this.remotes.get(g.by)?.anim ?? this.bots.get(g.by)?.ch.animator);
    if (g.by !== this.client?.me) anim?.throwGrenade();
    const geo = g.kind === 'frag' ? new THREE.SphereGeometry(0.045, 10, 8).scale(1, 1.25, 1) : new THREE.CylinderGeometry(0.03, 0.03, 0.11, 10);
    const mat = new THREE.MeshStandardMaterial({ color: g.kind === 'frag' ? '#3f4a2e' : g.kind === 'flash' ? '#6b7076' : '#5c6266', roughness: 0.6, metalness: 0.4 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(...g.path[0]);
    this.scene.add(mesh);
    this.flying.set(g.id, { g, mesh, done: false });
  }

  private updateGrenades(dt: number) {
    const c = this.client;
    if (!c?.game) return;
    const t = c.serverNow();
    for (const [id, f] of this.flying) {
      const u = (t - f.g.t0) / 50; // un point tous les 1/20 s
      const i = Math.min(f.g.path.length - 1, Math.max(0, Math.floor(u)));
      const a = f.g.path[i];
      const b = f.g.path[Math.min(f.g.path.length - 1, i + 1)];
      const k = Math.min(1, Math.max(0, u - i));
      f.mesh.position.set(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k);
      f.mesh.rotation.x += dt * 9;
      if (t >= f.g.explodeAt) {
        this.explodeFx(f.g.kind, f.mesh.position.clone());
        f.mesh.removeFromParent();
        this.flying.delete(id);
      }
    }
    for (const b of this.blasts) {
      b.life -= dt;
      const x = 1 - b.life / b.max;
      b.s.scale.setScalar(b.grow * (0.4 + x * 0.9));
      b.s.material.opacity = Math.max(0, b.life / b.max);
    }
    this.blasts = this.blasts.filter((b) => (b.life > 0 ? true : (b.s.removeFromParent(), false)));
    this.blastLife = Math.max(0, this.blastLife - dt);
    this.blastLight.intensity = this.blastLife > 0 ? 400 * (this.blastLife / 0.35) ** 2 : 0;
    // nuages de fumée : grosses volutes qui gonflent puis se dissipent
    const live = new Set<number>();
    for (const sm of c.game.smokes) {
      const key = sm.from;
      live.add(key);
      let list = this.smokeSprites.get(key);
      if (!list) {
        list = [];
        for (let i = 0; i < 26; i++) {
          const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTexture(), color: '#c9c9c4', transparent: true, depthWrite: false, opacity: 0 }));
          const a = Math.random() * Math.PI * 2;
          const r = Math.sqrt(Math.random()) * sm.r * 0.8;
          s.position.set(sm.x + Math.cos(a) * r, sm.y + 0.6 + Math.random() * 2.6, sm.z + Math.sin(a) * r);
          s.userData.size = 3 + Math.random() * 2.5;
          s.material.rotation = Math.random() * 6;
          this.scene.add(s);
          list.push(s);
        }
        this.smokeSprites.set(key, list);
      }
      const age = (t - sm.from) / 1000;
      const left = (sm.until - t) / 1000;
      const k = Math.min(1, age / 1.5) * Math.min(1, left / 2.5);
      for (const s of list) {
        s.scale.setScalar(s.userData.size * (0.5 + 0.5 * Math.min(1, age / 2)));
        s.material.opacity = 0.92 * k;
        s.material.rotation += dt * 0.05;
      }
    }
    for (const [key, list] of this.smokeSprites)
      if (!live.has(key)) {
        for (const s of list) s.removeFromParent();
        this.smokeSprites.delete(key);
      }
  }

  /** Effets d'une explosion : boule de feu et lumière (grenade), éclair blanc (aveuglante), son. */
  private explodeFx(kind: GFGrenade, at: THREE.Vector3) {
    const d = this.player ? this.player.root.position.distanceTo(at) : 0;
    const gain = Math.max(0.1, 1 - d / 120);
    if (kind === 'fumee') {
      sfx.smoke(gain);
      return;
    }
    const add = (color: string, size: number, life: number, y = 0) => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTexture(), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      s.position.copy(at).add(new THREE.Vector3(0, y, 0));
      this.scene.add(s);
      this.blasts.push({ s, life, max: life, grow: size });
    };
    if (kind === 'frag') {
      add('#ffd08a', 5, 0.35, 0.4);
      add('#ff7a2a', 4, 0.5, 0.6);
      for (let i = 0; i < 6; i++) {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTexture(), color: '#3a3632', transparent: true, depthWrite: false }));
        s.position.copy(at).add(new THREE.Vector3((Math.random() - 0.5) * 2, 0.5 + Math.random() * 1.5, (Math.random() - 0.5) * 2));
        this.scene.add(s);
        this.blasts.push({ s, life: 1.6 + Math.random(), max: 2.4, grow: 3 + Math.random() * 2 });
      }
      this.blastLight.color.set('#ffb35a');
      sfx.explosion(gain);
    } else {
      add('#ffffff', 3, 0.25, 0.3);
      this.blastLight.color.set('#e8f0ff');
      sfx.flashbang(gain);
    }
    this.blastLight.position.copy(at).add(new THREE.Vector3(0, 0.8, 0));
    this.blastLife = 0.35;
  }

  /** La ligne de vue traverse-t-elle un nuage de fumigène ? (robots) */
  private smokeBlocks(a: THREE.Vector3, b: THREE.Vector3) {
    for (const sm of this.client?.game?.smokes ?? []) {
      const c = new THREE.Vector3(sm.x, sm.y + 1.5, sm.z);
      const ab = b.clone().sub(a);
      const t = THREE.MathUtils.clamp(c.clone().sub(a).dot(ab) / ab.lengthSq(), 0, 1);
      if (a.clone().addScaledVector(ab, t).distanceTo(c) < sm.r * 0.85) return true;
    }
    return false;
  }

  private randomSpawn(): [number, number] {
    const sp = this.map.spawns;
    const p = sp[Math.floor(Math.random() * sp.length)];
    return [p.x, p.z];
  }

  /**
   * Place un personnage au point d'apparition (au sol des souterrains si besoin) ; si un meuble, un tronc ou un
   * mur occupe le point, on cherche la place libre la plus proche (en spirale).
   */
  private placeAt(ch: Character, x: number, z: number, y: number | null = null) {
    const w = this.village.collision;
    const c = ch.controller;
    const top = (px: number, pz: number) => w.groundAt(px, pz, y !== null ? y + 1 : w.groundAt(px, pz, 1e6) + 0.1);
    let best: [number, number] = [x, z];
    search: for (let r = 0; r <= 4; r += 0.5)
      for (let a = 0; a < Math.PI * 2; a += r ? 0.5 / r : 7) {
        const px = x + Math.cos(a) * r;
        const pz = z + Math.sin(a) * r;
        const gy = top(px, pz);
        if (!Number.isFinite(gy)) continue;
        if (!w.blocksPoint(px, gy + 0.6, pz, 0.32) && !w.blocksPoint(px, gy + 1.4, pz, 0.32)) {
          best = [px, pz];
          break search;
        }
      }
    c.x = best[0];
    c.z = best[1];
    c.y = top(c.x, c.z);
    if (!Number.isFinite(c.y)) c.y = y ?? 0;
    c.vx = c.vz = c.vy = 0;
    c.grounded = true;
    this.lastGood.set(ch, { x: c.x, y: c.y, z: c.z });
  }

  /** Limite invisible de la carte : le personnage qui la franchit revient à sa dernière position valable. */
  private confine(ch: Character): boolean {
    const c = ch.controller;
    if (insideMap(this.map, c.x, c.y, c.z)) {
      this.lastGood.set(ch, { x: c.x, y: c.y, z: c.z });
      return false;
    }
    const g = this.lastGood.get(ch);
    if (g) {
      c.x = g.x;
      c.y = g.y;
      c.z = g.z;
      c.vx = c.vz = 0;
      if (c.vy > 0) c.vy = 0;
    }
    return true;
  }

  /** Avancement du rechargement d'un joueur (0 à 1) si l'arme qu'il tient est en cours de rechargement. */
  private reloadProgress(id: string, item: string | null | undefined): number | null {
    const st = this.client?.game?.players[id];
    if (!st?.reloadUntil || !st.reloading || st.reloading !== item) return null;
    const left = (st.reloadUntil - this.client!.serverNow()) / 1000;
    const total = WEAPONS[st.reloading].reload;
    return left > 0 ? THREE.MathUtils.clamp(1 - left / total, 0, 1) : null;
  }

  /** Points de la mini-carte : coéquipiers (toujours), adversaires quelques secondes après leurs tirs. */
  miniDots(): MiniDot[] {
    const c = this.client;
    const g = c?.game;
    if (!c || !g) return [];
    const out: MiniDot[] = [];
    const now = performance.now() / 1000;
    const add = (id: string, x: number, z: number) => {
      if (id === c.me || !g.players[id]?.alive) return;
      if (!this.isEnemy(id)) out.push({ x, z, kind: 'allie', a: 1 });
      else {
        const t = now - (this.lastShot.get(id) ?? -99);
        if (t < 3) out.push({ x, z, kind: 'ennemi', a: t < 2 ? 1 : 3 - t });
      }
    };
    for (const [id, r] of this.remotes) add(id, r.pos.x, r.pos.z);
    for (const [id, b] of this.bots) add(id, b.ch.controller.x, b.ch.controller.z);
    return out;
  }

  update(dt: number) {
    const c = this.client;
    const g = c?.game;
    const p = this.player;
    if (!c || !g || !p) return;
    const me = g.players[c.me];
    const playing = g.phase === 'jeu';
    // réapparition décidée par la salle : on se place au point donné
    if (me && me.spawn.n !== this.spawnN) {
      this.spawnN = me.spawn.n;
      this.placeAt(p, me.spawn.x, me.spawn.z, me.spawn.y);
      p.yaw = me.spawn.yaw;
      this.cam.yaw = me.spawn.yaw;
      p.root.rotation.x = 0;
      this.fallMe = 0;
      this.item = me.weapons[0] ?? 'pistolet';
    }
    const alive = !!me?.alive;
    const frozen = !playing || this.paused || !alive || this.kitOpen;
    const m = this.input.takeMouse();
    if (!this.paused) this.cam.look(m.dx, m.dy, 0);
    if (!this.paused && this.input.consume('KeyV')) this.cam.toggle(p);
    // armes : touches 1 à 5, molette pour passer à la suivante / précédente
    // seules les armes permises (réglages de la salle, palier de progression) se sortent
    const allowed = me?.weapons ?? SLOTS;
    if (alive && !allowed.includes(this.item)) this.switchTo(allowed[0]);
    // 1 : arme principale, 2 : secondaire, 3 : couteau (dans l'ordre de l'équipement)
    for (let i = 0; i < 3; i++) if (this.input.consume(`Digit${i + 1}`) && !frozen && allowed[i]) this.switchTo(allowed[i]);
    for (let i = 3; i < 6; i++) this.input.consume(`Digit${i + 1}`);
    // grenades : G fragmentation, F aveuglante, C fumigène ; B : équipement
    for (const [code, kind] of [['KeyG', 'frag'], ['KeyF', 'flash'], ['KeyC', 'fumee']] as [string, GFGrenade][]) if (this.input.consume(code) && !frozen) this.throwGrenade(kind);
    if (this.input.consume('KeyB') && playing && !this.paused) this.onLoadout();
    if (!frozen && Math.abs(m.wheel) > 20 && allowed.length > 1) {
      const i = Math.max(0, allowed.indexOf(this.item));
      this.switchTo(allowed[(i + (m.wheel > 0 ? 1 : -1) + allowed.length) % allowed.length]);
    }
    if (!frozen && this.input.consume('KeyR')) this.reload();
    if (this.gear && !frozen && this.input.consume('KeyL')) {
      this.torchOn = !this.torchOn;
      sfx.torch();
      this.sendPoseNow();
    }
    if (this.gear && !frozen && this.input.consume('KeyO')) {
      this.laserOn = !this.laserOn;
      sfx.torch();
      this.sendPoseNow();
    }
    const gun = isGun(this.item) ? this.item : null;
    const now = performance.now() / 1000;
    if (alive) {
      // déplacement de jeu de tir : trot par défaut ; sprint (Maj) vers l'avant, arme abaissée, corps face à la
      // course ; sinon le corps reste face au viseur et l'on se déplace dans tous les sens (plus lentement à
      // reculons et en visée)
      const mv = readMove(this.input, this.cam, frozen);
      const [fx, fz] = this.cam.forward;
      const len = Math.hypot(mv.x, mv.z);
      const ahead = len > 0.1 ? (mv.x * fx + mv.z * fz) / len : 0;
      const firing = this.input.held('Mouse0') || this.input.held('Mouse2');
      this.sprinting = mv.run && len > 0.1 && ahead > 0.55 && !firing && now >= this.sprintBlock && p.controller.grounded !== false;
      if (firing && mv.run) this.sprintBlock = now + 0.25;
      mv.run = this.sprinting;
      mv.scale = this.sprinting ? 1 : (ahead < -0.3 ? 0.78 : ahead < 0.5 ? 0.9 : 1) * (1 - 0.4 * this.ads);
      p.aimYaw = gun && !this.sprinting ? this.cam.yaw : null;
      p.animator.sprint = this.sprinting && !!gun;
      p.update(dt, mv, this.cam.yaw);
      this.atLimit = this.confine(p) ? 0.6 : Math.max(0, this.atLimit - dt);
      p.root.visible = true;
    } else {
      // à terre : le corps bascule, la caméra reste
      this.fallMe = Math.min(1, this.fallMe + dt / 0.6);
      p.root.rotation.x = (-Math.PI / 2) * this.fallMe * this.fallMe;
    }
    // visée épaulée (clic droit maintenu), pas pendant un rechargement de l'arme en main
    const reloadingThis = !!gun && !!me?.reloadUntil && me.reloading === gun;
    const wantAds = !frozen && !!gun && this.input.held('Mouse2') && !reloadingThis ? 1 : 0;
    this.ads += (wantAds - this.ads) * Math.min(1, dt * 12);
    const W = gun ? WEAPONS[gun] : null;
    this.cam.zoom = W ? 1 + (W.zoom - 1) * (this.ads > 0.5 ? 1 : 0) : 1;
    const scoped = gun === 'precision' && this.ads > 0.85;
    document.body.classList.toggle('scoped', scoped && alive && !this.paused);
    // dispersion : à la hanche ou épaulée, élargie en mouvement, en l'air et juste après un tir
    const k = p.controller;
    const moving = Math.min(1, Math.hypot(k.realVx, k.realVz) / 5);
    this.bloom = Math.max(0, this.bloom - dt * 2.5);
    this.spread = W ? (W.spread + (W.adsSpread - W.spread) * this.ads) * (1 + moving * 0.9 + (k.grounded ? 0 : 1.5)) + this.bloom * W.spread : 0;
    p.animator.gunTorch = this.gear && this.torchOn;
    p.animator.gunLaser = this.gear && this.laserOn;
    p.animator.setItem(alive ? this.item : null);
    p.animator.aimPitch = this.cam.pitch;
    p.animator.ads = this.ads;
    p.animator.reloading = this.reloadProgress(c.me, this.item);
    // le recul se rattrape en partie (la visée redescend d'elle-même)
    if (this.recoilDebt > 0) {
      const back = Math.min(this.recoilDebt, this.recoilDebt * dt * 7 + dt * 0.02);
      this.recoilDebt -= back;
      this.cam.pitch -= back * 0.7;
    }
    this.cam.aiming = alive && !!gun;
    document.body.classList.toggle('aiming', alive && playing && !!gun && !this.paused);
    this.sendAcc += dt;
    if (alive && playing && this.sendAcc > 1 / 15) this.sendPoseNow();
    // tir : au coup par coup (clic), en rafale tant que le bouton est maintenu ; après un sprint, l'arme revient en
    // position avant de tirer
    if (this.sprinting) this.nextFire = Math.max(this.nextFire, now + 0.15);
    const trigger = this.input.consume('Mouse0') || (!!W?.auto && this.input.held('Mouse0'));
    if (!frozen && trigger && now >= this.nextFire) this.attack(now);
    this.updateRemotes(dt);
    if (c instanceof LocalGF) this.updateBots(dt, c);
    this.cam.update(dt, p, this.village.collision);
    // l'arme pointe sur ce qui est sous le viseur (distance amortie : pas de saut quand le viseur passe un bord)
    if (gun && alive) {
      const dir = this.cam.camera.getWorldDirection(new THREE.Vector3());
      const d = Math.max(4, this.aimPoint(dir, 60).distanceTo(this.cam.camera.position));
      this.aimDist += (d - this.aimDist) * Math.min(1, dt * 6);
      p.animator.aimTarget = this.aimTarget.copy(this.cam.camera.position).addScaledVector(dir, this.aimDist);
    } else p.animator.aimTarget = null;
    if (scoped && alive) p.root.visible = false;
    this.updateNight(alive && !!gun);
    for (const t of this.tracers) {
      t.life -= dt;
      (t.line.material as THREE.LineBasicMaterial).opacity = Math.max(0, t.life / 0.12);
    }
    this.tracers = this.tracers.filter((t) => (t.life > 0 ? true : (t.line.removeFromParent(), false)));
    this.updateGrenades(dt);
  }

  /** Rayon du cône de dispersion à l'écran (px), pour le viseur. */
  spreadPx() {
    const cam = this.cam.camera;
    return (Math.tan(this.spread) / Math.tan(THREE.MathUtils.degToRad(cam.fov / 2))) * (window.innerHeight / 2);
  }

  get scoped() {
    return document.body.classList.contains('scoped');
  }

  private switchTo(item: GFWeapon) {
    if (this.item === item) return;
    this.item = item;
    sfx.draw();
    // sortir une arme prend un instant
    this.nextFire = Math.max(this.nextFire, performance.now() / 1000 + 0.25);
    this.sendPoseNow();
  }

  private sendPoseNow() {
    const p = this.player;
    const c = this.client;
    if (!p || !c) return;
    this.sendAcc = 0;
    const k = p.controller;
    c.sendPose({ x: k.x, y: k.y, z: k.z, yaw: p.yaw, speed: Math.hypot(k.realVx, k.realVz), grounded: k.grounded, vy: k.vy, dir: 1, torch: this.gear && this.torchOn, laser: this.gear && this.laserOn, pitch: this.cam.pitch, item: this.item });
  }

  private reload() {
    const me = this.client?.game?.players[this.client.me];
    const gun = isGun(this.item) ? this.item : null;
    if (!me || !gun || me.ammo[gun] >= WEAPONS[gun].magazine || me.reloadUntil) return;
    sfx.draw();
    this.client!.reload(gun).catch(() => {});
  }

  /** Point visé : premier obstacle (décor) sur le rayon partant de la caméra, à `range` mètres au plus. */
  private aimPoint(dir: THREE.Vector3, range: number): THREE.Vector3 {
    const o = this.cam.camera.position;
    const w = this.village.collision;
    const step = 0.6;
    for (let d = 0.8; d < range; d += step) {
      const x = o.x + dir.x * d;
      const y = o.y + dir.y * d;
      const z = o.z + dir.z * d;
      if (w.blocksPoint(x, y, z, 0)) return this.aimTarget.set(x, y, z);
    }
    return this.aimTarget.copy(o).addScaledVector(dir, range);
  }

  private knifeTarget(): string | null {
    const p = this.player!;
    const g = this.client!.game!;
    let best: { id: string; d: number } | null = null;
    const consider = (id: string, pos: THREE.Vector3) => {
      if (!g.players[id]?.alive || !this.isEnemy(id)) return;
      const dx = pos.x - p.controller.x;
      const dz = pos.z - p.controller.z;
      const d = Math.hypot(dx, dz);
      if (d > GF_RULES.knifeRange || Math.abs(pos.y - p.controller.y) > 1.5) return;
      if (d > 0.3 && Math.abs(wrap(Math.atan2(dx, dz) - p.yaw)) > GF_RULES.knifeAngle) return;
      if (!best || d < best.d) best = { id, d };
    };
    for (const [id, r] of this.remotes) consider(id, r.pos);
    for (const [id, b] of this.bots) consider(id, b.ch.root.position);
    return (best as { id: string } | null)?.id ?? null;
  }

  private attack(now: number) {
    const c = this.client!;
    const me = c.game!.players[c.me];
    const p = this.player!;
    this.sendPoseNow();
    if (this.item === 'couteau') {
      this.nextFire = now + GF_RULES.knifeDelay;
      p.animator.strike();
      sfx.swing();
      const t = this.knifeTarget();
      if (t) c.stab(t).then((r) => r.hit && this.hit(r), () => {});
      return;
    }
    const gun = this.item as GFGun;
    const W = WEAPONS[gun];
    if (me.reloadUntil && me.reloading === gun) return;
    if (me.ammo[gun] <= 0) {
      this.nextFire = now + 0.3;
      sfx.dryFire();
      this.reload();
      return;
    }
    this.nextFire = now + W.fireDelay;
    // une direction par balle (plombs du fusil à pompe), tirée au hasard dans le cône de dispersion
    const cam = this.cam.camera;
    const fwd = cam.getWorldDirection(new THREE.Vector3());
    const right = new THREE.Vector3().crossVectors(fwd, cam.up).normalize();
    const up = new THREE.Vector3().crossVectors(right, fwd);
    const dirs: Vec3[] = [];
    const ends: Vec3[] = [];
    for (let i = 0; i < W.pellets; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = this.spread * Math.sqrt(Math.random());
      const d = fwd.clone().addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize();
      dirs.push([d.x, d.y, d.z]);
      const e = this.aimPoint(d, W.range);
      ends.push([e.x, e.y, e.z]);
    }
    const o = cam.position;
    // recul : le canon relève la visée, un peu de travers ; la dispersion s'ouvre
    const kick = W.recoil * (0.8 + Math.random() * 0.4) * (1 - this.ads * 0.3);
    this.cam.pitch = Math.min(1.05, this.cam.pitch + kick);
    this.recoilDebt += kick;
    this.cam.yaw += (Math.random() - 0.5) * W.recoil * (W.auto ? 0.8 : 0.4);
    this.bloom = Math.min(1.5, this.bloom + (W.auto ? 0.25 : 0.5));
    c.shoot(gun, [o.x, o.y, o.z], dirs, ends).then(
      (r) => {
        if (r.hit) this.hit(r);
        const left = c.game?.players[c.me]?.ammo[gun] ?? 1;
        if (left <= 0) this.reload();
      },
      (e: Error) => {
        if (/vide/.test(e.message)) this.reload();
      },
    );
  }

  private hit(r: GFShotResult) {
    this.onHitMarker(r.killed, r.head);
    if (r.head) sfx.headshot();
    else if (r.killed) sfx.notify();
    else sfx.vote();
    if (r.killed && r.head) sfx.notify();
  }

  /** Tir vu de tous : recul et éclair du tireur, traçante, son atténué avec la distance, dégâts reçus. */
  private onShot(s: GFShot) {
    const c = this.client;
    if (!c) return;
    const me = c.me;
    this.lastShot.set(s.by, performance.now() / 1000);
    const shooterAnim = s.by === me ? this.player?.animator : (this.remotes.get(s.by)?.anim ?? this.bots.get(s.by)?.ch.animator);
    if (s.weapon !== 'couteau') {
      shooterAnim?.fire();
      const from = shooterAnim?.item === s.weapon ? shooterAnim.muzzlePosition() : new THREE.Vector3(...s.from);
      for (const to of s.to) {
        const geo = new THREE.BufferGeometry().setFromPoints([from, new THREE.Vector3(...to)]);
        const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: '#ffe0a0', transparent: true, opacity: 1 }));
        this.scene.add(line);
        this.tracers.push({ line, life: 0.12 });
      }
      const pp = this.player?.root.position;
      const d = pp ? pp.distanceTo(new THREE.Vector3(...s.from)) : 0;
      const loud = s.weapon === 'precision' || s.weapon === 'pompe' ? 1.25 : s.weapon === 'fusil' ? 0.85 : 1;
      if (s.by === me || d < 160) sfx.gunshotAt(Math.min(1, Math.max(0.08, 1 - d / 160) * loud), s.weapon);
    } else shooterAnim?.strike();
    if (s.hit === me) {
      this.onDamaged();
      sfx.stab(0.8);
    }
  }

  private updateRemotes(dt: number) {
    const c = this.client!;
    const g = c.game!;
    for (const [id, r] of this.remotes) {
      const st = g.players[id];
      const pose = c.poses[id];
      if (!st?.alive) {
        // éliminé : il s'effondre, puis disparaît jusqu'à sa réapparition
        r.fall = Math.min(1, r.fall + dt / 0.6);
        r.anim.root.rotation.x = (-Math.PI / 2) * r.fall * r.fall;
        r.tag.visible = false;
        r.target = null;
        continue;
      }
      if (r.fall > 0) {
        r.fall = 0;
        r.anim.root.rotation.x = 0;
        if (pose) r.pos.set(pose.x, pose.y, pose.z);
      }
      r.tag.visible = true;
      if (pose) r.target = pose;
      const t = r.target;
      if (!t) continue;
      const k = Math.min(1, dt * 12);
      const before = r.pos.clone();
      r.pos.x += (t.x - r.pos.x) * k;
      r.pos.z += (t.z - r.pos.z) * k;
      r.pos.y += (t.y - r.pos.y) * Math.min(1, dt * (t.grounded ? 14 : 25));
      if (r.pos.distanceTo(new THREE.Vector3(t.x, t.y, t.z)) > 6) r.pos.set(t.x, t.y, t.z);
      const step = wrap(t.yaw - r.yaw) * Math.min(1, dt * 12);
      r.yaw = wrap(r.yaw + step);
      if (r.grounded && !t.grounded) r.anim.onJump();
      if (!r.grounded && t.grounded) r.anim.onLand(6);
      r.grounded = t.grounded;
      r.anim.gunTorch = !!t.torch;
      r.anim.gunLaser = !!t.laser;
      r.anim.setItem(t.item ?? 'pistolet');
      r.anim.aimPitch = t.pitch;
      r.anim.aimTarget = null;
      r.anim.reloading = this.reloadProgress(id, t.item);
      const mx = r.pos.x - before.x;
      const mz = r.pos.z - before.z;
      const moved = Math.hypot(mx, mz) / Math.max(dt, 1e-3);
      // arme en main : marche dans tous les sens (le corps reste tourné vers la visée)
      const moveAngle = isGun(t.item) && moved > 0.3 ? wrap(Math.atan2(mx, mz) - r.yaw) : undefined;
      r.anim.update(dt, { speed: Math.min(t.speed, moved * 1.2 + 0.05), direction: t.dir, turnRate: moveAngle !== undefined ? 0 : step / Math.max(dt, 1e-3), grounded: t.grounded, vy: t.vy, moveAngle });
      r.anim.root.position.copy(r.pos);
      r.anim.root.rotation.y = r.yaw;
    }
  }

  // ───────────────────────── robots (solo) ─────────────────────────

  /**
   * Robots : chacun reçoit une arme à chaque apparition et garde la distance qui lui convient (fusil à pompe au
   * contact, fusil de précision de loin). Ils cherchent l'adversaire visible le plus proche, s'en approchent en se
   * décalant de côté, tirent quand ils sont tournés vers lui avec une erreur de visée selon la difficulté (et
   * visent parfois la tête), rechargent à couvert, et sinon patrouillent. Leurs balles suivent le même calcul
   * que celles du joueur : la salle décide ce qu'elles touchent.
   */
  private updateBots(dt: number, c: LocalGF) {
    const g = c.game!;
    const world = this.village.collision;
    const diff = c.opts.difficulty;
    const aimError = diff === 'facile' ? 0.06 : diff === 'normal' ? 0.035 : 0.02;
    const headChance = diff === 'facile' ? 0.05 : diff === 'normal' ? 0.15 : 0.3;
    const slow = diff === 'facile' ? 1.6 : diff === 'normal' ? 1.2 : 1;
    const reaction = diff === 'facile' ? 0.9 : diff === 'normal' ? 0.55 : 0.3;
    const now = performance.now() / 1000;
    const positions = new Map<string, THREE.Vector3>();
    if (this.player && g.players[c.me]?.alive) positions.set(c.me, this.player.root.position);
    for (const [id, b] of this.bots) if (g.players[id]?.alive) positions.set(id, b.ch.root.position);
    for (const [id, b] of this.bots) {
      const st = g.players[id];
      const ch = b.ch;
      if (!st) continue;
      if (st.spawn.n !== b.spawnN) {
        b.spawnN = st.spawn.n;
        this.placeAt(ch, st.spawn.x, st.spawn.z, st.spawn.y);
        ch.yaw = st.spawn.yaw;
        ch.root.rotation.x = 0;
        b.fall = 0;
        b.target = null;
        b.thinkAt = now + reaction;
        // équipement tiré au hasard parmi les armes permises, puis arme principale en main
        if (g.settings.arsenal === 'libre') {
          const pick = (l: GFGun[]) => {
            const ok = l.filter((w) => g.settings.weapons.includes(w));
            return ok[Math.floor(Math.random() * ok.length)] ?? null;
          };
          try {
            c.room.setLoadout(id, { primary: pick(PRIMARIES), secondary: pick(SECONDARIES) });
          } catch {
            /* partie terminée */
          }
        }
        b.weapon = c.room.allowed(id)[0];
      }
      if (!st.alive) {
        b.fall = Math.min(1, b.fall + dt / 0.6);
        ch.root.rotation.x = (-Math.PI / 2) * b.fall * b.fall;
        b.tag.visible = false;
        continue;
      }
      b.tag.visible = true;
      // armes permises (réglages, palier de progression) : il change d'arme si la sienne ne l'est plus
      if (!st.weapons.includes(b.weapon)) b.weapon = st.weapons[0] ?? 'couteau';
      const gun = isGun(b.weapon) ? b.weapon : null;
      const W = gun ? WEAPONS[gun] : null;
      const [near, far] = BOT_RANGE[b.weapon];
      const pos = ch.root.position;
      const chest = (v: THREE.Vector3) => [v.x, v.y + 1.3, v.z] as const;
      // cible : adversaire visible le plus proche (réévaluée régulièrement)
      if (now >= b.thinkAt) {
        b.thinkAt = now + 0.4;
        let best: { id: string; d: number } | null = null;
        for (const [oid, op] of positions) {
          if (oid === id) continue;
          const enemy = g.settings.mode === 'ffa' || g.teams[oid] !== g.teams[id];
          if (!enemy) continue;
          const d = pos.distanceTo(op);
          if (d > Math.min(W?.range ?? 40, 70)) continue;
          if (!world.lineClear(...chest(pos), ...chest(op))) continue;
          if (this.smokeBlocks(new THREE.Vector3(...chest(pos)), new THREE.Vector3(...chest(op)))) continue;
          if (!best || d < best.d) best = { id: oid, d };
        }
        if (best && best.id !== b.target) b.nextShot = now + reaction;
        b.target = best?.id ?? null;
      }
      const tp = b.target ? positions.get(b.target) : undefined;
      let cmd: MoveInput = { x: 0, z: 0, run: false, jump: false };
      let look: number | null = null;
      let pitch = 0;
      let fire = false;
      if (tp) {
        const dx = tp.x - pos.x;
        const dz = tp.z - pos.z;
        const d = Math.hypot(dx, dz);
        look = Math.atan2(dx, dz);
        pitch = Math.atan2(tp.y - pos.y, d);
        b.strafe += dt;
        const side = Math.sin(b.strafe * 1.3) > 0 ? 1 : -1;
        const fwd = d > far ? 1 : d < near ? -1 : 0;
        cmd = { x: (dx / d) * fwd + (-dz / d) * side * 0.8, z: (dz / d) * fwd + (dx / d) * side * 0.8, run: d > far + 8, jump: false };
        const ln = Math.hypot(cmd.x, cmd.z);
        if (ln > 1) {
          cmd.x /= ln;
          cmd.z /= ln;
        }
        if (!gun || !W) {
          // couteau : il fonce droit sur sa cible et frappe au contact
          cmd = { x: dx / d, z: dz / d, run: d > 3, jump: false };
          if (d < GF_RULES.knifeRange - 0.4 && now >= b.nextShot) {
            b.nextShot = now + GF_RULES.knifeDelay * slow;
            ch.animator.strike();
            try {
              c.room.stab(id, b.target!);
            } catch {
              /* trop tôt : il recommencera */
            }
          }
        } else if (st.grenades?.frag > 0 && d > 8 && d < 24 && now >= b.nextShot && Math.random() < dt * 0.7) {
          // de temps en temps, une grenade vers la cible
          b.nextShot = now + 1;
          const e: Vec3 = [pos.x, pos.y + 1.55, pos.z];
          const flat = Math.max(1, d);
          const vh = Math.min(16, Math.sqrt((GRENADES.gravity * flat) / Math.sin(2 * 0.6)));
          try {
            c.room.throwGrenade(id, 'frag', e, [(dx / d) * vh * Math.cos(0.6), vh * Math.sin(0.6), (dz / d) * vh * Math.cos(0.6)]);
          } catch {
            /* plus de grenade */
          }
        } else if (st.reloadUntil) {
          // à couvert pendant le rechargement : il recule
          cmd = { x: -dx / d, z: -dz / d, run: true, jump: false };
        } else if (st.ammo[gun] <= 0) c.room.reload(id, gun);
        else if (now >= b.nextShot && Math.abs(wrap(look - ch.yaw)) < 0.25) {
          b.nextShot = now + Math.max(W.fireDelay, 0.25) * slow * (0.8 + Math.random() * 0.5) + (W.auto ? 0 : 0.2);
          fire = true;
        }
      } else {
        // patrouille de point d'apparition en point d'apparition
        const [wx, wz] = b.waypoint;
        const dx = wx - pos.x;
        const dz = wz - pos.z;
        const d = Math.hypot(dx, dz);
        if (d < 2.5 || b.stuck > 1.2) {
          b.waypoint = this.randomSpawn();
          b.stuck = 0;
        } else cmd = { x: dx / d, z: dz / d, run: d > 12, jump: ch.controller.blocked && Math.random() < 0.02 };
        if (gun && W && st.ammo[gun] < W.magazine && !st.reloadUntil) c.room.reload(id, gun);
      }
      // face à sa cible, il se déplace de côté sans lui tourner le dos ; sinon il regarde où il va
      if (look !== null) b.aim = wrap(b.aim + wrap(look - b.aim) * Math.min(1, dt * 8));
      ch.aimYaw = look !== null && gun ? b.aim : null;
      ch.update(dt, cmd, look);
      if (look === null) b.aim = ch.yaw;
      if (this.confine(ch)) b.stuck += dt * 3;
      b.stuck = ch.controller.blocked && Math.hypot(cmd.x, cmd.z) > 0 ? b.stuck + dt : Math.max(0, b.stuck - dt);
      ch.animator.gunTorch = ch.animator.gunLaser = this.gear;
      ch.animator.setItem(b.weapon);
      ch.animator.aimPitch = pitch;
      ch.animator.reloading = this.reloadProgress(id, b.weapon);
      const k = ch.controller;
      c.room.pose(id, { x: k.x, y: k.y, z: k.z, yaw: ch.yaw, speed: Math.hypot(k.realVx, k.realVz), grounded: k.grounded, vy: k.vy, dir: 1, torch: this.gear, laser: this.gear, pitch, item: b.weapon });
      if (fire && tp && b.target && gun && W) {
        // visée : poitrine ou tête, avec une erreur selon la difficulté ; plombs dispersés au fusil à pompe
        const eye = new THREE.Vector3(k.x, k.y + 1.5, k.z);
        const h = this.bodyHeight(b.target);
        const aimAt = new THREE.Vector3(tp.x, tp.y + (Math.random() < headChance ? h - 0.13 : 1.2), tp.z);
        const base = aimAt.sub(eye).normalize();
        const err = new THREE.Vector3(gauss(), gauss(), gauss()).multiplyScalar(aimError);
        base.add(err).normalize();
        const dirs: Vec3[] = [];
        for (let i = 0; i < W.pellets; i++) {
          const d = base.clone();
          if (W.pellets > 1) d.add(new THREE.Vector3(gauss(), gauss(), gauss()).multiplyScalar(W.adsSpread * 0.6)).normalize();
          dirs.push([d.x, d.y, d.z]);
        }
        try {
          c.room.shoot(id, gun, [eye.x, eye.y, eye.z], dirs, []);
        } catch {
          /* cadence, rechargement : il réessaiera */
        }
      }
    }
  }

  /** Taille d'un personnage de la partie (zones de touche). */
  private bodyHeight(id: string) {
    if (id === this.client?.me) return this.player?.height ?? 1.75;
    return this.bots.get(id)?.ch.height ?? this.remotes.get(id)?.anim.base.variant.heightM ?? 1.75;
  }
}

/** Distance de combat préférée des robots selon leur arme (m). */
const BOT_RANGE: Record<GFWeapon, [number, number]> = {
  pistolet: [6, 15],
  revolver: [6, 18],
  pm: [3, 10],
  mitraillette: [4, 13],
  fusil: [9, 22],
  assaut: [10, 26],
  tactique: [16, 38],
  mitrailleuse: [10, 26],
  pompe: [2, 7],
  precision: [22, 45],
  couteau: [0, 1],
};

let puffTex: THREE.Texture | null = null;
/** Volute (fumée, boule de feu) : disque flou. */
function puffTexture() {
  if (puffTex) return puffTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,0.95)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.45)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  puffTex = new THREE.CanvasTexture(c);
  return puffTex;
}
let dotTex: THREE.Texture | null = null;
/** Point lumineux du laser (dégradé radial). */
function dotTexture() {
  if (dotTex) return dotTex;
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,60,40,1)');
  grd.addColorStop(1, 'rgba(255,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 32, 32);
  dotTex = new THREE.CanvasTexture(c);
  return dotTex;
}

const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 0.75;
