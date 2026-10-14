/**
 * Visionneuse d'inspection du village (pas de personnage jouable) : rendu, post-traitement, deux modes de
 * caméra (orbite pour la vue d'ensemble, vol libre pour parcourir les rues et les intérieurs), points de vue
 * prédéfinis, toits masquables, qualité graphique réglable.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { BUILDINGS, heightAt, insideBuilding, roadDistance } from './layout';
import { buildSky, setupAtmosphere, type Atmosphere } from './atmosphere';
import { SHAFTS, UNDER, undergroundPlace } from './underground';
import type { Village } from './village';
import type { Input } from '../input';

export type Quality = 0 | 1 | 2;
export type RoofMode = 'auto' | 'visible' | 'masque';
export type CamMode = 'orbite' | 'vol';

export interface Viewpoint {
  id: string;
  label: string;
  group: 'Extérieurs' | 'Intérieurs';
  mode: CamMode;
  pos: THREE.Vector3;
  target: THREE.Vector3;
}

export function viewpoints(village: Village): Viewpoint[] {
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const ext: Viewpoint[] = [
    { id: 'place', label: 'Place centrale', group: 'Extérieurs', mode: 'orbite', pos: v(6.5, 6.2, 21), target: v(-2, 2.2, -10) },
    { id: 'ensemble', label: "Vue d'ensemble", group: 'Extérieurs', mode: 'orbite', pos: v(105, 95, 125), target: v(0, 0, -18) },
    { id: 'grand-rue', label: 'Grand-Rue (commerces)', group: 'Extérieurs', mode: 'vol', pos: v(23, 2.2, 1.8), target: v(62, 2.6, 2.4) },
    { id: 'residentiel', label: 'Quartier résidentiel', group: 'Extérieurs', mode: 'vol', pos: v(-27, 2.2, 7.5), target: v(-60, 2.6, 11) },
    { id: 'jardins', label: 'Ruelle des Jardins', group: 'Extérieurs', mode: 'vol', pos: v(-45.5, 2.1, 9), target: v(-46, 2.3, 40) },
    { id: 'eglise', label: 'Église et cimetière', group: 'Extérieurs', mode: 'orbite', pos: v(-2, 13, -50), target: v(-4, 7, -96) },
    { id: 'sherif', label: 'Poste du shérif', group: 'Extérieurs', mode: 'vol', pos: v(-10, 2.4, -66), target: v(-30, 3, -74) },
    { id: 'abords', label: 'Écuries, grange et ferme', group: 'Extérieurs', mode: 'orbite', pos: v(86, 12, 12), target: v(115, 2, 45) },
    { id: 'abandonnee', label: 'Maison abandonnée', group: 'Extérieurs', mode: 'vol', pos: v(-82, 2.6, -55), target: v(-101, 3.5, -66.5) },
    { id: 'foret', label: 'Lisière de la forêt', group: 'Extérieurs', mode: 'vol', pos: v(-118, 2.0, 47), target: v(-80, 3.5, 36) },
  ];
  // intérieurs : coordonnées dans le repère local du bâtiment (y = 0 au plancher du rez-de-chaussée)
  const ins = (id: string, label: string, pos: [number, number, number], target: [number, number, number]): Viewpoint => {
    const m = village.buildings.find((b) => b.spec.id === id)!.matrix;
    return { id: `in-${id}-${label}`, label, group: 'Intérieurs', mode: 'vol', pos: new THREE.Vector3(...pos).applyMatrix4(m), target: new THREE.Vector3(...target).applyMatrix4(m) };
  };
  const F = UNDER.floor;
  const sh = (id: string) => SHAFTS.find((s) => s.id === id)!;
  const m = sh('mausolee');
  const under: Viewpoint[] = [
    { id: 'u-conseil', label: 'Souterrains — Salle du Conseil secret', group: 'Intérieurs', mode: 'vol', pos: v(-9, F + 1.75, -31), target: v(0, F + 0.7, -38.5) },
    { id: 'u-geoles', label: 'Souterrains — Geôles oubliées', group: 'Intérieurs', mode: 'vol', pos: v(-31, F + 1.7, -58), target: v(-47, F + 1.0, -58) },
    { id: 'u-citerne', label: 'Souterrains — Citerne', group: 'Intérieurs', mode: 'vol', pos: v(13, F + 2.0, 23), target: v(28, F + 0.2, 35) },
    { id: 'u-crypte', label: 'Souterrains — Crypte des Aubin', group: 'Intérieurs', mode: 'vol', pos: v(9, F + 1.9, -97), target: v(21, F + 0.4, -107) },
    { id: 'u-galerie', label: 'Souterrains — galerie sous la place', group: 'Intérieurs', mode: 'vol', pos: v(-4, F + 1.7, -12), target: v(-4, F + 1.4, 20) },
    { id: 'u-chapelle', label: 'Souterrains — Chapelle des Pénitents', group: 'Intérieurs', mode: 'vol', pos: v(-86, F + 1.8, -29), target: v(-86, F + 0.8, -41) },
    { id: 'e-mausolee', label: 'Entrée secrète — Mausolée', group: 'Extérieurs', mode: 'orbite', pos: v(m.x + 7, m.ground + 3.5, m.z + 9), target: v(m.x, m.ground + 1.2, m.z + 0.5) },
    { id: 'e-verger', label: 'Entrée secrète — puits du verger', group: 'Extérieurs', mode: 'orbite', pos: v(sh('verger').x + 4, sh('verger').ground + 2.6, sh('verger').z + 5), target: v(sh('verger').x, sh('verger').ground + 0.5, sh('verger').z) },
  ];
  return [
    ...ext,
    ...under,
    ins('taverne', 'Taverne — grande salle', [-5.6, 1.7, 4.4], [5.5, 1.1, -0.5]),
    ins('taverne', 'Taverne — cave', [-3, -0.85, 3.5], [5, -1.8, -3]),
    ins('taverne', 'Taverne — étage', [-6.2, 3.4 + 1.65, -2.5], [6, 3.4 + 1.2, -2.6]),
    ins('forge', 'Forge — atelier', [0.6, 1.7, 3.7], [-2.6, 0.9, -3.6]),
    ins('apothicaire', 'Apothicairerie', [0.3, 1.65, 3.0], [-1.8, 1.2, -3]),
    ins('eglise', 'Église — nef', [0, 1.75, 10.5], [0, 2.4, -11]),
    ins('eglise', 'Clocher — chambre des cloches', [-1.2, 13.4 + 1.8, 12.7], [0.4, 13.4 + 1.0, 30]),
    ins('sherif', 'Poste du shérif', [-3.2, 1.7, 3.6], [1.5, 1.2, -3.6]),
    ins('ecuries', 'Écuries', [-6.5, 1.75, 2.6], [3, 0.9, -2.8]),
    ins('grange', 'Grange', [0, 1.8, 6.5], [0, 2.2, -6]),
    ins('abandonnee', 'Maison abandonnée — étage', [-3.2, 3.1 + 1.6, 2.5], [2, 3.1 + 1.0, -2.6]),
    ins('drapier', 'Maison du Drapier', [-3.1, 1.65, 3.2], [2.5, 1.1, -2.8]),
  ];
}

export class VillageView {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private ao: GTAOPass;
  private orbit: OrbitControls;
  private atmo: Atmosphere;
  private clock = new THREE.Clock();
  /** pilote de la caméra en mode jeu (personnage) ; null = inspection */
  driver: { update(dt: number): void } | null = null;
  /** lumière du jour (0 nuit, 1 jour) fournie par la partie en cours ; nuit en inspection */
  daylightSource: (() => number) | null = null;
  /** appelé à chaque image après l'atmosphère, avant le rendu (vie du décor, sons d'ambiance) */
  afterAtmosphere: ((dt: number, daylight: number) => void) | null = null;
  private yaw = 0;
  private pitch = 0;
  private flySpeed = 6;
  private tween: { from: [THREE.Vector3, THREE.Vector3]; to: [THREE.Vector3, THREE.Vector3]; t: number } | null = null;
  private dragging = false;
  private lastPointer = { x: 0, y: 0 };
  private insideId: string | null = null;
  private lastInside: string | null = null;
  quality: Quality = 1;
  roofMode: RoofMode = 'auto';
  mode: CamMode = 'orbite';
  readonly views: Viewpoint[];
  onInfo: (info: { place: string; fps: number; calls: number; tris: number; lights: number }) => void = () => {};
  fpsAcc = { n: 0, t: 0, fps: 60 };
  private disposed = false;
  /** boucle suspendue (captures de contrôle : rendu image par image avec `renderFrame`) */
  paused = false;

  constructor(
    readonly container: HTMLElement,
    readonly village: Village,
    readonly input: Input,
  ) {
    const r = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
    r.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.shadowMap.enabled = true;
    r.info.autoReset = false;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(r.domElement);
    this.renderer = r;
    this.camera = new THREE.PerspectiveCamera(58, 1, 0.08, 1200);
    const sky = buildSky();
    this.scene.add(sky, village.root);
    this.atmo = setupAtmosphere(r, this.scene, village.lights, sky);

    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(r, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.ao = new GTAOPass(this.scene, this.camera, 1, 1);
    this.ao.blendIntensity = 0.8;
    this.ao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1.2, scale: 1.1, samples: 10, distanceFallOff: 1 });
    this.ao.enabled = false;
    this.composer.addPass(this.ao);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.5, 0.82);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.orbit = new OrbitControls(this.camera, r.domElement);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.08;
    this.orbit.maxPolarAngle = Math.PI * 0.495;
    this.orbit.minDistance = 1.5;
    this.orbit.maxDistance = 320;
    this.orbit.screenSpacePanning = false;

    this.views = viewpoints(village);
    this.goTo(this.views[0], true);
    this.bind();
    this.resize();
    this.setQuality(1);
    r.setAnimationLoop(() => {
      if (!this.paused) this.frame();
    });
  }

  // ───────────── caméra ─────────────

  setMode(m: CamMode) {
    if (m === this.mode) return;
    this.mode = m;
    this.orbit.enabled = m === 'orbite';
    if (m === 'vol') this.syncYawPitch();
    else {
      // l'orbite reprend autour du point regardé, à quelques mètres devant
      const dir = new THREE.Vector3();
      this.camera.getWorldDirection(dir);
      this.orbit.target.copy(this.camera.position).addScaledVector(dir, 12);
      this.orbit.update();
    }
  }

  private syncYawPitch() {
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    this.yaw = Math.atan2(-dir.x, -dir.z);
    this.pitch = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1));
  }

  goTo(v: Viewpoint, instant = false) {
    this.setMode(v.mode);
    this.atmo.invalidate();
    if (instant) {
      this.camera.position.copy(v.pos);
      this.camera.lookAt(v.target);
      this.orbit.target.copy(v.target);
      this.orbit.update();
      this.syncYawPitch();
      return;
    }
    const curTarget = this.mode === 'orbite' ? this.orbit.target.clone() : this.camera.position.clone().add(this.camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(10));
    this.tween = { from: [this.camera.position.clone(), curTarget], to: [v.pos.clone(), v.target.clone()], t: 0 };
  }

  setRoofMode(m: RoofMode) {
    this.roofMode = m;
  }

  setQuality(q: Quality) {
    this.quality = q;
    this.ao.enabled = q === 0;
    this.bloom.enabled = q < 2;
    this.renderer.shadowMap.enabled = q < 2;
    this.atmo.setShadowQuality(q);
    this.renderer.setPixelRatio(q === 2 ? 1 : Math.min(window.devicePixelRatio, q === 0 ? 2 : 1.5));
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m) m.needsUpdate = true;
    });
    this.resize();
  }

  // ───────────── entrées ─────────────

  private bind() {
    const el = this.renderer.domElement;
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => {
      if (this.mode !== 'vol' || this.driver) return;
      this.dragging = true;
      this.lastPointer = { x: e.clientX, y: e.clientY };
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (!this.dragging || this.mode !== 'vol') return;
      const dx = e.clientX - this.lastPointer.x;
      const dy = e.clientY - this.lastPointer.y;
      this.lastPointer = { x: e.clientX, y: e.clientY };
      this.yaw -= dx * 0.0035;
      this.pitch = THREE.MathUtils.clamp(this.pitch - dy * 0.0035, -1.45, 1.45);
      this.tween = null;
    });
    el.addEventListener('pointerup', () => (this.dragging = false));
    el.addEventListener(
      'wheel',
      (e) => {
        if (this.mode === 'vol' && !this.driver) {
          this.flySpeed = THREE.MathUtils.clamp(this.flySpeed * (e.deltaY > 0 ? 0.85 : 1.18), 1, 60);
          e.preventDefault();
        }
      },
      { passive: false },
    );
    window.addEventListener('resize', this.onResize);
  }

  /** Raccourcis de l'inspection (lus dans le gestionnaire d'entrées unique). */
  private inspectionKeys() {
    const i = this.input;
    if (i.consume('KeyF')) this.setMode(this.mode === 'vol' ? 'orbite' : 'vol');
    if (i.consume('KeyR')) this.setRoofMode(this.roofMode === 'auto' ? 'masque' : this.roofMode === 'masque' ? 'visible' : 'auto');
    const moving = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'KeyC'].some((k) => i.held(k));
    if (moving && this.mode === 'orbite') this.setMode('vol');
    if (moving) this.tween = null;
  }
  private onResize = () => this.resize();

  resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    this.ao.setSize(Math.floor((w * this.renderer.getPixelRatio()) / 2), Math.floor((h * this.renderer.getPixelRatio()) / 2));
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ───────────── boucle ─────────────

  private frame() {
    if (this.disposed) return;
    const dt = Math.min(0.05, this.clock.getDelta());
    const cam = this.camera;
    this.orbit.enabled = !this.driver && this.mode === 'orbite';

    if (this.driver) {
      this.tween = null;
      this.driver.update(dt);
    } else this.inspectionKeys();
    if (this.driver) {
      // caméra placée par le jeu
    } else if (this.tween) {
      this.tween.t = Math.min(1, this.tween.t + dt / 1.3);
      const k = this.tween.t * this.tween.t * (3 - 2 * this.tween.t);
      cam.position.lerpVectors(this.tween.from[0], this.tween.to[0], k);
      const tgt = new THREE.Vector3().lerpVectors(this.tween.from[1], this.tween.to[1], k);
      cam.lookAt(tgt);
      this.orbit.target.copy(tgt);
      if (this.tween.t >= 1) {
        this.tween = null;
        this.syncYawPitch();
      }
    } else if (this.mode === 'vol') {
      cam.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
      const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      const mv = new THREE.Vector3();
      if (this.input.held('KeyW') || this.input.held('ArrowUp')) mv.add(fwd);
      if (this.input.held('KeyS') || this.input.held('ArrowDown')) mv.sub(fwd);
      if (this.input.held('KeyD') || this.input.held('ArrowRight')) mv.add(right);
      if (this.input.held('KeyA') || this.input.held('ArrowLeft')) mv.sub(right);
      if (this.input.held('Space') || this.input.held('KeyE')) mv.y += 1;
      if (this.input.held('KeyC') || this.input.held('KeyQ')) mv.y -= 1;
      if (mv.lengthSq() > 0) {
        const fast = this.input.held('ShiftLeft') || this.input.held('ShiftRight') ? 3 : 1;
        cam.position.addScaledVector(mv.normalize(), this.flySpeed * fast * dt);
      }
    } else this.orbit.update();

    // jamais sous le sol (sauf dans une cave : le terrain y est percé)
    const ground = heightAt(cam.position.x, cam.position.z);
    const inCellar = this.village.buildings.some((b) => b.cellarHole && insideBuilding(b.spec, cam.position.x, cam.position.z, -0.3));
    const inGallery = undergroundPlace(cam.position.x, cam.position.y, cam.position.z) !== null;
    if (!this.driver && !inCellar && !inGallery && cam.position.y < ground + 0.35) cam.position.y = ground + 0.35;

    // dans quel bâtiment est la caméra ? (toits auto, lumières intérieures prioritaires)
    this.insideId = null;
    for (const b of this.village.buildings) {
      if (!insideBuilding(b.spec, cam.position.x, cam.position.z, -0.15)) continue;
      const fy = new THREE.Vector3().setFromMatrixPosition(b.matrix).y;
      if (cam.position.y > fy - 3 && cam.position.y < fy + b.plan.wallTop + 0.2) this.insideId = b.spec.id;
    }
    // toits « auto » : masqués seulement quand la caméra survole le bâtiment (vue en coupe des étages) ;
    // à hauteur d'homme, à l'intérieur comme dans la rue, les toits et les plafonds restent en place
    for (const b of this.village.buildings) {
      const d = Math.hypot(cam.position.x - b.spec.x, cam.position.z - b.spec.z);
      const eaves = new THREE.Vector3().setFromMatrixPosition(b.matrix).y + b.plan.wallTop;
      const over = cam.position.y > eaves + 1 && d < Math.max(b.spec.w, b.spec.d) / 2 + 5;
      b.roof.visible = this.roofMode === 'visible' ? true : this.roofMode === 'masque' ? false : !over;
      b.interior.visible = d < 55;
    }
    // sous terre : les galeries deviennent « la pièce » (lanternes prioritaires, ni ciel ni lune) ;
    // en surface, elles ne sont dessinées que près d'une entrée
    const under = cam.position.y < UNDER.floor + UNDER.height + 1 || (undergroundPlace(cam.position.x, cam.position.y, cam.position.z) !== null && cam.position.y < heightAt(cam.position.x, cam.position.z) - 0.5);
    if (under) this.insideId = 'souterrain';
    this.atmo.setUnderground(under);
    this.village.underground.visible = under || cam.position.y < -1 || SHAFTS.some((s) => Math.hypot(s.x - cam.position.x, s.z - cam.position.z) < 30);
    if (this.insideId !== this.lastInside) {
      this.lastInside = this.insideId;
      this.atmo.invalidate();
    }

    const daylight = this.daylightSource?.() ?? 0;
    this.atmo.setDaylight(daylight);
    this.bloom.strength = THREE.MathUtils.lerp(0.55, 0.18, daylight);
    const focus = this.mode === 'orbite' ? this.orbit.target : cam.position.clone().add(cam.getWorldDirection(new THREE.Vector3()).multiplyScalar(25));
    this.atmo.update(dt, cam, focus, this.insideId);
    this.afterAtmosphere?.(dt, daylight);

    this.renderer.info.reset();
    if (this.quality === 2) this.renderer.render(this.scene, cam);
    else this.composer.render(dt);

    this.fpsAcc.n++;
    this.fpsAcc.t += dt;
    if (this.fpsAcc.t > 0.5) {
      this.fpsAcc.fps = this.fpsAcc.n / this.fpsAcc.t;
      this.fpsAcc = { n: 0, t: 0, fps: this.fpsAcc.fps };
      const info = this.renderer.info.render;
      this.onInfo({ place: this.placeName(), fps: this.fpsAcc.fps, calls: info.calls, tris: info.triangles, lights: this.atmo.activeLights() });
    }
  }

  /** Calcule et rend une image (boucle suspendue). */
  renderFrame() {
    this.frame();
  }

  /** Nom du lieu où se trouve la caméra. */
  placeName(): string {
    return this.placeAt(this.camera.position);
  }

  /** Nom du lieu en un point : bâtiment (s'il est dedans), place, rue, ou bâtiment le plus proche. */
  placeAt(p: THREE.Vector3): string {
    const u = undergroundPlace(p.x, p.y + 0.5, p.z);
    if (u) return u;
    for (const b of this.village.buildings) {
      if (!insideBuilding(b.spec, p.x, p.z, -0.15)) continue;
      const fy = b.matrix.elements[13];
      if (p.y > fy - 3 && p.y < fy + b.plan.wallTop + 0.5) return b.spec.name;
    }
    const rd = roadDistance(p.x, p.z);
    if (Math.hypot(p.x, p.z) < 17) return 'Place centrale';
    if (rd.road && rd.d < 4) return rd.road.name;
    let best = '';
    let bd = Infinity;
    for (const b of BUILDINGS) {
      const d = Math.hypot(p.x - b.x, p.z - b.z);
      if (d < bd) {
        bd = d;
        best = b.name;
      }
    }
    if (bd < 25) return `Près de : ${best}`;
    return p.y > 40 ? 'Au-dessus du village' : 'Abords du village';
  }

  dispose() {
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    window.removeEventListener('resize', this.onResize);
    this.renderer.dispose();
  }
}

