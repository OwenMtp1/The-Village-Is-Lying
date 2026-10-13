/**
 * Réglages du joueur, gardés dans le navigateur (localStorage) et appliqués immédiatement :
 * sensibilité de la souris, volumes, qualité graphique, aide des commandes, réduction des animations.
 */
import { CAMERA } from '../characters/config';

export type QualityName = 'haute' | 'moyenne' | 'basse';

export interface Settings {
  /** multiplicateur de la sensibilité de base (CAMERA.sensitivity) */
  sensitivity: number;
  invertY: boolean;
  /** volumes de 0 à 1 */
  master: number;
  music: number;
  sfx: number;
  ambience: number;
  quality: QualityName;
  showControls: boolean;
  reduceMotion: boolean;
}

const KEY = 'village.reglages';
const BASE_SENSITIVITY = CAMERA.sensitivity;

const prefersReduced = () => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

export const DEFAULT_SETTINGS = (): Settings => ({
  sensitivity: 1,
  invertY: false,
  master: 0.8,
  music: 0.5,
  sfx: 0.8,
  ambience: 0.7,
  quality: 'moyenne',
  showControls: true,
  reduceMotion: prefersReduced(),
});

const clamp01 = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : d);

/** Valeurs relues et bornées : un stockage corrompu ou ancien ne casse rien. */
export function sanitize(raw: unknown): Settings {
  const d = DEFAULT_SETTINGS();
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Settings>;
  return {
    sensitivity: typeof r.sensitivity === 'number' && Number.isFinite(r.sensitivity) ? Math.max(0.2, Math.min(3, r.sensitivity)) : d.sensitivity,
    invertY: typeof r.invertY === 'boolean' ? r.invertY : d.invertY,
    master: clamp01(r.master, d.master),
    music: clamp01(r.music, d.music),
    sfx: clamp01(r.sfx, d.sfx),
    ambience: clamp01(r.ambience, d.ambience),
    quality: r.quality === 'haute' || r.quality === 'basse' || r.quality === 'moyenne' ? r.quality : d.quality,
    showControls: typeof r.showControls === 'boolean' ? r.showControls : d.showControls,
    reduceMotion: typeof r.reduceMotion === 'boolean' ? r.reduceMotion : d.reduceMotion,
  };
}

type Listener = (s: Settings) => void;

class SettingsStore {
  value: Settings;
  private listeners = new Set<Listener>();

  constructor() {
    let raw: unknown = null;
    try {
      raw = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    } catch {
      raw = null;
    }
    this.value = sanitize(raw);
    this.applyCore();
  }

  /** Abonnement : appelé tout de suite puis à chaque changement. */
  subscribe(fn: Listener) {
    this.listeners.add(fn);
    fn(this.value);
    return () => this.listeners.delete(fn);
  }

  set(patch: Partial<Settings>) {
    this.value = sanitize({ ...this.value, ...patch });
    try {
      localStorage.setItem(KEY, JSON.stringify(this.value));
    } catch {
      /* stockage indisponible : réglages gardés pour cette session seulement */
    }
    this.applyCore();
    for (const l of this.listeners) l(this.value);
  }

  reset() {
    this.set(DEFAULT_SETTINGS());
  }

  /** Effets qui ne dépendent d'aucun autre module : caméra et classes de la page. */
  private applyCore() {
    const s = this.value;
    CAMERA.sensitivity = BASE_SENSITIVITY * s.sensitivity;
    CAMERA.invertY = s.invertY;
    if (typeof document !== 'undefined') {
      document.documentElement.classList.toggle('reduce-motion', s.reduceMotion);
      document.documentElement.classList.toggle('hide-controls', !s.showControls);
    }
  }
}

export const settings = new SettingsStore();

export const QUALITY_INDEX: Record<QualityName, 0 | 1 | 2> = { haute: 0, moyenne: 1, basse: 2 };
