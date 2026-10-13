/**
 * Effets sonores synthétisés : interface (survol, clic, retour, notification), jeu (pas, saut, lampe,
 * coup de feu, cloche de réunion, vote, mort, victoire, défaite). Chaque son est un petit graphe Web Audio
 * jetable ; rien n'est joué tant que l'audio n'est pas débloqué par un geste du joueur.
 */
import { audio, type Buses } from './engine';

type Out = AudioNode;

function env(b: Buses, gain: number, attack: number, decay: number, at = b.ctx.currentTime) {
  const g = b.ctx.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(gain, at + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
  return g;
}

function tone(b: Buses, out: Out, type: OscillatorType, f0: number, f1: number, gain: number, attack: number, decay: number, at = b.ctx.currentTime) {
  const o = b.ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, at);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, at + attack + decay);
  const g = env(b, gain, attack, decay, at);
  o.connect(g).connect(out);
  o.start(at);
  o.stop(at + attack + decay + 0.05);
}

function noise(b: Buses, out: Out, filter: BiquadFilterType, freq: number, q: number, gain: number, attack: number, decay: number, at = b.ctx.currentTime) {
  const s = b.ctx.createBufferSource();
  s.buffer = b.noise;
  s.playbackRate.value = 0.8 + Math.random() * 0.4;
  const f = b.ctx.createBiquadFilter();
  f.type = filter;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = env(b, gain, attack, decay, at);
  s.connect(f).connect(g).connect(out);
  s.start(at, Math.random() * 1.5);
  s.stop(at + attack + decay + 0.05);
}

/** Bus des effets, éventuellement placé dans l'espace (panoramique et atténuation). */
function spatial(b: Buses, pan = 0, gain = 1): Out {
  const g = b.ctx.createGain();
  g.gain.value = gain;
  if (pan && b.ctx.createStereoPanner) {
    const p = b.ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    g.connect(p).connect(b.sfx);
  } else g.connect(b.sfx);
  return g;
}

const play = (fn: (b: Buses) => void) => {
  const b = audio();
  if (b && b.ctx.state === 'running') fn(b);
};

export const sfx = {
  hover: () => play((b) => tone(b, b.sfx, 'triangle', 1400, 1200, 0.025, 0.003, 0.05)),
  click: () =>
    play((b) => {
      // petit coup de bois
      tone(b, b.sfx, 'sine', 220, 140, 0.22, 0.002, 0.09);
      noise(b, b.sfx, 'bandpass', 1800, 2, 0.12, 0.001, 0.04);
    }),
  back: () => play((b) => tone(b, b.sfx, 'sine', 180, 110, 0.18, 0.002, 0.1)),
  /** notification discrète (arrivée d'un joueur, indice) */
  notify: () =>
    play((b) => {
      tone(b, b.sfx, 'sine', 880, 880, 0.08, 0.005, 0.5);
      tone(b, b.sfx, 'sine', 1320, 1320, 0.04, 0.005, 0.7, b.ctx.currentTime + 0.09);
    }),
  /** départ d'un joueur */
  leave: () => play((b) => tone(b, b.sfx, 'sine', 660, 440, 0.07, 0.005, 0.4)),
  error: () => play((b) => tone(b, b.sfx, 'square', 160, 150, 0.05, 0.005, 0.18)),
  /** pas : bruit sourd filtré, variations de hauteur ; `pan` et `gain` pour les autres joueurs */
  step: (gain = 1, pan = 0, run = false) =>
    play((b) => {
      const out = spatial(b, pan, gain);
      noise(b, out, 'lowpass', run ? 900 : 650 + Math.random() * 200, 0.7, run ? 0.32 : 0.22, 0.004, 0.09 + Math.random() * 0.03);
      tone(b, out, 'sine', 90 + Math.random() * 20, 60, run ? 0.12 : 0.08, 0.003, 0.06);
    }),
  jump: () => play((b) => noise(b, b.sfx, 'lowpass', 500, 0.8, 0.15, 0.01, 0.12)),
  land: (hard = 0.5) =>
    play((b) => {
      noise(b, b.sfx, 'lowpass', 420, 0.8, 0.2 + hard * 0.2, 0.003, 0.16);
      tone(b, b.sfx, 'sine', 80, 50, 0.15 + hard * 0.15, 0.003, 0.12);
    }),
  torch: () =>
    play((b) => {
      noise(b, b.sfx, 'highpass', 3000, 1, 0.1, 0.001, 0.025);
      tone(b, b.sfx, 'square', 2400, 2400, 0.02, 0.001, 0.02);
    }),
  /** coup de feu entendu de tout le village (non localisé : il ne révèle aucune position) */
  gunshot: () =>
    play((b) => {
      noise(b, b.sfx, 'lowpass', 5000, 0.5, 0.9, 0.001, 0.25);
      tone(b, b.sfx, 'sine', 120, 40, 0.8, 0.002, 0.35);
      // écho sur les façades
      noise(b, b.sfx, 'lowpass', 1400, 0.6, 0.25, 0.02, 1.6, b.ctx.currentTime + 0.12);
    }),
  /** cloche de l'église : partiels inharmoniques, longue résonance */
  bell: () =>
    play((b) => {
      const t = b.ctx.currentTime;
      for (let k = 0; k < 3; k++)
        for (const [ratio, g, d] of [
          [0.5, 0.18, 3.5],
          [1, 0.3, 2.8],
          [1.183, 0.12, 2.2],
          [1.506, 0.1, 1.8],
          [2, 0.08, 1.4],
          [2.74, 0.04, 0.9],
        ] as const)
          tone(b, b.sfx, 'sine', 392 * ratio, 392 * ratio * 0.998, g * 0.6, 0.004, d, t + k * 1.1);
    }),
  vote: () =>
    play((b) => {
      tone(b, b.sfx, 'sine', 300, 300, 0.14, 0.003, 0.18);
      noise(b, b.sfx, 'bandpass', 2400, 3, 0.08, 0.001, 0.05);
    }),
  /** le joueur est éliminé : coup sourd et accord dissonant */
  death: () =>
    play((b) => {
      tone(b, b.sfx, 'sine', 70, 35, 0.7, 0.004, 1.2);
      for (const f of [155.6, 164.8, 233]) tone(b, b.sfx, 'sawtooth', f, f * 0.97, 0.035, 0.05, 2.2);
    }),
  victory: () =>
    play((b) => {
      const t = b.ctx.currentTime;
      [261.6, 329.6, 392, 523.3].forEach((f, i) => tone(b, b.sfx, 'triangle', f, f, 0.14, 0.01, 1.6, t + i * 0.16));
    }),
  defeat: () =>
    play((b) => {
      const t = b.ctx.currentTime;
      [392, 311.1, 261.6, 196].forEach((f, i) => tone(b, b.sfx, 'triangle', f, f * 0.995, 0.12, 0.02, 1.4, t + i * 0.22));
    }),
};
