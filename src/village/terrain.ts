/**
 * Terrain du village : maillage en relief (aplani sous les bâtiments, la place et le parvis), et un seul matériau
 * qui mélange herbe, terre battue et pavés selon une carte de répartition peinte à partir du plan (rues, places,
 * cours, jardins). Aucun raccord visible entre le sol et les rues : tout est dans le même maillage.
 * Les caves percent le terrain (le sol n'apparaît pas au plafond d'une cave).
 */
import * as THREE from 'three';
import { BUILDINGS, CEMETERY, CHURCH_SQUARE, GARDENS, PATHS, PLAZA, WORLD_HALF, heightAt, localToWorld, rng, type P2 } from './layout';
import { VM } from './textures';

const SPLAT_SIZE = 2048;

/** Carte de répartition : rouge = pavés, vert = terre battue (le reste est de l'herbe). */
function splatCanvas(doors: { x: number; z: number; nx: number; nz: number; w: number }[]) {
  const c = document.createElement('canvas');
  c.width = c.height = SPLAT_SIZE;
  const x = c.getContext('2d')!;
  const k = SPLAT_SIZE / (WORLD_HALF * 2);
  const P = (p: P2): [number, number] => [(p[0] + WORLD_HALF) * k, (p[1] + WORLD_HALF) * k];
  x.fillStyle = '#000';
  x.fillRect(0, 0, SPLAT_SIZE, SPLAT_SIZE);
  x.lineCap = 'round';
  x.lineJoin = 'round';
  const r = rng(77);
  const poly = (pts: P2[], style: string, grow = 0) => {
    x.fillStyle = style;
    x.strokeStyle = style;
    x.lineWidth = grow * 2 * k;
    x.beginPath();
    pts.forEach((p, i) => (i ? x.lineTo(...P(p)) : x.moveTo(...P(p))));
    x.closePath();
    x.fill();
    if (grow) x.stroke();
  };
  // 1) terre battue : bas-côtés des rues, abords des maisons, jardins, cour de ferme
  x.globalCompositeOperation = 'lighter';
  for (const p of PATHS) {
    const wide = p.road.kind === 'street' || p.road.kind === 'lane' ? 1.6 : 0.4;
    x.strokeStyle = `rgba(0,${p.road.kind === 'path' ? 150 : 255},0,1)`;
    for (let pass = 0; pass < 3; pass++) {
      x.lineWidth = (p.road.width + wide + pass * 0.6 + r() * 0.4) * k;
      x.globalAlpha = pass === 0 ? 1 : 0.35;
      x.beginPath();
      p.pts.forEach((q, i) => {
        const j = (r() - 0.5) * 0.35;
        const [px, pz] = P([q[0] + j, q[1] - j]);
        if (i) x.lineTo(px, pz);
        else x.moveTo(px, pz);
      });
      x.stroke();
    }
  }
  x.globalAlpha = 1;
  // abords des bâtiments : sol tassé au pied des murs et devant les portes
  for (const b of BUILDINGS) {
    const m = b.kind === 'barn' || b.kind === 'stable' ? 3.5 : 1.2;
    const pts: P2[] = [localToWorld(b, -b.w / 2 - m, -b.d / 2 - m), localToWorld(b, b.w / 2 + m, -b.d / 2 - m), localToWorld(b, b.w / 2 + m, b.d / 2 + m + b.jetty), localToWorld(b, -b.w / 2 - m, b.d / 2 + m + b.jetty)];
    poly(pts, 'rgba(0,140,0,1)', 0.6);
  }
  for (const d of doors) {
    x.fillStyle = 'rgba(0,255,0,1)';
    x.beginPath();
    x.ellipse(...P([d.x + d.nx * 0.8, d.z + d.nz * 0.8]), 1.6 * k, 1.6 * k, 0, 0, Math.PI * 2);
    x.fill();
  }
  for (const g of GARDENS) {
    const b = BUILDINGS.find((o) => o.id === g.building)!;
    poly([localToWorld(b, g.x0 + 0.6, g.z0 + 0.6), localToWorld(b, g.x1 - 0.6, g.z0 + 0.6), localToWorld(b, g.x1 - 0.6, g.z1 - 0.3), localToWorld(b, g.x0 + 0.6, g.z1 - 0.3)], 'rgba(0,200,0,1)');
  }
  // allées du cimetière
  poly([[CEMETERY.gateX - 1, CEMETERY.z1], [CEMETERY.gateX + 1, CEMETERY.z1], [CEMETERY.gateX + 1, CEMETERY.z0 + 2], [CEMETERY.gateX - 1, CEMETERY.z0 + 2]], 'rgba(0,160,0,1)');
  // 2) pavés : rues, ruelles, places (par-dessus la terre)
  x.globalCompositeOperation = 'source-over';
  for (const p of PATHS) {
    if (p.road.kind !== 'street' && p.road.kind !== 'lane') continue;
    x.strokeStyle = 'rgb(255,0,0)';
    x.lineWidth = p.road.width * k;
    x.beginPath();
    p.pts.forEach((q, i) => (i ? x.lineTo(...P(q)) : x.moveTo(...P(q))));
    x.stroke();
    // pavés disjoints sur les bords (mélange pavés / terre)
    x.strokeStyle = 'rgba(255,255,0,0.45)';
    x.lineWidth = (p.road.width + 1.0) * k;
    x.stroke();
  }
  // les chemins ruraux se terminent en pavés usés près du village : rien de plus
  poly(PLAZA, 'rgb(255,0,0)', 0.3);
  poly(CHURCH_SQUARE, 'rgb(255,0,0)', 0.3);
  // pavés irréguliers sur le pourtour de la place
  for (let i = 0; i < 260; i++) {
    const a = r() * Math.PI * 2;
    const p = PLAZA[Math.floor(r() * PLAZA.length)];
    x.fillStyle = 'rgba(255,255,0,0.5)';
    x.beginPath();
    x.ellipse(...P([p[0] + Math.cos(a) * 3, p[1] + Math.sin(a) * 3]), (0.8 + r()) * k, (0.8 + r()) * k, 0, 0, Math.PI * 2);
    x.fill();
  }
  // 3) adoucissement des bords
  const out = document.createElement('canvas');
  out.width = out.height = SPLAT_SIZE;
  const o = out.getContext('2d')!;
  o.filter = 'blur(2px)';
  o.drawImage(c, 0, 0);
  return out;
}

