/**
 * Contrôleur de déplacement d'un personnage (joueur ou personnage non joueur) : vitesse au sol avec
 * accélération, passage progressif marche ↔ course, freinage, demi-tours, saut (gravité, impulsion, contrôle
 * aérien limité), marches et escaliers, collisions. Simulation à pas fixe : même trajectoire à 30 ou 144 images/s.
 *
 * Aucune dépendance au rendu : la vitesse RÉELLE (après collisions) est exposée pour régler la cadence des
 * jambes ; contre un mur, elle tombe à zéro et le personnage cesse de marcher sur place.
 */
import { JUMP, MOVE } from './config';
import type { CollisionWorld } from '../village/collision';

export interface MoveInput {
  /** direction voulue dans le plan horizontal (monde), longueur ≤ 1 */
  x: number;
  z: number;
  run: boolean;
  /** vrai à l'image où Espace est enfoncé (front montant), jamais en maintien */
  jump: boolean;
}

export type MoveEvent = { type: 'jump' } | { type: 'land'; impact: number } | { type: 'fall' };

export class CharacterController {
  x: number;
  y: number;
  z: number;
  /** vitesse horizontale voulue (m/s) */
  vx = 0;
  vz = 0;
  /** vitesse verticale (m/s) */
  vy = 0;
  grounded = true;
  /** vitesse horizontale réellement parcourue au dernier pas (après collisions) */
  speed = 0;
  /** vitesse réelle par axe */
  realVx = 0;
  realVz = 0;
  /** le personnage pousse contre un obstacle */
  blocked = false;
  private coyote = 0;
  private jumpBuffer = 0;
  private cooldown = 0;
  private acc = 0;
  private events: MoveEvent[] = [];
  /** dernière entrée (maintenue entre deux pas fixes) */
  private input: MoveInput = { x: 0, z: 0, run: false, jump: false };

  constructor(
    readonly world: CollisionWorld,
    x: number,
    z: number,
    readonly height: number,
    y?: number,
  ) {
    this.x = x;
    this.z = z;
    this.y = y ?? world.groundAt(x, z, 1e6);
  }

  /** Avance la simulation de `dt` secondes ; retourne les évènements (saut, atterrissage). */
  update(dt: number, input: MoveInput): MoveEvent[] {
    this.input = { ...input, jump: false };
    if (input.jump) this.jumpBuffer = JUMP.bufferTime;
    this.events = [];
    this.acc += Math.min(dt, 0.1);
    const h = MOVE.fixedStep;
    let distance = 0;
    let steps = 0;
    let rx = 0;
    let rz = 0;
    while (this.acc >= h) {
      this.acc -= h;
      const [dx, dz] = this.step(h);
      distance += Math.hypot(dx, dz);
      rx += dx;
      rz += dz;
      steps++;
    }
    if (steps > 0) {
      this.speed = distance / (steps * h);
      this.realVx = rx / (steps * h);
      this.realVz = rz / (steps * h);
    }
    return this.events;
  }

