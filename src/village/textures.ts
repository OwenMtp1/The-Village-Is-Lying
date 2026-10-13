/**
 * Matériaux du village médiéval : textures générées par code (aucun fichier à télécharger), PBR, à l'échelle réelle.
 * Chaque texture couleur a une carte de relief dérivée de sa luminance (joints de mortier et interstices en creux).
 * Les géométries du village portent des UV en mètres : la répétition de chaque texture correspond à sa taille réelle.
 */
import * as THREE from 'three';

const texCache = new Map<string, { map: THREE.Texture; bump: THREE.Texture }>();
const photoLoader = new THREE.TextureLoader();

type Draw = (x: CanvasRenderingContext2D, s: number, r: () => number) => void;

function rand(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Texture générée + sa carte de relief, répétée tous les `meters` mètres. */
function gen(key: string, size: number, meters: number, draw: Draw, seed = 1) {
  let t = texCache.get(key);
  if (!t) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const x = c.getContext('2d', { willReadFrequently: true })!;
    draw(x, size, rand(seed));
    const map = new THREE.CanvasTexture(c);
    map.colorSpace = THREE.SRGBColorSpace;
    const bump = new THREE.CanvasTexture(c);
    for (const tx of [map, bump]) {
      tx.wrapS = tx.wrapT = THREE.RepeatWrapping;
      tx.anisotropy = 8;
      tx.repeat.set(1 / meters, 1 / meters);
    }
    texCache.set(key, (t = { map, bump }));
  }
  return t;
}

/** Grain fin (bruit) ajouté à toute la texture. */
function grain(x: CanvasRenderingContext2D, s: number, amount: number, r: () => number) {
  const img = x.getImageData(0, 0, s, s);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (r() - 0.5) * amount;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  x.putImageData(img, 0, 0);
}

/** Taches douces (salissures, mousse, humidité), dessinées avec raccord sur les bords. */
function blotches(x: CanvasRenderingContext2D, s: number, r: () => number, n: number, color: string, rMin: number, rMax: number, alpha: number) {
  for (let i = 0; i < n; i++) {
    const cx = r() * s;
    const cy = r() * s;
    const rad = rMin + r() * (rMax - rMin);
    for (const ox of [-s, 0, s])
      for (const oy of [-s, 0, s]) {
        const g = x.createRadialGradient(cx + ox, cy + oy, 0, cx + ox, cy + oy, rad);
        g.addColorStop(0, color.replace('A', String(alpha)));
        g.addColorStop(1, color.replace('A', '0'));
        x.fillStyle = g;
        x.fillRect(cx + ox - rad, cy + oy - rad, rad * 2, rad * 2);
      }
  }
}

/** Dessine un rectangle avec raccord horizontal/vertical (il réapparaît de l'autre côté). */
function wrapped(s: number, x0: number, y0: number, w: number, h: number, f: (x: number, y: number) => void) {
  for (const ox of [-s, 0, s])
    for (const oy of [-s, 0, s]) if (x0 + ox < s && x0 + ox + w > 0 && y0 + oy < s && y0 + oy + h > 0) f(x0 + ox, y0 + oy);
}

const shade = (base: [number, number, number], v: number) => `rgb(${Math.round(base[0] * v)},${Math.round(base[1] * v)},${Math.round(base[2] * v)})`;

// ───────────────────────── textures ─────────────────────────

