/* Checks for the game logic in game.js. Run: node test.js */
'use strict';
const G = require('./game.js');
const fs = require('fs');
const path = require('path');
let checks = 0; const failures = [];
function ok(c, m) { checks++; if (!c) failures.push(m); }

function play(policy, seed) {
  const s = G.start(G.create(seed));
  let guard = 0;
  while (s.status === 'playing' && guard++ < 10000) { policy(s); G.step(s, 0.05); }
  return s;
}
const idle = () => {};
const spam = (s) => G.addLog(s);
const smart = (s) => { if (s.temp < 82 && s.fuel < 0.6) G.addLog(s); if (G.zone(s) === 'in' && s.temp < 88) G.ladle(s); };

/* 1. Setup */
const s0 = G.create(5);
ok(s0.status === 'ready' && s0.score === 0 && G.zone(s0) === 'cold', 'fresh state');
ok(!G.addLog(s0) && !G.ladle(s0), 'no actions before start');
G.step(s0, 0.05); ok(s0.t === 0, 'no time passes before start');
ok(G.CFG.tooHot === 100, 'too-hot line is Harvia\'s 100 °C');
ok(G.CFG.zoneLow < G.CFG.zoneHigh && G.CFG.zoneHigh < G.CFG.tooHot, 'zone below the too-hot line');

/* 2. The three endings are all reachable, and the round is winnable */
for (const seed of [1, 2, 3, 42, 999]) {
  const a = play(idle, seed); ok(a.end === 'cold', 'idle player loses to cold, seed ' + seed + ': ' + a.end);
  const b = play(spam, seed); ok(b.end === 'overheated', 'log spammer overheats, seed ' + seed + ': ' + b.end);
  const c = play(smart, seed); ok(c.end === 'done' && c.inZoneSec > 45, 'careful player finishes, seed ' + seed + ': ' + c.end + ' ' + Math.round(c.inZoneSec));
  ok(c.score > b.score && c.score > a.score, 'careful play scores best, seed ' + seed);
  ok(Math.abs(c.t - G.CFG.roundSec) < 0.06, 'round length');
}

/* 3. Same seed, same round */
ok(JSON.stringify(play(smart, 7)) === JSON.stringify(play(smart, 7)), 'deterministic replay');

/* 4. Rules of the actions */
let s = G.start(G.create(3));
ok(G.addLog(s), 'first log'); ok(!G.addLog(s), 'log cooldown');
for (let i = 0; i < 40; i++) G.step(s, 0.05);
G.addLog(s); for (let i = 0; i < 20; i++) G.step(s, 0.05);
ok(s.fuel <= G.CFG.maxFuel + 1e-9, 'firebox never holds more than three logs');
for (let i = 0; i < 20; i++) G.step(s, 0.05); G.addLog(s);
ok(s.fuel <= G.CFG.maxFuel + 1e-9, 'still capped');
s = G.start(G.create(3)); s.stones = s.temp + 5;
ok(!G.ladle(s) && s.events.some((e) => e.kind === 'coldstones'), 'no steam from cold stones');
s = G.start(G.create(3)); s.temp = 80; s.stones = 140;
const sc = s.score; ok(G.ladle(s) && s.score === sc + G.CFG.ladleBonus, 'ladle in zone scores bonus');
ok(s.stones === 140 - G.CFG.ladleStoneDrop && s.steam > 0, 'ladle cools stones, makes steam');
ok(!G.ladle(s), 'ladle cooldown');

/* 5. Overheat needs 4 s over the line, not one spike */
s = G.start(G.create(3)); s.temp = 101; s.stones = 101; s.fuel = 0;
G.step(s, 0.05); ok(s.status === 'playing', 'one spike is not game over');
s = G.start(G.create(3)); s.stones = 400; s.temp = 105; s.fuel = 0;
for (let i = 0; i < 100 && s.status === 'playing'; i++) G.step(s, 0.05);
ok(s.end === 'overheated' && s.t >= G.CFG.tooHotSec - 0.01, 'overheat after ' + G.CFG.tooHotSec + ' s');

/* 6. Step is clamped so a sleeping tab cannot skip the round */
s = G.start(G.create(3)); G.step(s, 30); ok(s.t <= 0.1 + 1e-9, 'dt clamp');

/* 7. Door events come from the seeded generator, 14-24 s apart */
s = play(smart, 11);
ok(s.doors >= 3 && s.doors <= 7, 'doors in a round: ' + s.doors);

/* 8. Units */
ok(G.cToF(100) === 212 && G.cToF(75) === 167 && G.cToF(90) === 194, 'C to F');

/* 9. Best score storage: only on this device, never throws */
const mem = { d: {}, getItem(k) { return this.d[k] == null ? null : this.d[k]; }, setItem(k, v) { this.d[k] = v; } };
ok(G.loadBest(mem) === 0, 'empty best');
ok(G.saveBest(mem, 500) && G.loadBest(mem) === 500, 'save best');
ok(!G.saveBest(mem, 300) && G.loadBest(mem) === 500, 'lower score does not replace best');
const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
ok(G.loadBest(broken) === 0 && G.saveBest(broken, 10) === true, 'blocked storage does not throw');
mem.d[G.KEY] = 'junk'; ok(G.loadBest(mem) === 0, 'junk best ignored');

/* 10. The page: no network requests, sound off by default, one h1 */
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
ok(!/<(script|link)[^>]+(src|href)="https?:/i.test(html.replace(/<link rel="canonical"[^>]*>/, '')), 'no remote scripts or styles');
ok(!/fetch\(|XMLHttpRequest|WebSocket|sendBeacon|import\(/.test(app + fs.readFileSync(path.join(__dirname, 'game.js'), 'utf8')), 'no network APIs in code');
ok(/soundOn = false/.test(app) && /aria-pressed="false">Sound: off/.test(html), 'sound off by default');
ok(/prefers-reduced-motion/.test(app), 'reduced motion respected');
ok((html.match(/<h1[\s>]/g) || []).length === 1, 'one h1');

if (failures.length) { console.error(failures.length + ' of ' + checks + ' checks failed:\n' + failures.join('\n')); process.exit(1); }
console.log('All ' + checks + ' checks passed.');