  private step(h: number): [number, number] {
    const inp = this.input;
    const len = Math.hypot(inp.x, inp.z);
    const dirX = len > 1e-3 ? inp.x / Math.max(1, len) : 0;
    const dirZ = len > 1e-3 ? inp.z / Math.max(1, len) : 0;
    const top = inp.run ? MOVE.runSpeed : MOVE.walkSpeed;
    // vitesse visée : la diagonale n'est jamais plus rapide (direction normalisée)
    const tx = dirX * top;
    const tz = dirZ * top;
    const cur = Math.hypot(this.vx, this.vz);
    const want = Math.hypot(tx, tz);
    // taux d'accélération selon la situation (démarrage, passage à la course, retour à la marche, arrêt, demi-tour)
    let rate: number;
    if (want < 1e-3) rate = cur > MOVE.walkSpeed + 0.1 ? MOVE.runDecel : MOVE.decel;
    else if (cur > 0.3 && (this.vx * tx + this.vz * tz) / (cur * want) < -0.3) rate = MOVE.reverseDecel;
    else if (want > cur + 0.05) rate = cur >= MOVE.walkSpeed - 0.1 ? MOVE.runAccel : MOVE.accel;
    else if (want < cur - 0.05) rate = MOVE.runDecel;
    else rate = MOVE.accel;
    if (!this.grounded) rate *= JUMP.airControl;
    const ddx = tx - this.vx;
    const ddz = tz - this.vz;
    const dd = Math.hypot(ddx, ddz);
    if (dd > 1e-6) {
      const s = Math.min(dd, rate * h);
      this.vx += (ddx / dd) * s;
      this.vz += (ddz / dd) * s;
    }
    if (want < 1e-3 && Math.hypot(this.vx, this.vz) < 0.03) this.vx = this.vz = 0;

    // ── saut ──
    this.cooldown = Math.max(0, this.cooldown - h);
    this.jumpBuffer = Math.max(0, this.jumpBuffer - h);
    this.coyote = this.grounded ? JUMP.coyoteTime : Math.max(0, this.coyote - h);
    if (this.jumpBuffer > 0 && this.coyote > 0 && this.cooldown <= 0) {
      // n'autorise le saut que s'il y a la place au-dessus de la tête
      const ceil = this.world.ceilingAt(this.x, this.z, this.y);
      if (ceil - (this.y + this.height) > 0.12) {
        this.vy = Math.sqrt(2 * JUMP.gravity * Math.min(JUMP.height, ceil - (this.y + this.height) - 0.05));
        this.grounded = false;
        this.coyote = 0;
        this.jumpBuffer = 0;
        this.cooldown = JUMP.cooldown;
        this.events.push({ type: 'jump' });
      }
    }

    // ── déplacement horizontal avec collisions ──
    const ox = this.x;
    const oz = this.z;
    let nx = this.x + this.vx * h;
    let nz = this.z + this.vz * h;
    // marche franchissable : la nouvelle position se pose-t-elle sur un sol accessible ?
    const stepTop = this.grounded ? this.y + MOVE.stepUp : this.y + 0.05;
    const r = this.world.resolve(nx, nz, MOVE.radius, this.y + (this.grounded ? MOVE.stepUp * 0.6 : 0), this.height - 0.1);
    nx = r.x;
    nz = r.z;
    const g = this.world.groundAt(nx, nz, stepTop);
    if (g === -Infinity || (this.grounded && g < this.y - 3)) {
      // bord d'un vide : on autorise la chute (trémie, rebord) — sauf hors du monde
      if (g === -Infinity && this.world.groundAt(nx, nz, 1e6) === -Infinity) {
        nx = ox;
        nz = oz;
      }
    }
    this.x = nx;
    this.z = nz;
    this.blocked = r.hit;
    if (r.hit) {
      // la composante de vitesse dirigée vers l'obstacle tombe : on glisse le long du mur
      const nl = Math.hypot(r.nx, r.nz);
      if (nl > 1e-6) {
        const ux = r.nx / nl;
        const uz = r.nz / nl;
        const into = this.vx * ux + this.vz * uz;
        if (into < 0) {
          this.vx -= into * ux;
          this.vz -= into * uz;
        }
      }
    }

    // ── vertical : gravité, sol, plafond ──
    const ground = this.world.groundAt(this.x, this.z, (this.grounded ? this.y + MOVE.stepUp : this.y) + 1e-4);
    if (this.grounded) {
      if (ground !== -Infinity && this.y - ground <= MOVE.stepDown) {
        // marche montante ou descendante : on reste au sol
        this.y = ground;
        this.vy = 0;
      } else {
        this.grounded = false;
        this.vy = 0;
        this.events.push({ type: 'fall' });
      }
    }
    if (!this.grounded) {
      this.vy = Math.max(-JUMP.maxFall, this.vy - JUMP.gravity * h);
      let ny = this.y + this.vy * h;
      const ceil = this.world.ceilingAt(this.x, this.z, this.y);
      if (this.vy > 0 && ny + this.height > ceil) {
        ny = ceil - this.height;
        this.vy = 0;
      }
      const floor = this.world.groundAt(this.x, this.z, Math.max(this.y, ny) + 1e-4);
      if (this.vy <= 0 && floor !== -Infinity && ny <= floor) {
        const impact = -this.vy;
        this.y = floor;
        this.vy = 0;
        this.grounded = true;
        this.events.push({ type: 'land', impact });
      } else this.y = ny;
    }
    return [this.x - ox, this.z - oz];
  }

  /** Téléporte (apparition) en posant le personnage au sol. */
  place(x: number, z: number) {
    this.x = x;
    this.z = z;
    this.y = this.world.groundAt(x, z, 1e6);
    this.vx = this.vz = this.vy = 0;
    this.grounded = true;
  }
}