/** Maçonnerie de moellons en assises irrégulières (2 m). */
const stoneWall = (variant: 'light' | 'dark') =>
  gen(`stone|${variant}`, 512, 2, (x, s, r) => {
    const base: [number, number, number] = variant === 'light' ? [150, 140, 124] : [104, 100, 94];
    x.fillStyle = variant === 'light' ? '#4a4338' : '#2c2a27';
    x.fillRect(0, 0, s, s);
    let y = 0;
    while (y < s) {
      let h = 48 + Math.floor(r() * 48);
      if (s - y - h < 40) h = s - y;
      let xx = Math.floor(r() * 120);
      const start = xx;
      while (xx < start + s) {
        let w = 70 + Math.floor(r() * 120);
        if (start + s - xx - w < 50) w = start + s - xx;
        const v = 0.72 + r() * 0.45;
        const tint = r() < 0.18 ? [1.06, 1.0, 0.9] : [1, 1, 1];
        const col: [number, number, number] = [base[0] * tint[0], base[1] * tint[1], base[2] * tint[2]];
        const j = 3 + r() * 3;
        wrapped(s, xx % s, y, w, h, (px, py) => {
          x.fillStyle = shade(col, v);
          x.beginPath();
          x.roundRect(px + j, py + j * 0.8, w - j * 2, h - j * 1.6, 9 + r() * 8);
          x.fill();
          // arêtes : haut éclairé, bas assombri
          const g = x.createLinearGradient(0, py, 0, py + h);
          g.addColorStop(0, 'rgba(255,255,255,0.10)');
          g.addColorStop(0.5, 'rgba(0,0,0,0)');
          g.addColorStop(1, 'rgba(0,0,0,0.22)');
          x.fillStyle = g;
          x.beginPath();
          x.roundRect(px + j, py + j * 0.8, w - j * 2, h - j * 1.6, 9);
          x.fill();
        });
        xx += w;
      }
      y += h;
    }
    blotches(x, s, r, 9, 'rgba(30,40,20,A)', 30, 90, 0.18);
    blotches(x, s, r, 6, 'rgba(0,0,0,A)', 40, 120, 0.14);
    grain(x, s, 26, r);
  }, variant === 'light' ? 3 : 4);

/** Pavés arrondis serrés, interstices sombres (2,5 m). */
const cobble = () =>
  gen('cobble', 512, 2.5, (x, s, r) => {
    x.fillStyle = '#26231f';
    x.fillRect(0, 0, s, s);
    const n = 13;
    const cell = s / n;
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const cx = (i + 0.5 + (j % 2) * 0.5 + (r() - 0.5) * 0.25) * cell;
        const cy = (j + 0.5 + (r() - 0.5) * 0.2) * cell;
        const rx = cell * (0.4 + r() * 0.08);
        const ry = cell * (0.38 + r() * 0.08);
        const v = 0.6 + r() * 0.5;
        const warm = r() < 0.3;
        const base: [number, number, number] = warm ? [128, 116, 100] : [112, 110, 106];
        wrapped(s, cx - rx, cy - ry, rx * 2, ry * 2, (px, py) => {
          const ex = px + rx;
          const ey = py + ry;
          const g = x.createRadialGradient(ex - rx * 0.3, ey - ry * 0.35, rx * 0.1, ex, ey, rx * 1.05);
          g.addColorStop(0, shade(base, v * 1.18));
          g.addColorStop(0.7, shade(base, v));
          g.addColorStop(1, shade(base, v * 0.55));
          x.fillStyle = g;
          x.beginPath();
          x.ellipse(ex, ey, rx, ry, r() * 0.6, 0, Math.PI * 2);
          x.fill();
        });
      }
    blotches(x, s, r, 10, 'rgba(20,18,14,A)', 30, 110, 0.25);
    grain(x, s, 18, r);
  }, 8);

/** Enduit à la chaux, taché et usé (3 m) : teinté par la couleur du matériau. */
const plaster = () =>
  gen('plaster', 512, 3, (x, s, r) => {
    x.fillStyle = '#e4dccb';
    x.fillRect(0, 0, s, s);
    blotches(x, s, r, 30, 'rgba(150,130,100,A)', 20, 90, 0.16);
    blotches(x, s, r, 12, 'rgba(80,70,55,A)', 50, 140, 0.12);
    blotches(x, s, r, 10, 'rgba(255,250,235,A)', 20, 70, 0.2);
    // fissures fines
    x.strokeStyle = 'rgba(70,60,50,0.35)';
    for (let k = 0; k < 7; k++) {
      x.lineWidth = 0.6 + r();
      x.beginPath();
      let px = r() * s;
      let py = r() * s;
      x.moveTo(px, py);
      for (let i = 0; i < 8; i++) {
        px += (r() - 0.5) * 34;
        py += (r() - 0.3) * 26;
        x.lineTo(px, py);
      }
      x.stroke();
    }
    grain(x, s, 14, r);
  }, 5);

