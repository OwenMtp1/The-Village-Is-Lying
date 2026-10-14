/**
 * Carte interactive du village, dessinée comme un vieux plan sur parchemin à partir des données de la carte
 * (rues, places, bâtiments, champs, verger, cimetière, lisière de la forêt). Molette : zoom, glisser : déplacer,
 * survol : nom du lieu. Le joueur n'y voit que sa propre position (jamais celle des autres).
 * En exploration solo, un clic sur la carte y téléporte le personnage ; un calque montre les souterrains.
 */
import { BUILDINGS, CEMETERY, CHURCH_SQUARE, FIELDS, ORCHARD, PATHS, PLAZA, VILLAGE_CENTER, fieldPoly, footprint, forestEdge, inPolygon, insideBuilding, roadDistance, type BuildingSpec, type District, type P2 } from '../village/layout';
import { ROOMS, SHAFTS, TUNNELS } from '../village/underground';
import { limitAt } from '../village/boundary';
import { h } from './dom';

const INK = '#3b2a1a';
const PAPER = '#e9d8ad';
/** étendue dessinée (m) autour du centre du village et résolution du plan de base */
const HALF = 215;
const PX = 4;

const DISTRICT_NAMES: Record<District, string> = {
  place: 'Place centrale',
  commerce: 'Quartier commerçant',
  residentiel: 'Quartier résidentiel',
  eglise: "Quartier de l'église",
  abords: 'Les abords',
};
/** lieux importants, toujours nommés sur la carte */
const LANDMARKS = new Set(['taverne', 'eglise', 'sherif', 'forge', 'ecuries', 'grange', 'ferme', 'abandonnee', 'apothicaire', 'boulangerie', 'presbytere']);

export interface MapPick {
  x: number;
  z: number;
  name: string;
  /** clic sur une galerie (calque des souterrains affiché) */
  underground: boolean;
}

