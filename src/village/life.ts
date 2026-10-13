/**
 * Vie du décor, à coût quasi nul (tout se passe dans les shaders, aucune géométrie recalculée) :
 *  - les arbres, buissons et herbes ondulent au vent (déplacement des sommets selon leur hauteur) ;
 *  - des lucioles flottent dans les jardins, les vergers et à la lisière, la nuit seulement ;
 *  - la brume respire lentement (densité qui varie de quelques pour cent).
 * Le scintillement des lanternes et des âtres est géré par `atmosphere.ts`.
 */
import * as THREE from 'three';
import { heightAt, isFree } from './layout';

const uTime = { value: 0 };
const uSway = { value: 1 };

/** Ondulation au vent des matériaux de végétation (instanciés). */
function swayMaterial(m: THREE.Material) {
  if (m.userData.sway) return;
  m.userData.sway = true;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uTime;
    sh.uniforms.uSway = uSway;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uSway;').replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vec2 ip = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
      #else
        vec2 ip = vec2(0.0);
      #endif
      float hgt = clamp(position.y - 0.3, 0.0, 12.0);
      float w = pow(hgt, 1.5) * 0.0045 * uSway;
      transformed.x += (sin(uTime * 1.25 + ip.x * 0.21 + ip.y * 0.17) + 0.35 * sin(uTime * 3.1 + ip.x * 1.3)) * w;
      transformed.z += cos(uTime * 1.05 + ip.y * 0.23 + ip.x * 0.05) * w * 0.8;`,
    );
  };
  m.customProgramCacheKey = () => 'vegetation-sway';
  m.needsUpdate = true;
}

function fireflies(count: number) {
  const pos: number[] = [];
  const seed: number[] = [];
  let tries = 0;
  while (pos.length / 3 < count && tries++ < count * 40) {
    // couronne autour du village : jardins, vergers, champs, lisière (jamais dans les maisons ni sur les rues)
    const a = Math.random() * Math.PI * 2;
    const r = 25 + Math.sqrt(Math.random()) * 110;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (!isFree(x, z, 1.5)) continue;
    pos.push(x, heightAt(x, z) + 0.6 + Math.random() * 1.8, z);
    seed.push(Math.random() * 100);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('seed', new THREE.Float32BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime, uNight: { value: 1 }, uScale: { value: 300 } },
    vertexShader: `
      attribute float seed;
      uniform float uTime;
      uniform float uScale;
      varying float vGlow;
      void main() {
        vec3 p = position;
        float t = uTime * 0.35 + seed;
        p += vec3(sin(t * 1.3) * 1.2, sin(t * 2.1) * 0.35, cos(t * 0.9) * 1.2);
        vGlow = pow(max(0.0, sin(uTime * 1.7 + seed * 3.7)), 6.0);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = uScale * 0.06 / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform float uNight;
      varying float vGlow;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d) * vGlow * uNight;
        if (a < 0.01) discard;
        gl_FragColor = vec4(vec3(1.0, 0.86, 0.45) * a * 1.6, a);
      }`,
  });
  const pts = new THREE.Points(g, mat);
  pts.name = 'lucioles';
  pts.frustumCulled = false;
  return pts;
}

export class VillageLife {
  private flies: THREE.Points;
  private t = 0;
  reduceMotion = false;

  constructor(
    root: THREE.Object3D,
    private scene: THREE.Scene,
  ) {
    root.traverse((o) => {
      if (o.name.startsWith('vegetation:') && o.name !== 'vegetation:rock') swayMaterial((o as THREE.Mesh).material as THREE.Material);
    });
    this.flies = fireflies(260);
    scene.add(this.flies);
  }

  /** Une image : temps des shaders, lucioles selon la nuit, respiration de la brume (après l'atmosphère). */
  update(dt: number, daylight: number, viewportHeight: number) {
    this.t += dt;
    uTime.value = this.t;
    uSway.value = this.reduceMotion ? 0.35 : 1;
    const m = this.flies.material as THREE.ShaderMaterial;
    m.uniforms.uNight.value = THREE.MathUtils.smoothstep(1 - daylight, 0.5, 0.9);
    m.uniforms.uScale.value = viewportHeight;
    this.flies.visible = daylight < 0.5;
    const fog = this.scene.fog as THREE.FogExp2 | null;
    if (fog) fog.density *= 1 + 0.07 * Math.sin(this.t * 0.07) + 0.03 * Math.sin(this.t * 0.23);
  }
}