/** Poutres de chêne sombre, fil du bois (1 m). */
const timber = () =>
  gen('timber', 256, 1, (x, s, r) => {
    x.fillStyle = '#4a3423';
    x.fillRect(0, 0, s, s);
    for (let i = 0; i < 90; i++) {
      const y = r() * s;
      x.strokeStyle = r() < 0.5 ? 'rgba(25,15,8,0.35)' : 'rgba(120,90,60,0.18)';
      x.lineWidth = 0.6 + r() * 2;
      x.beginPath();
      x.moveTo(0, y);
      for (let px = 0; px <= s; px += 16) x.lineTo(px, y + Math.sin(px * 0.03 + i) * 2.5);
      x.stroke();
    }
    grain(x, s, 20, r);
  }, 6);

/** Planches verticales usées, joints sombres (2 m). */
const planks = () =>
  gen('planks', 512, 2, (x, s, r) => {
    x.fillStyle = '#1a130d';
    x.fillRect(0, 0, s, s);
    let px = 0;
    while (px < s) {
      let w = 52 + Math.floor(r() * 30);
      if (s - px - w < 40) w = s - px;
      const v = 0.75 + r() * 0.35;
      x.fillStyle = shade([118, 92, 66], v);
      x.fillRect(px + 2, 0, w - 4, s);
      for (let i = 0; i < 14; i++) {
        const gx = px + 4 + r() * (w - 8);
        x.strokeStyle = r() < 0.6 ? 'rgba(40,26,14,0.3)' : 'rgba(170,140,110,0.15)';
        x.lineWidth = 0.6 + r() * 1.6;
        x.beginPath();
        x.moveTo(gx, 0);
        for (let py = 0; py <= s; py += 24) x.lineTo(gx + Math.sin(py * 0.02 + i) * 2, py);
        x.stroke();
      }
      if (r() < 0.6) {
        x.fillStyle = 'rgba(30,18,10,0.55)';
        x.beginPath();
        x.ellipse(px + w / 2 + (r() - 0.5) * w * 0.4, r() * s, 4 + r() * 4, 7 + r() * 6, 0, 0, Math.PI * 2);
        x.fill();
      }
      px += w;
    }
    blotches(x, s, r, 8, 'rgba(90,95,90,A)', 40, 120, 0.12);
    grain(x, s, 18, r);
  }, 7);

/** Tuiles de terre cuite en rangées (1,5 m), mousse par endroits. */
const roofTiles = () =>
  gen('rooftiles', 512, 1.5, (x, s, r) => {
    x.fillStyle = '#2a1510';
    x.fillRect(0, 0, s, s);
    const rows = 12;
    const cols = 9;
    const rh = s / rows;
    const cw = s / cols;
    for (let j = 0; j < rows; j++)
      for (let i = -1; i <= cols; i++) {
        const ox = (j % 2) * (cw / 2);
        const v = 0.65 + r() * 0.45;
        const px = i * cw + ox;
        const py = j * rh;
        const g = x.createLinearGradient(px, 0, px + cw, 0);
        g.addColorStop(0, shade([120, 58, 40], v * 0.75));
        g.addColorStop(0.5, shade([150, 74, 50], v));
        g.addColorStop(1, shade([120, 58, 40], v * 0.7));
        x.fillStyle = g;
        x.beginPath();
        x.roundRect(px + 2, py, cw - 4, rh * 1.25, [0, 0, cw / 2.3, cw / 2.3]);
        x.fill();
        x.fillStyle = 'rgba(0,0,0,0.32)';
        x.fillRect(px + 2, py + rh - 4, cw - 4, 4);
      }
    blotches(x, s, r, 9, 'rgba(70,82,40,A)', 20, 70, 0.32);
    blotches(x, s, r, 8, 'rgba(0,0,0,A)', 40, 110, 0.18);
    grain(x, s, 18, r);
  }, 9);

