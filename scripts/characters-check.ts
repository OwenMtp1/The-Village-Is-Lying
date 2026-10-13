/**
 * Contrôle des personnages dans le navigateur (Chromium headless, page servie par `vite preview`) :
 *  1. les 40 personnages se chargent, chaque piste d'animation trouve son os ;
 *  2. choix du sexe → apparence du bon sexe, stable pendant la partie ;
 *  3. démarche : glissement des pieds en appui (marche, course), cadence, aucune action recréée ;
 *  4. saut : décollage, apogée, atterrissage ;
 *  5. captures : vue épaule et subjective, rue, intérieur, escalier, saut.
 *
 *   npm run build && npm start &   puis   npx tsx scripts/characters-check.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const BASE = process.env.BASE ?? 'http://localhost:3001';
const OUT = process.env.OUT ?? 'screenshots/personnages';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ deviceScaleFactor: 1, viewport: { width: Number(process.env.WIDTH ?? 960), height: Number(process.env.HEIGHT ?? 540) } });
const errors: string[] = [];
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && errors.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => errors.push(`[exception] ${e.message}`));
await page.goto(BASE);
await page.waitForFunction(() => (window as any).__village, null, { timeout: 240_000 });
// pas de boucle temps réel : la simulation est pilotée pas à pas (le rendu logiciel est trop lent)
await page.evaluate(`window.__village.view.paused = true`);

// 1. chargement de toute la base
const all: any[] = await page.evaluate(`window.__village.checkAll()`);
const bad = all.filter((a) => a.error || a.warnings?.length);
console.log(`1. ${all.length} personnages chargés, ${all.filter((a) => !a.error).length} sans erreur ; clips par personnage : ${[...new Set(all.map((a) => a.clips))].join(', ')} ; anomalies : ${bad.length ? JSON.stringify(bad) : 'aucune'}`);

// 2. choix du sexe (exploration solo : même tirage que les parties en ligne)
const picks: string[] = [];
for (const sex of ['F', 'M', 'F', 'M', 'F']) {
  const v: string = await page.evaluate(`window.__village.game.start('${sex}').then((i) => i.player.variant)`);
  picks.push(`${sex}→${v}`);
  if (!v.startsWith(sex.toLowerCase())) throw new Error(`apparence incohérente ${sex} → ${v}`);
}
await page.evaluate(`window.__village.enterGame()`);
console.log(`2. tirages : ${picks.join(' · ')}`);

// helpers dans la page (code en chaîne : pas de transformation par le compilateur de scripts)
await page.evaluate(`(() => {
  const w = window.__village;
  w.sim = (seconds, keys, fps = 60) => {
    const g = w.game; const inp = w.input; const dt = 1 / fps;
    const down = inp.down; down.clear(); for (const k of keys) down.add(k);
    for (let i = 0; i < Math.round(seconds * fps); i++) g.update(dt);
    down.clear();
  };
  w.press = (code) => { w.input.pressed.add(code); };
  w.shot = () => { w.view.renderFrame(); return w.view.renderer.domElement.toDataURL('image/png'); };
})()`);
const save = async (name: string) => {
  const png: string = await page.evaluate(`window.__village.shot()`);
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(png.split(',')[1], 'base64'));
};

// apparence stable pendant la partie
const before: string = await page.evaluate(`window.__village.game.info.player.variant`);
await page.evaluate(`window.__village.sim(3, ['KeyW'])`);
const after: string = await page.evaluate(`window.__village.game.info.player.variant + '|' + window.__village.game.player.variantId`);
console.log(`   apparence avant/après 3 s de jeu : ${before} / ${after}`);

// 3. démarche : glissement du pied d'appui
const gait = async (label: string, keys: string[]) => {
  const r: any = await page.evaluate(`(() => {
    const w = window.__village; const g = w.game; const p = g.player; const THREE_V = p.root.position.constructor;
    // place dégagée, direction nord-ouest → sud-est sur la place
    p.controller.place(-8, -6); p.yaw = 0; g.cam.yaw = 2.2;
    w.sim(2.5, ${JSON.stringify(keys)});
    const feet = []; p.animator.model.traverse((o) => { if (o.name === 'L_Toe0' || o.name === 'R_Toe0' || o.name === 'L_Foot' || o.name === 'R_Foot') feet.push(o); });
    const toes = feet.filter((f) => f.name.includes('Toe')).length ? feet.filter((f) => f.name.includes('Toe')) : feet.filter((f) => f.name.includes('Foot'));
    const mixerActions = p.animator.mixer._actions.length;
    const dt = 1 / 120; const prev = toes.map((f) => f.getWorldPosition(new THREE_V()));
    const samples = toes.map(() => []);
    let dist = 0; let last = p.root.position.clone();
    const inp = w.input; inp.down.clear(); for (const k of ${JSON.stringify(keys)}) inp.down.add(k);
    for (let i = 0; i < 240; i++) {
      g.update(dt); p.root.updateMatrixWorld(true);
      toes.forEach((f, j) => { const q = f.getWorldPosition(new THREE_V()); samples[j].push({ y: q.y, v: Math.hypot(q.x - prev[j].x, q.z - prev[j].z) / dt }); prev[j].copy(q); });
      dist += Math.hypot(p.root.position.x - last.x, p.root.position.z - last.z); last.copy(p.root.position);
    }
    inp.down.clear();
    const speed = dist / (240 * dt);
    // appui = pied au plus bas (5 cm au-dessus de son minimum) : sa vitesse au sol doit être faible
    const slip = samples.map((s) => { const m = Math.min(...s.map((x) => x.y)); const st = s.filter((x) => x.y < m + 0.04); return st.reduce((a, x) => a + x.v, 0) / st.length; });
    return { speed, slip, cadence: p.animator.cadence, actionsBefore: mixerActions, actionsAfter: p.animator.mixer._actions.length, variant: p.variantId };
  })()`);
  const slip = Math.min(...r.slip);
  console.log(`3. ${label} (${r.variant}) : vitesse ${r.speed.toFixed(2)} m/s, cadence ${r.cadence.toFixed(2)} cycles/s, glissement du pied d'appui ${slip.toFixed(2)} m/s (${((100 * slip) / r.speed).toFixed(0)} % de la vitesse), actions d'animation ${r.actionsBefore} → ${r.actionsAfter}`);
  return r;
};
await gait('marche', ['KeyW']);
await gait('course', ['KeyW', 'ShiftLeft']);

// 4. saut : trajectoire verticale et évènements
const jump: any = await page.evaluate(`(() => {
  const w = window.__village; const g = w.game; const p = g.player;
  p.controller.place(-8, -6); w.sim(0.5, []);
  const y0 = p.controller.y; const ys = []; let landed = -1; let jumps = 0;
  w.press('Space');
  for (let i = 0; i < 90; i++) { const was = p.controller.grounded; w.input.down.add('Space'); g.update(1 / 60); if (was && !p.controller.grounded) jumps++; ys.push(p.controller.y - y0); if (landed < 0 && i > 3 && p.controller.grounded) landed = i; }
  w.input.down.clear();
  return { apex: Math.max(...ys), landedAt: landed / 60, jumps, groundedEnd: p.controller.grounded };
})()`);
console.log(`4. saut (Espace maintenu 1,5 s) : apogée ${jump.apex.toFixed(2)} m, atterrissage après ${jump.landedAt.toFixed(2)} s, décollages ${jump.jumps}, au sol à la fin : ${jump.groundedEnd}`);

// 5. captures
const scene = async (name: string, x: number, z: number, camYaw: number, setup: string, after = '') => {
  await page.evaluate(`(() => { const w = window.__village; const g = w.game; g.player.controller.place(${x}, ${z}); g.player.yaw = ${camYaw}; g.cam.yaw = ${camYaw}; ${setup}; w.sim(0.6, []); ${after} })()`);
  await save(name);
};
await page.evaluate(`window.__village.enterGame()`);
await scene('epaule-place', -2, 12, Math.PI, `g.cam.pitch = -0.2`);
await scene('epaule-marche', -6, 10, Math.PI * 0.85, ``, `w.sim(0.9, ['KeyW'])`);
await scene('epaule-course', 22, 1.5, Math.PI / 2, ``, `w.sim(1.2, ['KeyW', 'ShiftLeft'])`);
await page.evaluate(`(() => { const w = window.__village; const p = w.game.player; p.controller.place(30, 1.8); p.yaw = Math.PI / 2; w.game.cam.yaw = Math.PI / 2 + 0.6; w.sim(0.5, ['KeyW']); w.press('Space'); w.sim(0.12, ['KeyW']); })()`);
await save('saut-montee');
await page.evaluate(`window.__village.sim(0.2, ['KeyW'])`);
await save('saut-apogee');
await page.evaluate(`(() => { const w = window.__village; let n = 0; while (!w.game.player.controller.grounded && n++ < 60) w.sim(1 / 60, ['KeyW']); w.sim(0.06, ['KeyW']); })()`);
await save('saut-atterrissage');
// intérieur de la taverne, en entrant par la porte
await page.evaluate(`(() => { const w = window.__village; const b = w.village.buildings.find((x) => x.spec.id === 'taverne'); const g = w.game; const m = b.matrix; const V = g.player.root.position.constructor; const a = new V(-1.2, 0, 9).applyMatrix4(m); g.player.controller.place(a.x, a.z); g.player.yaw = Math.PI + b.spec.rot; g.cam.yaw = Math.PI + b.spec.rot; g.cam.pitch = -0.15; w.sim(4.2, ['KeyW']); })()`);
const inside: string = await page.evaluate(`window.__village.view.placeName() + ' | ' + window.__village.game.player.controller.y.toFixed(2)`);
console.log(`5. après 4,2 s de marche vers la porte de la taverne : ${inside}`);
await save('interieur-taverne-epaule');
await page.evaluate(`(() => { const w = window.__village; w.press('KeyV'); w.sim(0.3, []); })()`);
await save('interieur-taverne-subjective');
await page.evaluate(`(() => { const w = window.__village; w.press('KeyV'); w.sim(0.3, []); })()`);
// escalier de la Maison du Drapier
const stairs: string = await page.evaluate(`(() => {
  const w = window.__village; const g = w.game; const b = w.village.buildings.find((x) => x.spec.id === 'drapier');
  const s = b.plan.stairs.find((q) => q.kind === 'stair');
  const R = s.rect; const V = g.player.root.position.constructor;
  const cx = (R.x0 + R.x1) / 2, cz = (R.z0 + R.z1) / 2;
  const half = Math.abs(s.dir[1]) > 0.5 ? (R.z1 - R.z0) / 2 : (R.x1 - R.x0) / 2;
  const a = new V(cx - s.dir[0] * (half + 0.6), 0, cz - s.dir[1] * (half + 0.6)).applyMatrix4(b.matrix);
  const e = new V(cx + s.dir[0], 0, cz + s.dir[1]).applyMatrix4(b.matrix);
  const fy = new V().setFromMatrixPosition(b.matrix).y;
  g.player.controller.x = a.x; g.player.controller.z = a.z; g.player.controller.y = fy; g.player.controller.grounded = true;
  const yaw = Math.atan2(e.x - a.x, e.z - a.z); g.player.yaw = yaw; g.cam.yaw = yaw; g.cam.pitch = -0.1;
  w.sim(1.6, ['KeyW']);
  return (g.player.controller.y - fy).toFixed(2) + ' m au-dessus du rez-de-chaussée à mi-parcours';
})()`);
console.log(`   escalier du drapier : ${stairs}`);
await save('escalier-drapier');
await page.evaluate(`window.__village.sim(2.5, ['KeyW'])`);
const top: string = await page.evaluate(`(() => { const w = window.__village; const b = w.village.buildings.find((x) => x.spec.id === 'drapier'); return (w.game.player.controller.y - b.matrix.elements[13]).toFixed(2); })()`);
console.log(`   en haut de l'escalier : ${top} m (étage à 3,10 m)`);
await save('escalier-drapier-arrivee');

console.log(errors.length ? `\n${errors.length} message(s) de console :\n${[...new Set(errors)].slice(0, 20).join('\n')}` : '\naucune erreur de console');
await browser.close();
