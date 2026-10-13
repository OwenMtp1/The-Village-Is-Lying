/**
 * Moteur audio : un seul AudioContext, créé au premier geste du joueur (règle des navigateurs), et quatre
 * bus réglables (général → musique, effets, ambiance). Tous les sons du jeu sont synthétisés par code
 * (Web Audio) : aucun fichier sonore, donc aucune licence à vérifier.
 * Sans Web Audio (navigateur ancien, contexte refusé), toutes les fonctions deviennent silencieuses.
 */
import { settings, type Settings } from '../ui/settings';

export interface Buses {
  ctx: AudioContext;
  master: GainNode;
  music: GainNode;
  sfx: GainNode;
  ambience: GainNode;
  /** bruit blanc de 2 s, réutilisé par tous les sons à base de bruit */
  noise: AudioBuffer;
}

let buses: Buses | null = null;
let failed = false;
const ready: ((b: Buses) => void)[] = [];

function create(): Buses | null {
  if (buses || failed) return buses;
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) throw new Error('Web Audio indisponible');
    const ctx = new Ctx();
    const g = () => ctx.createGain();
    const master = g();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    master.connect(comp).connect(ctx.destination);
    const music = g();
    const sfx = g();
    const ambience = g();
    music.connect(master);
    sfx.connect(master);
    ambience.connect(master);
    const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    buses = { ctx, master, music, sfx, ambience, noise };
    settings.subscribe(applyVolumes);
    for (const fn of ready.splice(0)) fn(buses);
  } catch {
    failed = true;
  }
  return buses;
}

function applyVolumes(s: Settings) {
  if (!buses) return;
  const t = buses.ctx.currentTime;
  // courbe perceptive : un curseur à mi-course sonne « à moitié »
  const v = (x: number) => x * x;
  buses.master.gain.setTargetAtTime(v(s.master), t, 0.05);
  buses.music.gain.setTargetAtTime(v(s.music) * 0.6, t, 0.05);
  buses.sfx.gain.setTargetAtTime(v(s.sfx), t, 0.05);
  buses.ambience.gain.setTargetAtTime(v(s.ambience) * 0.8, t, 0.05);
}

/** À appeler une fois : le son démarre au premier clic ou à la première touche. */
export function unlockOnGesture() {
  const go = () => {
    const b = create();
    if (b && b.ctx.state === 'suspended') void b.ctx.resume().catch(() => {});
  };
  window.addEventListener('pointerdown', go, { capture: true });
  window.addEventListener('keydown', go, { capture: true });
}

/** Bus audio s'ils existent (null avant le premier geste ou sans Web Audio). */
export function audio(): Buses | null {
  return buses && buses.ctx.state !== 'closed' ? buses : null;
}

/** Exécute `fn` dès que l'audio est disponible. */
export function whenAudio(fn: (b: Buses) => void) {
  if (buses) fn(buses);
  else if (!failed) ready.push(fn);
}