/** Ardoises (1,5 m). */
const slate = () =>
  gen('slate', 512, 1.5, (x, s, r) => {
    x.fillStyle = '#16181c';
    x.fillRect(0, 0, s, s);
    const rows = 10;
    const rh = s / rows;
    for (let j = 0; j < rows; j++) {
      let px = (j % 2) * 26 - 26;
      while (px < s) {
        const w = 44 + r() * 20;
        const v = 0.7 + r() * 0.4;
        x.fillStyle = shade([74, 80, 92], v);
        x.fillRect(px + 2, j * rh, w - 3, rh - 3);
        x.fillStyle = 'rgba(255,255,255,0.05)';
        x.fillRect(px + 2, j * rh, w - 3, 3);
        px += w;
      }
    }
    blotches(x, s, r, 6, 'rgba(60,70,40,A)', 20, 60, 0.2);
    grain(x, s, 14, r);
  }, 10);

/** Chaume (paille tassée en rangs) (2 m). */
const thatch = () =>
  gen('thatch', 512, 2, (x, s, r) => {
    x.fillStyle = '#4a3b22';
    x.fillRect(0, 0, s, s);
    for (let i = 0; i < 5200; i++) {
      const px = r() * s;
      const py = r() * s;
      const len = 18 + r() * 34;
      const v = 0.6 + r() * 0.6;
      x.strokeStyle = shade([150, 122, 74], v);
      x.lineWidth = 0.8 + r() * 1.4;
      x.beginPath();
      x.moveTo(px, py);
      x.lineTo(px + (r() - 0.5) * 6, py + len);
      x.stroke();
    }
    for (let j = 0; j < 6; j++) {
      const y = (j / 6) * s;
      const g = x.createLinearGradient(0, y, 0, y + s / 6);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(0.85, 'rgba(0,0,0,0.05)');
      g.addColorStop(1, 'rgba(0,0,0,0.35)');
      x.fillStyle = g;
      x.fillRect(0, y, s, s / 6);
    }
    blotches(x, s, r, 7, 'rgba(40,50,25,A)', 30, 90, 0.25);
    grain(x, s, 16, r);
  }, 11);

/** Bardeaux de bois (1,5 m). */
const woodShingles = () =>
  gen('woodshingles', 512, 1.5, (x, s, r) => {
    x.fillStyle = '#1d150e';
    x.fillRect(0, 0, s, s);
    const rows = 11;
    const rh = s / rows;
    for (let j = 0; j < rows; j++) {
      let px = (j % 2) * 20 - 30;
      while (px < s) {
        const w = 26 + r() * 30;
        const v = 0.65 + r() * 0.45;
        x.fillStyle = shade([104, 84, 62], v);
        x.fillRect(px + 1.5, j * rh, w - 3, rh * 1.1);
        x.strokeStyle = 'rgba(30,20,10,0.25)';
        x.beginPath();
        x.moveTo(px + w / 2, j * rh);
        x.lineTo(px + w / 2 + (r() - 0.5) * 4, j * rh + rh);
        x.stroke();
        x.fillStyle = 'rgba(0,0,0,0.3)';
        x.fillRect(px + 1.5, j * rh + rh - 3, w - 3, 3);
        px += w;
      }
    }
    blotches(x, s, r, 8, 'rgba(60,70,50,A)', 30, 90, 0.2);
    grain(x, s, 16, r);
  }, 12);

/** Terre battue, gravillons et ornières (3 m). */
const dirt = () =>
  gen('dirt', 512, 3, (x, s, r) => {
    x.fillStyle = '#5a4733';
    x.fillRect(0, 0, s, s);
    blotches(x, s, r, 40, 'rgba(40,30,20,A)', 20, 80, 0.3);
    blotches(x, s, r, 30, 'rgba(120,100,75,A)', 15, 60, 0.25);
    for (let i = 0; i < 900; i++) {
      const v = 0.6 + r() * 0.7;
      x.fillStyle = shade([118, 106, 90], v);
      x.beginPath();
      x.ellipse(r() * s, r() * s, 1 + r() * 3.5, 1 + r() * 2.5, r() * 3, 0, Math.PI * 2);
      x.fill();
    }
    grain(x, s, 22, r);
  }, 13);