function rnd(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

export class VillageMap {
  readonly el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private base: HTMLCanvasElement | null = null;
  private tip: HTMLElement;
  /** vue : mètres → pixels écran, centre de la vue (monde) */
  private scale = 1;
  private cx = VILLAGE_CENTER[0];
  private cz = VILLAGE_CENTER[1];
  private drag: { x: number; y: number; moved: boolean } | null = null;
  private hover: { x: number; z: number; name: string; b?: BuildingSpec } | null = null;
  private player: { x: number; z: number; yaw: number } | null = null;
  /** téléportation au clic (exploration solo) */
  teleport = false;
  showUnderground = false;
  onPick: (p: MapPick) => void = () => {};

  constructor() {
    this.el = h(`<div class="vmap">
      <canvas aria-label="Carte du village"></canvas>
      <div class="vmap-tip" hidden></div>
      <div class="vmap-tools">
        <button type="button" data-z="1" aria-label="Zoomer">+</button>
        <button type="button" data-z="-1" aria-label="Dézoomer">−</button>
        <button type="button" data-z="0" title="Recentrer sur vous">◎</button>
        <label class="vmap-under" hidden><input type="checkbox" /> Souterrains</label>
      </div>
      <div class="vmap-hint"></div>
    </div>`);
    this.canvas = this.el.querySelector('canvas')!;
    this.ctx = this.canvas.getContext('2d')!;
    this.tip = this.el.querySelector('.vmap-tip') as HTMLElement;
    this.bind();
  }

  /** Affiche la carte (taille du conteneur), centrée sur le joueur s'il est connu. */
  open(opts: { teleport: boolean; player: { x: number; z: number; yaw: number } | null }) {
    this.teleport = opts.teleport;
    this.player = opts.player;
    (this.el.querySelector('.vmap-under') as HTMLElement).hidden = !opts.teleport;
    if (!opts.teleport) this.showUnderground = false;
    (this.el.querySelector('.vmap-under input') as HTMLInputElement).checked = this.showUnderground;
    this.el.querySelector('.vmap-hint')!.textContent = opts.teleport ? 'Cliquez sur un lieu pour vous y rendre · molette : zoom · glisser : déplacer' : 'Molette : zoom · glisser : déplacer · survol : nom du lieu';
    this.base ??= drawBase();
    requestAnimationFrame(() => {
      this.fit();
      if (this.player) {
        this.cx = this.player.x;
        this.cz = this.player.z;
      }
      this.clamp();
      this.draw();
    });
  }

  private fit() {
    const r = this.el.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.max(1, Math.round(r.width * dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * dpr));
    this.canvas.style.width = `${r.width}px`;
    this.canvas.style.height = `${r.height}px`;
    // tout le village visible au départ, un peu zoomé
    this.scale = (Math.min(r.width, r.height) / (HALF * 1.45)) * dpr;
  }

  private toScreen(x: number, z: number): P2 {
    return [(x - this.cx) * this.scale + this.canvas.width / 2, (z - this.cz) * this.scale + this.canvas.height / 2];
  }
  private toWorld(px: number, py: number): P2 {
    const dpr = this.canvas.width / (this.canvas.getBoundingClientRect().width || 1);
    return [(px * dpr - this.canvas.width / 2) / this.scale + this.cx, (py * dpr - this.canvas.height / 2) / this.scale + this.cz];
  }

  private zoom(f: number, px?: number, py?: number) {
    const r = this.canvas.getBoundingClientRect();
    const [wx, wz] = this.toWorld(px ?? r.width / 2, py ?? r.height / 2);
    const minS = this.canvas.width / (HALF * 2.4);
    this.scale = Math.max(minS, Math.min(this.canvas.width / 30, this.scale * f));
    const [nx, nz] = this.toWorld(px ?? r.width / 2, py ?? r.height / 2);
    this.cx += wx - nx;
    this.cz += wz - nz;
    this.clamp();
    this.draw();
  }

  /** La vue reste sur le parchemin (pas de bord vide), sauf si la carte entière est plus petite que la vue. */
  private clamp() {
    const [cx, cz] = VILLAGE_CENTER;
    const hw = this.canvas.width / 2 / this.scale;
    const hh = this.canvas.height / 2 / this.scale;
    const lim = (c: number, h: number, v: number) => (h >= HALF ? c : Math.max(c - HALF + h, Math.min(c + HALF - h, v)));
    this.cx = lim(cx, hw, this.cx);
    this.cz = lim(cz, hh, this.cz);
  }

  private bind() {
    const c = this.canvas;
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoom(e.deltaY > 0 ? 0.85 : 1.18, e.offsetX, e.offsetY);
    });
    c.addEventListener('pointerdown', (e) => {
      this.drag = { x: e.clientX, y: e.clientY, moved: false };
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener('pointermove', (e) => {
      if (this.drag) {
        const dx = e.clientX - this.drag.x;
        const dy = e.clientY - this.drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) this.drag.moved = true;
        if (this.drag.moved) {
          const dpr = c.width / (c.getBoundingClientRect().width || 1);
          this.cx -= (dx * dpr) / this.scale;
          this.cz -= (dy * dpr) / this.scale;
          this.drag.x = e.clientX;
          this.drag.y = e.clientY;
          this.clamp();
        }
      }
      const [x, z] = this.toWorld(e.offsetX, e.offsetY);
      this.hover = this.describe(x, z);
      this.tip.hidden = !this.hover;
      if (this.hover) {
        this.tip.textContent = this.hover.name;
        this.tip.style.left = `${e.offsetX + 14}px`;
        this.tip.style.top = `${e.offsetY + 10}px`;
      }
      c.style.cursor = this.drag?.moved ? 'grabbing' : this.teleport ? 'crosshair' : 'grab';
      this.draw();
    });
    c.addEventListener('pointerup', (e) => {
      const d = this.drag;
      this.drag = null;
      if (d && !d.moved && this.teleport) {
        const [x, z] = this.toWorld(e.offsetX, e.offsetY);
        const info = this.describe(x, z);
        this.onPick({ x, z, name: info?.name ?? 'Abords du village', underground: !!info?.underground });
      }
    });
    c.addEventListener('pointerleave', () => {
      this.hover = null;
      this.tip.hidden = true;
      this.draw();
    });
    this.el.querySelector('.vmap-tools')!.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
      if (!b) return;
      const z = Number(b.dataset.z);
      if (z === 0 && this.player) {
        this.cx = this.player.x;
        this.cz = this.player.z;
        this.clamp();
        this.draw();
      } else if (z) this.zoom(z > 0 ? 1.4 : 1 / 1.4);
    });
    this.el.querySelector('.vmap-under input')!.addEventListener('change', (e) => {
      this.showUnderground = (e.target as HTMLInputElement).checked;
      this.draw();
    });
    window.addEventListener('resize', () => {
      if (this.el.offsetParent) {
        this.fit();
        this.draw();
      }
    });
  }

  /** Nom du lieu sous le curseur. */
  private describe(x: number, z: number): (MapPick & { b?: BuildingSpec }) | null {
    if (this.showUnderground) {
      const r = ROOMS.find((q) => x >= q.x0 && x <= q.x1 && z >= q.z0 && z <= q.z1);
      if (r) return { x, z, name: `${r.name} (souterrain)`, underground: true };
      for (const t of TUNNELS)
        for (let k = 0; k < t.pts.length - 1; k++) {
          const [a, b] = [t.pts[k], t.pts[k + 1]];
          if (x >= Math.min(a[0], b[0]) - t.w / 2 && x <= Math.max(a[0], b[0]) + t.w / 2 && z >= Math.min(a[1], b[1]) - t.w / 2 && z <= Math.max(a[1], b[1]) + t.w / 2)
            return { x, z, name: t.secret ? 'Passage secret' : 'Galeries souterraines', underground: true };
        }
    }
    const b = BUILDINGS.find((q) => insideBuilding(q, x, z));
    if (b) return { x, z, name: b.name, underground: false, b };
    if (inPolygon(x, z, PLAZA)) return { x, z, name: 'Place centrale', underground: false };
    if (inPolygon(x, z, CHURCH_SQUARE)) return { x, z, name: "Parvis de l'église", underground: false };
    if (x > CEMETERY.x0 && x < CEMETERY.x1 && z > CEMETERY.z0 && z < CEMETERY.z1) return { x, z, name: 'Cimetière', underground: false };
    const rd = roadDistance(x, z);
    if (rd.road && rd.d < rd.road.width / 2 + 1) return { x, z, name: rd.road.name, underground: false };
    const f = FIELDS.find((q) => inPolygon(x, z, fieldPoly(q)));
    if (f) return { x, z, name: f.kind === 'fauche' ? 'Pré' : 'Champ', underground: false };
    const [vx, vz] = VILLAGE_CENTER;
    const d = Math.hypot(x - vx, z - vz);
    if (d > limitAt(Math.atan2(z - vz, x - vx))) return null;
    if (d > forestEdge(x, z)) return { x, z, name: 'Forêt', underground: false };
    return { x, z, name: 'Abords du village', underground: false };
  }

  draw() {
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#6b5232';
    ctx.fillRect(0, 0, W, H);
    if (!this.base) return;
    // plan de base
    const [ox, oy] = this.toScreen(VILLAGE_CENTER[0] - HALF, VILLAGE_CENTER[1] - HALF);
    const size = HALF * 2 * this.scale;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.base, ox, oy, size, size);
    const s = this.scale;
    // calque des souterrains (exploration solo)
    if (this.showUnderground) {
      ctx.save();
      ctx.fillStyle = 'rgba(40, 24, 12, 0.55)';
      ctx.strokeStyle = 'rgba(40, 24, 12, 0.9)';
      ctx.setLineDash([4, 3]);
      for (const t of TUNNELS) {
        ctx.lineWidth = Math.max(2, t.w * s);
        ctx.strokeStyle = t.secret ? 'rgba(120, 20, 20, 0.85)' : 'rgba(40, 24, 12, 0.75)';
        ctx.beginPath();
        t.pts.forEach(([x, z], i) => (i ? ctx.lineTo(...this.toScreen(x, z)) : ctx.moveTo(...this.toScreen(x, z))));
        ctx.stroke();
      }
      ctx.setLineDash([]);
      for (const r of ROOMS) {
        const [a, b] = this.toScreen(r.x0, r.z0);
        ctx.fillRect(a, b, (r.x1 - r.x0) * s, (r.z1 - r.z0) * s);
        this.label(r.name, (r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2, 11, '#f6e7c1', 'dark');
      }
      for (const sh of SHAFTS) {
        const [a, b] = this.toScreen(sh.x, sh.z);
        ctx.fillStyle = '#7a1d14';
        ctx.beginPath();
        ctx.arc(a, b, 5, 0, Math.PI * 2);
        ctx.fill();
        this.label(sh.name, sh.x, sh.z - 6 / s - 3, 10, '#7a1d14', true);
      }
      ctx.restore();
    }
    // noms : quartiers (de loin), rues et lieux importants, tous les bâtiments de près
    const zoomed = s / (this.canvas.width / (HALF * 1.45)) ;
    const dist = new Map<District, { x: number; z: number; n: number }>();
    for (const b of BUILDINGS) {
      const d = dist.get(b.district) ?? { x: 0, z: 0, n: 0 };
      d.x += b.x;
      d.z += b.z;
      d.n++;
      dist.set(b.district, d);
    }
    if (zoomed < 1.6)
      for (const [k, d] of dist) if (k !== 'place') this.label(DISTRICT_NAMES[k], d.x / d.n, d.z / d.n - 10, 16, 'rgba(59, 42, 26, 0.75)', false, true);
    this.label('Place centrale', 1, 0, zoomed < 2.2 ? 13 : 15, INK, false, true);
    if (zoomed > 1.4)
      for (const p of PATHS) {
        if (p.road.kind === 'path') continue;
        const mid = p.pts[Math.floor(p.pts.length / 2)];
        const nxt = p.pts[Math.min(p.pts.length - 1, Math.floor(p.pts.length / 2) + 2)];
        this.label(p.road.name, mid[0], mid[1], 10, '#5a3d22', false, true, Math.atan2(nxt[1] - mid[1], nxt[0] - mid[0]));
      }
    for (const b of BUILDINGS) if (LANDMARKS.has(b.id) || zoomed > 3) this.label(b.name, b.x, b.z, zoomed > 3 ? 10 : 11, INK, true);
    // survol
    if (this.hover?.b) {
      const fp = footprint(this.hover.b);
      ctx.strokeStyle = '#a3241a';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      fp.forEach(([x, z], i) => (i ? ctx.lineTo(...this.toScreen(x, z)) : ctx.moveTo(...this.toScreen(x, z))));
      ctx.closePath();
      ctx.stroke();
    }
    // position du joueur : flèche rouge orientée
    if (this.player) {
      const [px, py] = this.toScreen(this.player.x, this.player.z);
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(-this.player.yaw + Math.PI);
      ctx.fillStyle = '#b3261e';
      ctx.strokeStyle = '#fff3d6';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, -12);
      ctx.lineTo(8, 9);
      ctx.lineTo(0, 4);
      ctx.lineTo(-8, 9);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  private label(text: string, x: number, z: number, size: number, color: string, halo: boolean | 'dark', italic = false, rot = 0) {
    const ctx = this.ctx;
    const dpr = this.canvas.width / (this.canvas.getBoundingClientRect().width || 1);
    const [px, py] = this.toScreen(x, z);
    if (px < -200 || py < -50 || px > this.canvas.width + 200 || py > this.canvas.height + 50) return;
    ctx.save();
    ctx.translate(px, py);
    if (rot) ctx.rotate(rot > Math.PI / 2 || rot < -Math.PI / 2 ? rot + Math.PI : rot);
    ctx.font = `${italic ? 'italic ' : ''}${Math.round(size * dpr)}px Cinzel, 'Iowan Old Style', Georgia, serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (halo) {
      ctx.lineWidth = 3 * dpr;
      ctx.strokeStyle = halo === 'dark' ? 'rgba(40, 24, 12, 0.9)' : 'rgba(233, 216, 173, 0.85)';
      ctx.strokeText(text, 0, 0);
    }
    ctx.fillStyle = color;
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }
}

/** Plan de base sur parchemin, dessiné une fois : forêt, champs, rues, places, cimetière, bâtiments, rose des vents. */
function drawBase(): HTMLCanvasElement {
  const N = HALF * 2 * PX;
  const cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const g = cv.getContext('2d')!;
  const [cx, cz] = VILLAGE_CENTER;
  const P = (x: number, z: number): P2 => [(x - cx + HALF) * PX, (z - cz + HALF) * PX];
  const poly = (pts: P2[]) => {
    g.beginPath();
    pts.forEach(([x, z], i) => (i ? g.lineTo(...P(x, z)) : g.moveTo(...P(x, z))));
    g.closePath();
  };
  const r = rnd(7);
  // parchemin : fond, taches, grain, bords brûlés
  g.fillStyle = PAPER;
  g.fillRect(0, 0, N, N);
  for (let i = 0; i < 70; i++) {
    const x = r() * N;
    const y = r() * N;
    const rad = (20 + r() * 120) * PX * 0.25;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, `rgba(150, 110, 60, ${0.05 + r() * 0.08})`);
    gr.addColorStop(1, 'rgba(150, 110, 60, 0)');
    g.fillStyle = gr;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = `rgba(90, 60, 30, ${r() * 0.08})`;
    g.fillRect(r() * N, r() * N, 1 + r() * 2, 1 + r() * 2);
  }
  // forêt : petits arbres à l'encre au-delà de la lisière, plus serrés vers la limite
  g.strokeStyle = 'rgba(59, 42, 26, 0.55)';
  g.fillStyle = 'rgba(92, 110, 60, 0.35)';
  g.lineWidth = 1.2;
  for (let i = 0; i < 4200; i++) {
    const x = cx - HALF + r() * HALF * 2;
    const z = cz - HALF + r() * HALF * 2;
    const d = Math.hypot(x - cx, z - cz);
    const e = forestEdge(x, z);
    if (d < e || r() > Math.min(1, (d - e) / 30)) continue;
    const [px, py] = P(x, z);
    const s = (1.2 + r() * 1.2) * PX;
    g.beginPath();
    g.arc(px, py, s, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.beginPath();
    g.moveTo(px, py + s);
    g.lineTo(px, py + s * 1.8);
    g.stroke();
  }
  // limite de la carte : pointillé
  g.setLineDash([10, 8]);
  g.strokeStyle = 'rgba(122, 29, 20, 0.45)';
  g.lineWidth = 3;
  g.beginPath();
  for (let i = 0; i <= 160; i++) {
    const a = (i / 160) * Math.PI * 2;
    const d = limitAt(a);
    const [px, py] = P(cx + Math.cos(a) * d, cz + Math.sin(a) * d);
    i ? g.lineTo(px, py) : g.moveTo(px, py);
  }
  g.stroke();
  g.setLineDash([]);
  // champs (sillons), verger
  for (const f of FIELDS) {
    poly(fieldPoly(f));
    g.fillStyle = f.kind === 'fauche' ? 'rgba(160, 170, 90, 0.35)' : 'rgba(170, 130, 70, 0.32)';
    g.fill();
    g.save();
    g.clip();
    g.strokeStyle = 'rgba(90, 60, 30, 0.35)';
    g.lineWidth = 1;
    const [fx, fz] = P(f.cx, f.cz);
    g.translate(fx, fz);
    g.rotate(-f.rot);
    for (let k = -f.w * PX; k < f.w * PX; k += 6) {
      g.beginPath();
      g.moveTo(k, -f.d * PX);
      g.lineTo(k, f.d * PX);
      g.stroke();
    }
    g.restore();
    poly(fieldPoly(f));
    g.strokeStyle = 'rgba(59, 42, 26, 0.6)';
    g.stroke();
  }
  for (let i = 0; i < ORCHARD.cols; i++)
    for (let j = 0; j < ORCHARD.rows; j++) {
      const lx = (i - (ORCHARD.cols - 1) / 2) * ORCHARD.step;
      const lz = (j - (ORCHARD.rows - 1) / 2) * ORCHARD.step;
      const c = Math.cos(ORCHARD.rot);
      const s = Math.sin(ORCHARD.rot);
      const [px, py] = P(ORCHARD.cx + lx * c + lz * s, ORCHARD.cz - lx * s + lz * c);
      g.fillStyle = 'rgba(92, 110, 60, 0.6)';
      g.beginPath();
      g.arc(px, py, 2.2 * PX, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = INK;
      g.stroke();
    }
  // rues : bord sombre puis chaussée claire
  for (const pass of [0, 1])
    for (const p of PATHS) {
      g.strokeStyle = pass ? (p.road.kind === 'street' ? '#cfb88a' : '#d6c29a') : 'rgba(59, 42, 26, 0.7)';
      g.lineWidth = (p.road.width + (pass ? 0 : 0.9)) * PX;
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.beginPath();
      p.pts.forEach(([x, z], i) => (i ? g.lineTo(...P(x, z)) : g.moveTo(...P(x, z))));
      g.stroke();
    }
  // places pavées
  for (const pl of [PLAZA, CHURCH_SQUARE]) {
    poly(pl);
    g.fillStyle = '#cdb487';
    g.fill();
    g.strokeStyle = 'rgba(59, 42, 26, 0.7)';
    g.lineWidth = 2;
    g.stroke();
  }
  // cimetière : enclos et croix
  {
    const [a, b] = P(CEMETERY.x0, CEMETERY.z0);
    const [c, d] = P(CEMETERY.x1, CEMETERY.z1);
    g.fillStyle = 'rgba(120, 130, 80, 0.3)';
    g.fillRect(a, b, c - a, d - b);
    g.strokeStyle = INK;
    g.lineWidth = 2;
    g.strokeRect(a, b, c - a, d - b);
    g.lineWidth = 1.5;
    for (let x = CEMETERY.x0 + 3; x < CEMETERY.x1 - 1; x += 4)
      for (let z = CEMETERY.z0 + 3; z < CEMETERY.z1 - 1; z += 4) {
        const [px, py] = P(x, z);
        g.beginPath();
        g.moveTo(px, py - 5);
        g.lineTo(px, py + 5);
        g.moveTo(px - 3, py - 2);
        g.lineTo(px + 3, py - 2);
        g.stroke();
      }
  }
  // bâtiments : toits à l'encre, plus soutenus pour l'église et les lieux publics
  for (const b of BUILDINGS) {
    poly(footprint(b));
    g.fillStyle = b.kind === 'church' ? '#7d5a3e' : b.kind === 'abandoned' ? '#8d8070' : b.kind === 'house' ? '#a8714c' : '#93603f';
    g.fill();
    g.strokeStyle = INK;
    g.lineWidth = 2;
    g.stroke();
    // faîtage
    const [ax, az] = P(...footprintMid(b, -1));
    const [bx, bz] = P(...footprintMid(b, 1));
    g.strokeStyle = 'rgba(59, 42, 26, 0.6)';
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(ax, az);
    g.lineTo(bx, bz);
    g.stroke();
    if (b.kind === 'church') {
      const [px, py] = P(b.x, b.z);
      g.strokeStyle = '#f0e2bd';
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(px, py - 14);
      g.lineTo(px, py + 14);
      g.moveTo(px - 8, py - 5);
      g.lineTo(px + 8, py - 5);
      g.stroke();
    }
  }
  // rose des vents et cartouche
  rose(g, N - 150, 150, 90);
  g.fillStyle = 'rgba(233, 216, 173, 0.9)';
  g.strokeStyle = INK;
  g.lineWidth = 3;
  g.fillRect(60, N - 190, 620, 130);
  g.strokeRect(60, N - 190, 620, 130);
  g.strokeRect(70, N - 180, 600, 110);
  g.fillStyle = INK;
  g.textAlign = 'center';
  g.font = 'bold 44px Cinzel, Georgia, serif';
  g.fillText('Plan du village', 370, N - 128);
  g.font = 'italic 26px Georgia, serif';
  g.fillText('Saint-Aubin et ses abords', 370, N - 88);
  // bords assombris (vieux papier)
  const v = g.createRadialGradient(N / 2, N / 2, N * 0.35, N / 2, N / 2, N * 0.72);
  v.addColorStop(0, 'rgba(80, 50, 20, 0)');
  v.addColorStop(1, 'rgba(80, 50, 20, 0.45)');
  g.fillStyle = v;
  g.fillRect(0, 0, N, N);
  return cv;
}

function footprintMid(b: BuildingSpec, side: number): P2 {
  const fp = footprint(b);
  // milieu des deux pignons (côtés courts)
  const e = (i: number, j: number): P2 => [(fp[i][0] + fp[j][0]) / 2, (fp[i][1] + fp[j][1]) / 2];
  const wide = b.w >= b.d;
  return side < 0 ? (wide ? e(0, 3) : e(0, 1)) : wide ? e(1, 2) : e(3, 2);
}

function rose(g: CanvasRenderingContext2D, x: number, y: number, r: number) {
  g.save();
  g.translate(x, y);
  g.strokeStyle = INK;
  g.fillStyle = INK;
  g.lineWidth = 2;
  g.beginPath();
  g.arc(0, 0, r * 0.75, 0, Math.PI * 2);
  g.stroke();
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const len = k % 2 ? r * 0.55 : r;
    g.beginPath();
    g.moveTo(Math.cos(a + 0.12) * r * 0.14, Math.sin(a + 0.12) * r * 0.14);
    g.lineTo(Math.cos(a) * len, Math.sin(a) * len);
    g.lineTo(Math.cos(a - 0.12) * r * 0.14, Math.sin(a - 0.12) * r * 0.14);
    g.closePath();
    k % 4 === 0 ? g.fill() : g.stroke();
  }
  g.font = 'bold 30px Cinzel, Georgia, serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('N', 0, -r - 22);
  g.restore();
}
