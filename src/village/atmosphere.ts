/**
 * Ambiance nocturne : ciel (dégradé, nuages éclairés par la lune, étoiles, collines lointaines), lune
 * (lumière principale qui projette les ombres), éclairage ambiant discret, brouillard léger, reflets HDR.
 *
 * Lumières chaudes : le village compte des centaines de sources (lanternes, âtres, bougies). Seules les plus
 * proches de la caméra deviennent de vraies lumières dynamiques (un groupe fixe de PointLight réaffecté en
 * continu) ; les autres restent visibles par leur matériau lumineux et le halo (bloom).
 */
import * as THREE from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import type { WorldLight } from './buildings';
import { PACKED, asset } from '../characters/catalog';

export const MOON_DIR = new THREE.Vector3(-0.42, 0.55, -0.72).normalize();
export const FOG_COLOR = '#0c1322';

export function buildSky(radius = 650): THREE.Group {
  const g = new THREE.Group();
  g.name = 'ciel';
  const follow = (o: THREE.Object3D) => {
    o.frustumCulled = false;
    o.matrixAutoUpdate = false;
    o.onBeforeRender = (_r, _s, cam) => o.matrixWorld.makeTranslation(cam.position.x, 0, cam.position.z);
  };
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 48, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color('#03060f') },
        mid: { value: new THREE.Color('#0b1428') },
        horizon: { value: new THREE.Color('#1c2944') },
        moonDir: { value: MOON_DIR },
        time: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform vec3 top, mid, horizon, moonDir;
        uniform float time;
        varying vec3 vDir;
        float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
          return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
        void main() {
          float y = max(vDir.y, 0.0);
          vec3 c = mix(horizon, mid, smoothstep(0.0, 0.22, y));
          c = mix(c, top, smoothstep(0.22, 0.85, y));
          vec2 uv = vDir.xz / (vDir.y + 0.3) * 1.7 + vec2(time * 0.004, 0.0);
          float cl = n(uv) * 0.55 + n(uv * 2.2) * 0.3 + n(uv * 5.3) * 0.15;
          float clouds = smoothstep(0.5, 0.82, cl) * smoothstep(0.03, 0.3, y);
          float md = max(dot(vDir, moonDir), 0.0);
          vec3 cloudCol = mix(vec3(0.03, 0.04, 0.07), vec3(0.3, 0.34, 0.45), pow(md, 5.0));
          c = mix(c, cloudCol, clouds * 0.8);
          // halo et disque de la lune
          c += vec3(0.35, 0.42, 0.6) * pow(md, 60.0) * 0.8 * (1.0 - clouds * 0.5);
          c += vec3(0.1, 0.12, 0.18) * pow(md, 8.0) * 0.5;
          float disc = smoothstep(0.99955, 0.9997, md);
          float crater = n(vDir.xy * 900.0) * 0.25;
          c = mix(c, vec3(0.92, 0.93, 0.86) - crater, disc * (1.0 - clouds * 0.75));
          // étoiles
          vec2 sp = vDir.xz / (vDir.y + 0.05) * 110.0;
          float st = step(0.9965, h(floor(sp))) * smoothstep(0.12, 0.5, y) * (1.0 - clouds);
          st *= 0.6 + 0.4 * sin(time * 2.0 + h(floor(sp) + 3.1) * 30.0);
          c += vec3(st) * 0.7;
          gl_FragColor = vec4(c, 1.0);
        }`,
    }),
  );
  dome.renderOrder = -10;
  dome.name = 'dome';
  follow(dome);
  g.add(dome);
  // collines boisées lointaines (silhouettes en deux plans)
  for (const [R, base, amp, col, seed] of [[radius * 0.86, -4, 34, '#070c16', 1], [radius * 0.72, -6, 22, '#0a1220', 7]] as const) {
    const seg = 200;
    const pts: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const hh = base + amp * (0.45 + 0.35 * Math.sin(a * 3 + seed) * Math.cos(a * 5 - seed) + 0.2 * Math.sin(a * 17 + seed * 2));
      // dentelure des cimes
      const teeth = 2.2 * Math.abs(Math.sin(a * 140 + seed)) + 1.4 * Math.abs(Math.sin(a * 63));
      pts.push(Math.cos(a) * R, -20, Math.sin(a) * R, Math.cos(a) * R, hh + teeth, Math.sin(a) * R);
      if (i < seg) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    geo.setIndex(idx);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide, fog: false }));
    m.renderOrder = -9;
    follow(m);
    g.add(m);
  }
  return g;
}

export interface Atmosphere {
  moon: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  update(dt: number, camera: THREE.Camera, focus: THREE.Vector3, insideBuilding: string | null): void;
  setShadowQuality(level: 0 | 1 | 2): void;
  /** réaffecte les lumières dès la prochaine image (saut de caméra) */
  invalidate(): void;
  activeLights(): number;
}

export function setupAtmosphere(renderer: THREE.WebGLRenderer, scene: THREE.Scene, anchors: WorldLight[], sky: THREE.Group, poolSize = 16): Atmosphere {
  scene.fog = new THREE.FogExp2(FOG_COLOR, 0.0115);
  scene.background = new THREE.Color(FOG_COLOR);

  // reflets d'environnement : ciel nocturne HDR, très atténué
  const pmrem = new THREE.PMREMGenerator(renderer);
  // (démonstration publiée : pas de fichier HDR, reflets d'environnement omis)
  if (!PACKED) new RGBELoader().load(
    asset('textures/moonless_golf_1k.hdr'),
    (hdr) => {
      scene.environment = pmrem.fromEquirectangular(hdr).texture;
      scene.environmentIntensity = 0.22;
      hdr.dispose();
      pmrem.dispose();
    },
    undefined,
    () => pmrem.dispose(),
  );

  const hemi = new THREE.HemisphereLight('#5d6f9c', '#16130f', 0.65);
  scene.add(hemi);
  const moon = new THREE.DirectionalLight('#a9bce8', 1.35);
  moon.castShadow = true;
  moon.shadow.mapSize.set(2048, 2048);
  const S = 75;
  Object.assign(moon.shadow.camera, { left: -S, right: S, top: S, bottom: -S, near: 1, far: 400 });
  moon.shadow.bias = -0.0004;
  moon.shadow.normalBias = 0.05;
  scene.add(moon, moon.target);

  // groupe fixe de lumières chaudes (aucune recompilation des matériaux quand elles changent de place)
  const pool: THREE.PointLight[] = [];
  for (let i = 0; i < poolSize; i++) {
    const l = new THREE.PointLight('#ffb056', 0, 12, 2);
    l.castShadow = false;
    pool.push(l);
    scene.add(l);
  }
  const assigned: (WorldLight | null)[] = new Array(poolSize).fill(null);
  let t = 0;
  let reassign = 0;
  const tmp = new THREE.Vector3();
  const domeMat = (sky.getObjectByName('dome') as THREE.Mesh).material as THREE.ShaderMaterial;

  return {
    moon,
    hemi,
    update(dt, camera, focus, inside) {
      t += dt;
      // brume au ras du sol : plus dense dans les rues, plus légère vue de haut (le village reste lisible)
      (scene.fog as THREE.FogExp2).density = THREE.MathUtils.lerp(0.0115, 0.0026, THREE.MathUtils.smoothstep(camera.position.y, 12, 90));
      domeMat.uniforms.time.value = t;
      // la carte d'ombre de la lune suit la zone regardée (alignée sur les texels pour éviter le scintillement)
      const snap = (v: number) => Math.round(v / 0.5) * 0.5;
      moon.target.position.set(snap(focus.x), snap(focus.y), snap(focus.z));
      moon.position.copy(moon.target.position).addScaledVector(MOON_DIR, 160);
      reassign -= dt;
      if (reassign <= 0) {
        reassign = 0.2;
        const cam = camera.position;
        const scored = anchors
          .filter((a) => !a.indoor || (inside !== null ? a.building === inside : tmp.set(a.x, a.y, a.z).distanceTo(cam) < 22))
          .map((a) => {
            const d = tmp.set(a.x, a.y, a.z).distanceTo(cam);
            // les lumières de la pièce où l'on se trouve passent en priorité
            return { a, d: a.indoor && a.building === inside ? d * 0.3 : d };
          })
          .sort((p, q) => p.d - q.d)
          .slice(0, poolSize);
        for (let i = 0; i < poolSize; i++) {
          const s = scored[i];
          assigned[i] = s ? s.a : null;
          if (s) {
            pool[i].position.set(s.a.x, s.a.y, s.a.z);
            pool[i].color.set(s.a.color);
            pool[i].distance = s.a.distance;
          }
        }
      }
      for (let i = 0; i < poolSize; i++) {
        const a = assigned[i];
        if (!a) {
          pool[i].intensity = 0;
          continue;
        }
        const f = a.flicker ? 0.88 + 0.08 * Math.sin(t * 9.1 + i * 1.7) + 0.04 * Math.sin(t * 23.3 + i * 4.1) : 1;
        // fondu en bordure du groupe : pas d'apparition brutale quand une lumière entre ou sort
        const d = tmp.set(a.x, a.y, a.z).distanceTo(camera.position);
        const fade = 1 - THREE.MathUtils.smoothstep(d, 55, 80);
        pool[i].intensity = a.intensity * f * fade;
      }
    },
    setShadowQuality(level) {
      moon.castShadow = level < 2;
      const size = level === 0 ? 4096 : 2048;
      if (moon.shadow.mapSize.x !== size) {
        moon.shadow.mapSize.set(size, size);
        moon.shadow.map?.dispose();
        moon.shadow.map = null as unknown as THREE.WebGLRenderTarget;
      }
    },
    invalidate() {
      reassign = 0;
    },
    activeLights() {
      return assigned.filter(Boolean).length;
    },
  };
}
