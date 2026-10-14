/**
 * Personnage en jeu : contrôleur de déplacement + animation + orientation du corps. Le même objet sert au
 * joueur et aux autres personnages (plus tard : joueurs distants) — seule la source des commandes change.
 */
import * as THREE from 'three';
import { CharacterController, type MoveInput } from './controller';
import { CharacterAnimator } from './animator';
import type { CharacterBase } from './assets';
import type { CollisionWorld } from '../village/collision';

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export class Character {
  readonly controller: CharacterController;
  readonly animator: CharacterAnimator;
  /** orientation du corps (rad, 0 = regarde vers +z) */
  yaw: number;
  private turnRate = 0;
  private visualY: number;
  /** sens de lecture du cycle (recul en vue subjective) */
  private direction: 1 | -1 = 1;
  /**
   * Arme en main : le corps reste tourné vers ce lacet (la visée) et le personnage se déplace dans tous les sens
   * (de côté, à reculons) ; les jambes suivent la marche. null : le corps se tourne vers la marche.
   */
  aimYaw: number | null = null;

  constructor(
    readonly id: string,
    base: CharacterBase,
    world: CollisionWorld,
    x: number,
    z: number,
    yaw = 0,
  ) {
    this.animator = new CharacterAnimator(base);
    this.controller = new CharacterController(world, x, z, base.variant.heightM);
    this.yaw = yaw;
    this.visualY = this.controller.y;
    this.sync();
  }

  get root() {
    return this.animator.root;
  }
  get variantId() {
    return this.animator.base.variant.id;
  }
  get height() {
    return this.animator.base.variant.heightM;
  }

  /**
   * `lookYaw` (vue subjective) : direction du regard. Le corps suit alors la marche sans tourner le dos au
   * regard : en reculant, il fait face à la caméra et le cycle de marche est joué à l'envers.
   */
  update(dt: number, input: MoveInput, lookYaw: number | null = null) {
    const c = this.controller;
    for (const e of c.update(dt, input)) {
      if (e.type === 'jump') this.animator.onJump();
      if (e.type === 'land') this.animator.onLand(e.impact);
    }
    // ── orientation du corps : vers la direction de marche, avec une vitesse de rotation bornée ──
    const vx = c.vx;
    const vz = c.vz;
    const moving = Math.hypot(vx, vz) > 0.15;
    let target = this.yaw;
    this.direction = 1;
    if (this.aimYaw !== null) target = this.aimYaw;
    else if (moving) {
      const mv = Math.atan2(vx, vz);
      target = mv;
      if (lookYaw !== null && Math.abs(wrap(mv - lookYaw)) > 1.95) {
        target = mv + Math.PI;
        this.direction = -1;
      }
    } else if (lookYaw !== null && Math.abs(wrap(lookYaw - this.yaw)) > 1.1) target = lookYaw;
    const M = c.move;
    const runK = Math.min(1, c.speed / M.runSpeed);
    const maxRate = M.turnRateIdle + (M.turnRateRun - M.turnRateIdle) * runK;
    const delta = wrap(target - this.yaw);
    const step = this.aimYaw !== null ? delta : THREE.MathUtils.clamp(delta * Math.min(1, M.turnSmoothing * dt), -maxRate * dt, maxRate * dt);
    this.yaw = wrap(this.yaw + step);
    this.turnRate = dt > 0 ? step / dt : 0;

    // la cadence suit la vitesse réellement parcourue ; en reculant, seule la composante arrière compte
    const real = Math.hypot(c.realVx, c.realVz);
    const moveAngle = this.aimYaw !== null ? wrap(Math.atan2(c.realVx, c.realVz) - this.yaw) : undefined;
    this.animator.update(dt, { speed: real, direction: this.direction, turnRate: this.aimYaw !== null ? 0 : this.turnRate, grounded: c.grounded, vy: c.vy, moveAngle });

    // marches d'escalier et seuils : le corps monte en douceur (le contrôleur, lui, est exact)
    if (c.grounded && Math.abs(c.y - this.visualY) < 0.5) this.visualY += (c.y - this.visualY) * Math.min(1, dt * 16);
    else this.visualY = c.y;
    this.sync();
  }

  /**
   * Vol libre sans collision (noclip, exploration solo) : le personnage traverse murs et planchers, flotte
   * immobile (posture d'attente) et regarde dans la direction du vol. À la sortie, la gravité le repose au sol.
   */
  fly(dt: number, vx: number, vy: number, vz: number, lookYaw: number) {
    const c = this.controller;
    c.x += vx * dt;
    c.y += vy * dt;
    c.z += vz * dt;
    c.vx = c.vz = c.vy = 0;
    c.realVx = c.realVz = 0;
    c.grounded = false;
    const delta = wrap(lookYaw - this.yaw);
    this.yaw = wrap(this.yaw + delta * Math.min(1, dt * 8));
    this.animator.update(dt, { speed: 0, direction: 1, turnRate: 0, grounded: true, vy: 0 });
    this.visualY = c.y;
    this.sync();
  }

  private sync() {
    const c = this.controller;
    this.root.position.set(c.x, this.visualY, c.z);
    this.root.rotation.y = this.yaw;
  }

  dispose() {
    this.animator.dispose();
  }
}