/** Dallage de pierre intérieur (2 m). */
const flagstone = () =>
  gen('flagstone', 512, 2, (x, s, r) => {
    x.fillStyle = '#2a2723';
    x.fillRect(0, 0, s, s);
    const rows = 4;
    const rh = s / rows;
    for (let j = 0; j < rows; j++) {
      let px = Math.floor(r() * 80);
      const start = px;
      while (px < start + s) {
        let w = 90 + r() * 90;
        if (start + s - px - w < 60) w = start + s - px;
        const v = 0.7 + r() * 0.35;
        wrapped(s, px % s, j * rh, w, rh, (qx, qy) => {
          x.fillStyle = shade([128, 122, 112], v);
          x.beginPath();
          x.roundRect(qx + 3, qy + 3, w - 6, rh - 6, 6);
          x.fill();
        });
        px += w;
      }
    }
    blotches(x, s, r, 10, 'rgba(0,0,0,A)', 40, 130, 0.16);
    grain(x, s, 18, r);
  }, 14);

/** Fenêtre éclairée de l'intérieur : lueur chaude, vitraux en losanges (plomb). */
const litWindow = () =>
  gen('litwindow', 128, 1, (x, s) => {
    const g = x.createRadialGradient(s * 0.5, s * 0.62, 4, s * 0.5, s * 0.6, s * 0.8);
    g.addColorStop(0, '#ffd88a');
    g.addColorStop(0.5, '#f0a245');
    g.addColorStop(1, '#5a2a10');
    x.fillStyle = g;
    x.fillRect(0, 0, s, s);
    x.strokeStyle = 'rgba(30,18,8,0.75)';
    x.lineWidth = 2;
    for (let i = -s; i < s * 2; i += 22) {
      x.beginPath();
      x.moveTo(i, 0);
      x.lineTo(i + s, s);
      x.moveTo(i, s);
      x.lineTo(i + s, 0);
      x.stroke();
    }
  });

/** Vitre sombre (non éclairée) : reflet bleuté de la nuit, losanges de plomb. */
const darkWindow = () =>
  gen('darkwindow', 128, 1, (x, s) => {
    const g = x.createLinearGradient(0, 0, s, s);
    g.addColorStop(0, '#2a3550');
    g.addColorStop(1, '#0b0f18');
    x.fillStyle = g;
    x.fillRect(0, 0, s, s);
    x.strokeStyle = 'rgba(5,5,8,0.9)';
    x.lineWidth = 2;
    for (let i = -s; i < s * 2; i += 22) {
      x.beginPath();
      x.moveTo(i, 0);
      x.lineTo(i + s, s);
      x.moveTo(i, s);
      x.lineTo(i + s, 0);
      x.stroke();
    }
  });

/** Paille / foin en vrac. */
const hay = () =>
  gen('hay', 256, 1, (x, s, r) => {
    x.fillStyle = '#7a6230';
    x.fillRect(0, 0, s, s);
    for (let i = 0; i < 2600; i++) {
      const px = r() * s;
      const py = r() * s;
      const a = r() * Math.PI;
      const len = 6 + r() * 18;
      x.strokeStyle = shade([196, 164, 92], 0.6 + r() * 0.6);
      x.lineWidth = 0.6 + r();
      x.beginPath();
      x.moveTo(px, py);
      x.lineTo(px + Math.cos(a) * len, py + Math.sin(a) * len);
      x.stroke();
    }
    grain(x, s, 14, r);
  }, 15);

/** Fer forgé / fonte : sombre, légèrement rouillé. */
const iron = () =>
  gen('iron', 128, 0.6, (x, s, r) => {
    x.fillStyle = '#2b2a29';
    x.fillRect(0, 0, s, s);
    blotches(x, s, r, 8, 'rgba(110,60,30,A)', 6, 24, 0.35);
    grain(x, s, 24, r);
  }, 16);

function photo(name: string, meters: number) {
  const key = `photo|${name}`;
  let t = texCache.get(key);
  if (!t) {
    const map = photoLoader.load(`/textures/${name}`);
    map.colorSpace = THREE.SRGBColorSpace;
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.anisotropy = 8;
    map.repeat.set(1 / meters, 1 / meters);
    t = { map, bump: map };
    texCache.set(key, t);
  }
  return t;
}

// ───────────────────────── matériaux ─────────────────────────

const matCache = new Map<string, THREE.Material>();
function cached<T extends THREE.Material>(key: string, make: () => T): T {
  let m = matCache.get(key) as T | undefined;
  if (!m) matCache.set(key, (m = make()));
  return m;
}

