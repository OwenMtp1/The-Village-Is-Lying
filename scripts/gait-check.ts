/**
 * Mesure du glissement des pieds à différentes vitesses (Grand-Rue, ligne droite dégagée), pour des personnages
 * des deux sexes : sert à régler les vitesses de marche et de course sur les cycles capturés.
 * Pied en appui = cheville à moins de 2,5 cm de son point le plus bas ; on mesure sa vitesse horizontale
 * (médiane) pendant l'appui. 0 = pied parfaitement planté.
 */
import { chromium } from 'playwright-core';

const BASE = process.env.BASE ?? 'http://localhost:3001';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 320, height: 200 } });
await page.goto(BASE);
await page.waitForFunction(() => (window as any).__village, null, { timeout: 240_000 });
await page.evaluate(`window.__village.view.paused = true`);
for (const variant of ['F', 'M']) {
  await page.evaluate(`window.__village.game.start('${variant}')`);
  const id: string = await page.evaluate(`window.__village.game.player.variantId`);
  const speeds: any = await page.evaluate(`window.__village.game.player.animator.clipSpeeds`);
  console.log(`${id} — vitesses sans glissement des clips : marche lente ${speeds.walk_slow.toFixed(2)}, marche ${speeds.walk.toFixed(2)}, course ${speeds.run.toFixed(2)} m/s`);
  for (const [walk, run, keys] of [[1.1, 3.2, 'KeyW'], [1.3, 3.2, 'KeyW'], [1.45, 3.2, 'KeyW'], [1.7, 3.2, 'KeyW'], [1.95, 3.2, 'KeyW'], [1.45, 2.6, 'KeyW+ShiftLeft'], [1.45, 2.9, 'KeyW+ShiftLeft'], [1.45, 3.2, 'KeyW+ShiftLeft'], [1.45, 3.5, 'KeyW+ShiftLeft']] as const) {
    const r: any = await page.evaluate(`(() => {
      const w = window.__village; const g = w.game; const p = g.player; const V = p.root.position.constructor;
      w.config.MOVE.walkSpeed = ${walk}; w.config.MOVE.runSpeed = ${run};
      p.controller.place(18, 1.2); p.yaw = Math.PI / 2; g.cam.yaw = Math.PI / 2;
      const inp = w.input; const keys = ${JSON.stringify(keys.split('+'))};
      inp.down.clear(); for (const k of keys) inp.down.add(k);
      for (let i = 0; i < 150; i++) g.update(1 / 60);
      const feet = []; p.animator.model.traverse((o) => { if (o.name === 'L_Foot' || o.name === 'R_Foot') feet.push(o); });
      const prev = feet.map((f) => f.getWorldPosition(new V())); const samples = feet.map(() => []);
      const x0 = p.controller.x; const dt = 1 / 120;
      for (let i = 0; i < 240; i++) { g.update(dt); p.root.updateMatrixWorld(true); feet.forEach((f, j) => { const q = f.getWorldPosition(new V()); samples[j].push({ y: q.y, v: Math.hypot(q.x - prev[j].x, q.z - prev[j].z) / dt }); prev[j].copy(q); }); }
      inp.down.clear();
      const speed = (p.controller.x - x0) / (240 * dt);
      const slip = samples.map((s) => { const m = Math.min(...s.map((x) => x.y)); const st = s.filter((x) => x.y < m + 0.025).map((x) => x.v).sort((a, b) => a - b); return st[Math.floor(st.length / 2)]; });
      return { speed, slip: (slip[0] + slip[1]) / 2, cadence: p.animator.cadence, blocked: p.controller.blocked };
    })()`);
    console.log(`   ${keys.includes('Shift') ? 'course' : 'marche'} ${(keys.includes('Shift') ? run : walk).toFixed(2)} m/s → réelle ${r.speed.toFixed(2)}, cadence ${r.cadence.toFixed(2)} cycles/s, pied d'appui ${r.slip.toFixed(2)} m/s (${((100 * r.slip) / r.speed).toFixed(0)} %)${r.blocked ? ' [bloqué]' : ''}`);
  }
}
await browser.close();
