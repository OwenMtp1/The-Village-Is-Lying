/**
 * Ambiance et musique, synthétisées :
 *  - vent continu (bruit filtré, rafales lentes) ;
 *  - la nuit : grillons et, de loin en loin, une chouette ; le jour : quelques oiseaux ;
 *  - musique du menu et du salon : nappe lente en ré mineur ; réunion : battement sourd de tension.
 * Le planificateur avance par petites fenêtres (100 ms) : aucun son n'est créé quand l'audio est coupé.
 */
import { audio, whenAudio, type Buses } from './engine';

export type MusicMode = 'menu' | 'jeu' | 'reunion' | 'silence';

const CHORDS = [
  [146.8, 174.6, 220.0, 293.7], // ré mineur
  [116.5, 146.8, 174.6, 233.1], // si bémol
  [130.8, 164.8, 196.0, 261.6], // do
  [110.0, 138.6, 164.8, 220.0], // la majeur (tension)
];

export class Ambience {
  private wind: { src: AudioBufferSourceNode; filter: BiquadFilterNode; gain: GainNode } | null = null;
  private daylight = 0;
  private active = true;
  private mode: MusicMode = 'menu';
  private nextCricket = 0;
  private nextBird = 0;
  private nextOwl = 0;
  private nextChord = 0;
  private chordIndex = 0;
  private nextBeat = 0;

  constructor() {
    whenAudio((b) => this.start(b));
    setInterval(() => this.schedule(), 100);
  }

  /** lumière du jour (0 nuit → 1 jour) et ambiance extérieure active (en partie ou menu) */
  set(daylight: number, active: boolean) {
    this.daylight = daylight;
    this.active = active;
  }

  setMusic(mode: MusicMode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.nextChord = 0;
    this.nextBeat = 0;
  }

  private start(b: Buses) {
    const src = b.ctx.createBufferSource();
    src.buffer = b.noise;
    src.loop = true;
    const filter = b.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 380;
    filter.Q.value = 0.4;
    const gain = b.ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(b.ambience);
    src.start();
    this.wind = { src, filter, gain };
  }

  private schedule() {
    const b = audio();
    if (!b || b.ctx.state !== 'running') return;
    const now = b.ctx.currentTime;
    const night = 1 - this.daylight;
    if (this.wind) {
      // rafales : deux sinus lents, plus de vent la nuit
      const gust = 0.5 + 0.3 * Math.sin(now * 0.13) + 0.2 * Math.sin(now * 0.041 + 1.3);
      const level = this.active ? (0.05 + 0.07 * gust) * (0.7 + 0.3 * night) : 0;
      this.wind.gain.gain.setTargetAtTime(level, now, 0.4);
      this.wind.filter.frequency.setTargetAtTime(280 + 320 * gust, now, 0.6);
    }
    if (this.active) {
      if (night > 0.4 && now >= this.nextCricket) {
        this.cricket(b, now, night);
        this.nextCricket = now + 0.4 + Math.random() * 1.6;
      }
      if (night > 0.7 && now >= this.nextOwl) {
        if (this.nextOwl) this.owl(b, now);
        this.nextOwl = now + 25 + Math.random() * 40;
      }
      if (this.daylight > 0.5 && now >= this.nextBird) {
        this.bird(b, now);
        this.nextBird = now + 1.5 + Math.random() * 5;
      }
    }
    this.music(b, now);
  }

  private blip(b: Buses, f0: number, f1: number, at: number, dur: number, gain: number, out: AudioNode = b.ambience, pan = 0) {
    const o = b.ctx.createOscillator();
    o.frequency.setValueAtTime(f0, at);
    o.frequency.exponentialRampToValueAtTime(f1, at + dur);
    const g = b.ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(gain, at + dur * 0.2);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    let node: AudioNode = o.connect(g);
    if (pan && b.ctx.createStereoPanner) {
      const p = b.ctx.createStereoPanner();
      p.pan.value = pan;
      node = node.connect(p);
    }
    node.connect(out);
    o.start(at);
    o.stop(at + dur + 0.02);
  }

  private cricket(b: Buses, now: number, night: number) {
    const f = 4200 + Math.random() * 700;
    const pan = Math.random() * 1.6 - 0.8;
    const n = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) this.blip(b, f, f * 0.99, now + i * 0.045, 0.03, 0.012 * night, b.ambience, pan);
  }

  private owl(b: Buses, now: number) {
    const pan = Math.random() * 1.4 - 0.7;
    this.blip(b, 420, 380, now, 0.35, 0.05, b.ambience, pan);
    this.blip(b, 400, 360, now + 0.55, 0.6, 0.045, b.ambience, pan);
  }

  private bird(b: Buses, now: number) {
    const pan = Math.random() * 1.6 - 0.8;
    const base = 2500 + Math.random() * 1800;
    const n = 2 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) this.blip(b, base * (1 + Math.random() * 0.3), base * (0.7 + Math.random() * 0.2), now + i * 0.12, 0.09, 0.02 * this.daylight, b.ambience, pan);
  }

  private music(b: Buses, now: number) {
    if (this.mode === 'menu' && now >= this.nextChord) {
      const chord = CHORDS[this.chordIndex++ % CHORDS.length];
      const dur = 9;
      for (const f of chord) {
        for (const det of [-4, 4]) {
          const o = b.ctx.createOscillator();
          o.type = 'triangle';
          o.frequency.value = f;
          o.detune.value = det;
          const flt = b.ctx.createBiquadFilter();
          flt.type = 'lowpass';
          flt.frequency.value = 900;
          const g = b.ctx.createGain();
          g.gain.setValueAtTime(0, now);
          g.gain.linearRampToValueAtTime(0.022, now + 3);
          g.gain.setValueAtTime(0.022, now + dur - 2.5);
          g.gain.linearRampToValueAtTime(0, now + dur + 1.5);
          o.connect(flt).connect(g).connect(b.music);
          o.start(now);
          o.stop(now + dur + 1.6);
        }
      }
      this.nextChord = now + dur;
    }
    if (this.mode === 'reunion' && now >= this.nextBeat) {
      // battement de cœur : deux coups graves
      this.blip(b, 62, 45, now, 0.18, 0.25, b.music);
      this.blip(b, 58, 42, now + 0.24, 0.2, 0.18, b.music);
      this.nextBeat = now + 1.1;
    }
  }
}