export interface Terrain {
  mesh: THREE.Mesh;
  setHoles(h: { x: number; z: number; rot: number; hw: number; hd: number }[]): void;
}

export function buildTerrain(doors: { x: number; z: number; nx: number; nz: number; w: number }[]): Terrain {
  const size = WORLD_HALF * 2;
  const seg = 320;
  const g = new THREE.PlaneGeometry(size, size, seg, seg);
  g.rotateX(-Math.PI / 2);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)));
  g.computeVertexNormals();
  g.computeBoundingSphere();

  const splat = new THREE.CanvasTexture(splatCanvas(doors));
  splat.wrapS = splat.wrapT = THREE.ClampToEdgeWrapping;
  splat.colorSpace = THREE.NoColorSpace;
  splat.anisotropy = 4;
  const grass = VM.grassTex().map;
  const dirt = VM.dirtTex().map;
  const cobble = VM.cobbleTex().map;

  const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95, metalness: 0 });
  const holes = Array.from({ length: 8 }, () => new THREE.Vector4(0, 0, 0, 0));
  const holeRot = new Array(8).fill(0);
  const uniforms = {
    tSplat: { value: splat },
    tGrass: { value: grass },
    tDirt: { value: dirt },
    tCobble: { value: cobble },
    splatScale: { value: 1 / size },
    holes: { value: holes },
    holeRot: { value: holeRot },
    holeCount: { value: 0 },
  };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        varying vec3 vWPos;
        uniform sampler2D tSplat, tGrass, tDirt, tCobble;
        uniform float splatScale;
        uniform vec4 holes[8];
        uniform float holeRot[8];
        uniform int holeCount;
        vec4 splatV; float hgtV;
        vec3 perturbTerrain(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDir) {
          vec3 sx = normalize(dFdx(surf_pos)); vec3 sy = normalize(dFdy(surf_pos));
          vec3 r1 = cross(sy, surf_norm); vec3 r2 = cross(surf_norm, sx);
          float det = dot(sx, r1) * faceDir;
          vec3 grad = sign(det) * (dHdxy.x * r1 + dHdxy.y * r2);
          return normalize(abs(det) * surf_norm - grad);
        }`,
      )
      .replace(
        '#include <clipping_planes_fragment>',
        /* glsl */ `#include <clipping_planes_fragment>
        for (int i = 0; i < 8; i++) {
          if (i >= holeCount) break;
          vec2 d = vWPos.xz - holes[i].xy;
          float c = cos(holeRot[i]); float s = sin(holeRot[i]);
          vec2 l = vec2(d.x * c - d.y * s, d.x * s + d.y * c);
          if (abs(l.x) < holes[i].z && abs(l.y) < holes[i].w && vWPos.y < 1e4) discard;
        }`,
      )
      .replace(
        '#include <map_fragment>',
        /* glsl */ `
        splatV = texture2D(tSplat, vWPos.xz * splatScale + 0.5);
        vec3 g1 = texture2D(tGrass, vWPos.xz / 7.0).rgb;
        vec3 g2 = texture2D(tGrass, vWPos.xz / 31.0 + 0.37).rgb;
        float mac = texture2D(tDirt, vWPos.xz / 67.0).r;
        float mac2 = texture2D(tDirt, vWPos.xz / 23.0 + 0.5).g;
        vec3 grass = mix(g1, g2, 0.45) * mix(vec3(0.42, 0.5, 0.34), vec3(0.75, 0.8, 0.55), smoothstep(0.2, 0.7, mac));
        grass = mix(grass, grass * vec3(1.1, 0.95, 0.7), smoothstep(0.55, 0.8, mac2) * 0.5);
        vec3 dirtC = texture2D(tDirt, vWPos.xz / 3.0).rgb;
        vec4 cob = texture2D(tCobble, vWPos.xz / 2.5);
        float cobMix = smoothstep(0.35, 0.65, splatV.r);
        float dirtMix = smoothstep(0.15, 0.7, splatV.g) * (1.0 - cobMix);
        vec3 col = mix(grass, dirtC, dirtMix);
        col = mix(col, cob.rgb * 0.95, cobMix);
        diffuseColor.rgb *= col;
        hgtV = mix(dot(dirtC, vec3(0.33)) * 0.4 * dirtMix, dot(cob.rgb, vec3(0.33)), cobMix);`,
      )
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(mix(0.93, 0.97, dirtMix), 0.5 + 0.35 * (1.0 - hgtV), cobMix);')
      .replace(
        '#include <normal_fragment_maps>',
        /* glsl */ `#include <normal_fragment_maps>
        normal = perturbTerrain(-vViewPosition, normal, vec2(dFdx(hgtV), dFdy(hgtV)) * 1.4, faceDirection);`,
      );
  };
  mat.customProgramCacheKey = () => 'village-terrain';

  const mesh = new THREE.Mesh(g, mat);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  return {
    mesh,
    setHoles(h) {
      const n = Math.min(8, h.length);
      for (let i = 0; i < n; i++) {
        holes[i].set(h[i].x, h[i].z, h[i].hw, h[i].hd);
        // rotation monde → local du bâtiment (même convention que worldToLocal)
        holeRot[i] = h[i].rot;
      }
      uniforms.holeCount.value = n;
    },
  };
}
