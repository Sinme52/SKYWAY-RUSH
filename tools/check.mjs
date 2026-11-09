// ブラウザで実際に描画し、各場面のスクリーンショットと走行結果を確認する。
// 使い方: node tools/check.mjs <出力フォルダ>
import { createRequire } from 'module';
import http from 'http';
import fs from 'fs';
import path from 'path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = process.argv[2] || 'shots';
fs.mkdirSync(out, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg' };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  fs.readFile(p.endsWith('/') ? p + 'index.html' : p, (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(0);
const port = server.address().port;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(`http://localhost:${port}/index.html`);
await page.waitForFunction(() => document.body.classList.contains('ready'));
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/00_title.png` });

await page.goto(`http://localhost:${port}/index.html?autopilot`);
await page.waitForFunction(() => document.body.classList.contains('ready'));
await page.waitForTimeout(600);
await page.screenshot({ path: `${out}/01_countdown.png` });

const marks = (process.env.MARKS || '8,20,32').split(',').map(Number);
for (let course = 0; course < 3; course++) {
  await page.evaluate((i) => {
    window.__freeze = true;
    window.__setCourse(i);
    const g = window.__game;
    g.state = 'countdown';
    g.countdown = 3.999;
  }, course);
  let t = 0;
  for (const m of marks) {
    await page.evaluate((d) => window.__advance(d), m - t);
    t = m;
    await page.waitForTimeout(250);
    const info = await page.evaluate(() => {
      const g = window.__game, p = g.player;
      return { s: Math.round(p.s), kmh: Math.round(p.v * 3.6), lat: +p.lat.toFixed(2), y: +p.y.toFixed(1), draws: g.lastDrawCount };
    });
    console.log(`course${course + 1} t=${m}`, JSON.stringify(info));
    await page.screenshot({ path: `${out}/c${course + 1}_t${String(m).padStart(3, '0')}.png` });
  }
  // 最後まで走らせて順位とタイムを確認
  const result = await page.evaluate(() => {
    const g = window.__game;
    let air = 0, falls = 0, aiFalls = 0;
    for (let i = 0; i < 300 * 120 && g.state !== 'finish'; i++) {
      window.__advance(1 / 120);
      if (g.player.air && !g.player.fall && g.player.y - window.__roadY(g.player) > 0.3) air++;
      for (const c of g.cars) {
        if (c.fall && c.fall.t < 1 / 100) { if (c.isPlayer) falls++; else aiFalls++; }
      }
    }
    return { state: g.state, result: g.result, airSec: +(air / 120).toFixed(1), falls, aiFalls,
      places: g.cars.map((c) => Math.round(c.s)) };
  });
  console.log(`course${course + 1} result`, JSON.stringify(result));
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${out}/c${course + 1}_finish.png` });
}

// コースアウト → 落下 → 点滅して復帰
await page.evaluate(() => {
  window.__setCourse(0);
  const g = window.__game;
  g.state = 'race';
  window.__freeze = true;
  window.__advance(4);
  window.__fall();
});
// 落下中は COURSE OUT にならず、地面に落ちた時点で判定されることを確かめる
const startY = await page.evaluate(() => window.__game.player.fall.y);
const timeline = await page.evaluate(() => {
  const p = window.__game.player;
  const ev = { landedAt: null, landY: null, respawnAt: null, outBeforeLanding: false };
  for (let i = 1; i <= 8 * 120; i++) {
    window.__advance(1 / 120);
    const t = i / 120;
    if (p.fall && p.fall.landed && ev.landedAt === null) { ev.landedAt = +t.toFixed(2); ev.landY = +p.fall.y.toFixed(1); window.__landStep = i; }
    if (!p.fall && ev.respawnAt === null) { ev.respawnAt = +t.toFixed(2); break; }
  }
  return ev;
});
console.log('fall from y', startY.toFixed(1), JSON.stringify(timeline));
// 同じ落下を、場面ごとにスクリーンショットで残す
await page.evaluate(() => { window.__setCourse(0); const g = window.__game; g.state = 'race'; window.__freeze = true; window.__advance(4); window.__fall(); });
const shotsAt = [['a', 0.5], ['b', Math.max(0.05, timeline.landedAt - 0.5)], ['c', 0.62], ['d', 1.0]];
const fallLog = [];
for (const [k, d] of shotsAt) {
  await page.evaluate((d) => window.__advance(d), d);
  await page.waitForTimeout(150);
  fallLog.push(await page.evaluate(() => {
    const p = window.__game.player;
    return { falling: !!p.fall, landed: !!(p.fall && p.fall.landed), y: +p.y.toFixed(1), blink: +p.blink.toFixed(2) };
  }));
  await page.screenshot({ path: `${out}/fall_${k}.png` });
}
console.log('fall shots', JSON.stringify(fallLog));
// 復帰後に点滅が終わり、ふつうに走れること
const after = await page.evaluate(() => {
  window.__advance(3);
  window.__freeze = false;
  const p = window.__game.player;
  return { falling: !!p.fall, blink: p.blink, kmh: Math.round(p.v * 3.6) };
});
console.log('after respawn', JSON.stringify(after));
const fps = await page.evaluate(() => new Promise((res) => {
  let n = 0; const t0 = performance.now();
  const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else res(n / 2); };
  requestAnimationFrame(f);
}));
console.log('fps(headless)', fps);
console.log('errors', errors);
await browser.close();
server.close();
