/**
 * Mini-carte du mode Gunfight (en bas à gauche, à la manière de GTA) : le plan du village sur parchemin, tourné
 * pour que le regard du joueur pointe vers le haut, centré sur lui. Points blancs : les coéquipiers (toujours) ;
 * points rouges : les adversaires, seulement quelques secondes après qu'ils ont tiré. Contour de la carte jouée ;
 * aux Souterrains, plan des galeries.
 */
import { villageBase } from './villageMap';
import { ROOMS, TUNNELS } from '../village/underground';
import type { GFMap } from '../shared/gunfightMaps';
import { h } from './dom';

export interface MiniDot {
  x: number;
  z: number;
  kind: 'allie' | 'ennemi';
  /** opacité (le point rouge s'efface) */
  a: number;
}

/** rayon visible (m) */
const RANGE = 55;

export class GFMinimap {
  readonly el = h(`<div class="gf-mini" aria-hidden="true"><canvas width="220" height="220"></canvas></div>`);
  private ctx = (this.el.querySelector('canvas') as HTMLCanvasElement).getContext('2d')!;
  private under: HTMLCanvasElement | null = null;

  render(map: GFMap, me: { x: number; z: number; yaw: number } | null, dots: MiniDot[]) {
    const g = this.ctx;
    const S = 220;
    const k = S / 2 / RANGE;
    g.save();
    g.clearRect(0, 0, S, S);
    g.beginPath();
    g.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = map.underground ? '#1d1712' : '#d9c595';
    g.fillRect(0, 0, S, S);
    if (!me) {
      g.restore();
      return;
    }
    // repère : joueur au centre, son regard vers le haut (x monde → droite, z monde → bas sur le plan)
    g.translate(S / 2, S / 2);
    g.rotate(-Math.PI / 2 - Math.atan2(Math.cos(me.yaw), Math.sin(me.yaw)));
    g.scale(k, k);
    g.translate(-me.x, -me.z);
    if (map.underground) {
      this.under ??= drawUnder();
      g.drawImage(this.under, -130, -130, 260, 260);
    } else {
      const b = villageBase();
      g.drawImage(b.canvas, b.center[0] - b.half, b.center[1] - b.half, b.half * 2, b.half * 2);
    }
    if (map.zone) {
      // hors de la carte : grisé ; limite en pointillés
      g.beginPath();
      g.rect(me.x - 400, me.z - 400, 800, 800);
      map.zone.forEach(([x, z], i) => (i ? g.lineTo(x, z) : g.moveTo(x, z)));
      g.closePath();
      g.fillStyle = 'rgba(40, 20, 10, 0.45)';
      g.fill('evenodd');
      g.setLineDash([2.5, 2]);
      g.lineWidth = 0.9;
      g.strokeStyle = '#7a1f12';
      g.beginPath();
      map.zone.forEach(([x, z], i) => (i ? g.lineTo(x, z) : g.moveTo(x, z)));
      g.closePath();
      g.stroke();
      g.setLineDash([]);
    }
    for (const d of dots) {
      g.globalAlpha = d.a;
      g.beginPath();
      g.arc(d.x, d.z, (d.kind === 'ennemi' ? 4 : 3.5) / k, 0, Math.PI * 2);
      g.fillStyle = d.kind === 'ennemi' ? '#e3241b' : '#ffffff';
      g.fill();
      g.lineWidth = 1.2 / k;
      g.strokeStyle = '#000';
      g.stroke();
    }
    g.globalAlpha = 1;
    g.restore();
    // le joueur : flèche au centre, pointe vers le haut
    g.save();
    g.translate(S / 2, S / 2);
    g.beginPath();
    g.moveTo(0, -9);
    g.lineTo(6.5, 7);
    g.lineTo(0, 3.5);
    g.lineTo(-6.5, 7);
    g.closePath();
    g.fillStyle = '#ffd34a';
    g.fill();
    g.lineWidth = 1.5;
    g.strokeStyle = '#000';
    g.stroke();
    g.restore();
  }
}

/** Plan des souterrains (repère monde, 260 m de côté centré sur l'origine, 2 px par mètre). */
function drawUnder(): HTMLCanvasElement {
  const N = 520;
  const cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const g = cv.getContext('2d')!;
  const P = (x: number, z: number) => [(x + 130) * 2, (z + 130) * 2] as const;
  g.fillStyle = '#1d1712';
  g.fillRect(0, 0, N, N);
  g.lineCap = 'square';
  for (const t of TUNNELS) {
    g.strokeStyle = t.secret ? '#5a4632' : '#a88a5c';
    g.lineWidth = t.w * 2;
    g.beginPath();
    t.pts.forEach(([x, z], i) => (i ? g.lineTo(...P(x, z)) : g.moveTo(...P(x, z))));
    g.stroke();
  }
  g.fillStyle = '#c2a36e';
  for (const r of ROOMS) {
    const [x0, z0] = P(r.x0, r.z0);
    const [x1, z1] = P(r.x1, r.z1);
    g.fillRect(x0, z0, x1 - x0, z1 - z0);
  }
  return cv;
}

/**
 * Aperçu d'une carte pour le choix à la création d'une salle : le plan (parchemin ou galeries) cadré sur la zone
 * jouable, le dehors assombri, la limite en pointillés et les points d'apparition.
 */
export function mapPreview(map: GFMap, W = 200, H = 120): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d')!;
  const pts = map.zone ?? map.spawns.map((p) => [p.x, p.z] as [number, number]);
  const xs = pts.map((p) => p[0]);
  const zs = pts.map((p) => p[1]);
  const pad = map.zone ? 6 : 14;
  const [x0, x1, z0, z1] = [Math.min(...xs) - pad, Math.max(...xs) + pad, Math.min(...zs) - pad, Math.max(...zs) + pad];
  const k = Math.min(W / (x1 - x0), H / (z1 - z0));
  g.fillStyle = map.underground ? '#1d1712' : '#d9c595';
  g.fillRect(0, 0, W, H);
  g.save();
  g.translate(W / 2, H / 2);
  g.scale(k, k);
  g.translate(-(x0 + x1) / 2, -(z0 + z1) / 2);
  if (map.underground) {
    const u = (underCache ??= drawUnder());
    g.drawImage(u, -130, -130, 260, 260);
  } else {
    const b = villageBase();
    g.drawImage(b.canvas, b.center[0] - b.half, b.center[1] - b.half, b.half * 2, b.half * 2);
  }
  if (map.zone) {
    g.beginPath();
    g.rect(x0 - 500, z0 - 500, x1 - x0 + 1000, z1 - z0 + 1000);
    map.zone.forEach(([x, z], i) => (i ? g.lineTo(x, z) : g.moveTo(x, z)));
    g.closePath();
    g.fillStyle = 'rgba(30, 15, 5, 0.55)';
    g.fill('evenodd');
    g.setLineDash([4 / k, 3 / k]);
    g.lineWidth = 1.6 / k;
    g.strokeStyle = '#9b2a18';
    g.beginPath();
    map.zone.forEach(([x, z], i) => (i ? g.lineTo(x, z) : g.moveTo(x, z)));
    g.closePath();
    g.stroke();
  }
  g.setLineDash([]);
  for (const p of map.spawns) {
    g.beginPath();
    g.arc(p.x, p.z, 1.8 / k, 0, Math.PI * 2);
    g.fillStyle = '#2f7de0';
    g.fill();
  }
  g.restore();
  return cv;
}
let underCache: HTMLCanvasElement | null = null;