function textured(key: string, t: { map: THREE.Texture; bump: THREE.Texture }, o: { color?: string; rough?: number; bump?: number; metal?: number } = {}) {
  return cached(key, () => {
    const m = new THREE.MeshStandardMaterial({
      color: o.color ?? '#ffffff',
      map: t.map,
      bumpMap: t.bump,
      bumpScale: o.bump ?? 1.2,
      roughness: o.rough ?? 0.9,
      metalness: o.metal ?? 0,
    });
    m.name = key;
    return m;
  });
}

/** Teintes d'enduit pour varier les façades. */
export const PLASTER_TINTS = ['#f2ead8', '#e9d6b0', '#e2c6a8', '#d8d2c6', '#efe0c0', '#d9c4a0'];
/** Teintes de tuiles. */
export const TILE_TINTS = ['#ffffff', '#e8cfc0', '#cfb4a4', '#f0d8c8'];

export const VM = {
  stone: (tint = '#ffffff') => textured(`stone|${tint}`, stoneWall('light'), { color: tint, bump: 2.2 }),
  stoneDark: (tint = '#ffffff') => textured(`stoneDark|${tint}`, stoneWall('dark'), { color: tint, bump: 2.2 }),
  plaster: (tint = PLASTER_TINTS[0]) => textured(`plaster|${tint}`, plaster(), { color: tint, rough: 0.95, bump: 0.6 }),
  timber: () => textured('timber', timber(), { rough: 0.8, bump: 0.8 }),
  planks: (tint = '#ffffff') => textured(`planks|${tint}`, planks(), { color: tint, rough: 0.85, bump: 1.2 }),
  roofTiles: (tint = '#ffffff') => textured(`roofTiles|${tint}`, roofTiles(), { color: tint, rough: 0.8, bump: 2 }),
  slate: () => textured('slate', slate(), { rough: 0.55, bump: 1.4 }),
  thatch: () => textured('thatch', thatch(), { rough: 1, bump: 2.5 }),
  woodShingles: () => textured('woodShingles', woodShingles(), { rough: 0.85, bump: 1.6 }),
  dirtTex: () => dirt(),
  cobbleTex: () => cobble(),
  grassTex: () => photo('grasslight-big.jpg', 7),
  flagstone: () => textured('flagstone', flagstone(), { rough: 0.75, bump: 1.4 }),
  floorboards: (tint = '#8a6a50') =>
    cached(`floorboards|${tint}`, () => {
      const map = photo('hardwood2_diffuse.jpg', 2).map;
      return new THREE.MeshStandardMaterial({ color: tint, map, roughness: 0.82 });
    }),
  hay: () => textured('hay', hay(), { rough: 1, bump: 1.5 }),
  iron: () => textured('iron', iron(), { rough: 0.5, metal: 0.75, bump: 0.6 }),
  dirtFloor: () => textured('dirtFloor', dirt(), { rough: 1, bump: 1.2 }),
  litWindow: () =>
    cached('litWindow', () => {
      const t = litWindow().map;
      return new THREE.MeshStandardMaterial({ map: t, emissive: '#ffffff', emissiveMap: t, emissiveIntensity: 1.6, roughness: 0.3, side: THREE.FrontSide });
    }),
  darkWindow: () => cached('darkWindow', () => new THREE.MeshStandardMaterial({ map: darkWindow().map, roughness: 0.08, metalness: 0.5, envMapIntensity: 1.5 })),
  /** couleur unie (tissus, cire, céramique…) */
  paint: (color: string, rough = 0.8, metal = 0) => cached(`paint|${color}|${rough}|${metal}`, () => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal })),
  /** source lumineuse visible (flamme, braises, vitre de lanterne) */
  glow: (color: string, intensity = 3) => cached(`glow|${color}|${intensity}`, () => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity, roughness: 1 })),
  water: () =>
    cached('vwater', () => {
      const t = photoLoader.load('/textures/Water_1_M_Normal.jpg');
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(0.6, 0.6);
      return new THREE.MeshStandardMaterial({ color: '#0d1820', normalMap: t, roughness: 0.04, metalness: 0.3 });
    }),
};
