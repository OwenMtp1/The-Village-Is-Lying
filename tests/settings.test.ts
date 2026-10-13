/** Réglages du joueur : valeurs bornées, stockage corrompu sans effet, sensibilité appliquée à la caméra. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAMERA } from '../src/characters/config';
import { DEFAULT_SETTINGS, sanitize, settings } from '../src/ui/settings';

test('réglages : valeurs invalides ou absentes remplacées, bornes respectées', () => {
  const d = DEFAULT_SETTINGS();
  assert.deepEqual(sanitize(null), d);
  assert.deepEqual(sanitize('n’importe quoi'), d);
  const s = sanitize({ sensitivity: 99, master: -1, music: 2, sfx: Number.NaN, quality: 'ultra', showControls: 'oui', reduceMotion: true });
  assert.equal(s.sensitivity, 3);
  assert.equal(s.master, 0);
  assert.equal(s.music, 1);
  assert.equal(s.sfx, d.sfx);
  assert.equal(s.quality, 'moyenne');
  assert.equal(s.showControls, d.showControls);
  assert.equal(s.reduceMotion, true);
});

test('réglages : sensibilité et inversion appliquées à la caméra du personnage', () => {
  const base = CAMERA.sensitivity / settings.value.sensitivity;
  settings.set({ sensitivity: 2, invertY: true });
  assert.ok(Math.abs(CAMERA.sensitivity - base * 2) < 1e-12);
  assert.equal(CAMERA.invertY, true);
  settings.reset();
  assert.ok(Math.abs(CAMERA.sensitivity - base) < 1e-12);
  assert.equal(CAMERA.invertY, false);
});
