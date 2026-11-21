/*!
 * Keep the Heat — game logic
 * (c) 2026 DIVELUX Inc. MIT License. https://diveluxsaunahat.com
 *
 * Pure functions, no DOM, no clock, no randomness except a seeded generator,
 * so every round can be replayed in a test. Works in the browser
 * (window.KeepHeat) and in Node (require('./game.js')).
 *
 * The model is a toy, not physics: wood burns down, the fire heats the
 * stones, the stones heat the room, the room leaks heat. Temperatures are in
 * degrees Celsius inside; the page shows Fahrenheit first.
 *
 * The only real-world figure is the top line: Harvia's stove manual says
 * "A good rule of thumb is that temperatures of over 100 ºC are too high in a
 * sauna." The green zone is a game setting, not a recommendation.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KeepHeat = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var CFG = {
    roundSec: 90,          // a round is one "session"; then the game sends you out to cool off
    ambient: 20,
    zoneLow: 75,           // game zone, °C
    zoneHigh: 90,
    tooHot: 100,           // Harvia: over 100 °C is too high in a sauna
    tooHotSec: 4,          // seconds over the line before the stove overheats
    coldSec: 12,           // seconds with no fire and the room below the zone before the round is lost
    burnPerSec: 0.07,      // logs burned per second at full draft
    heatPerLog: 25,        // stone heating per log burned (toy units)
    stoneToRoom: 0.06,     // per second
    roomLoss: 0.012,       // per second, room to outside
    maxFuel: 3,            // firebox holds three logs; more is refused
    logCooldown: 0.6,      // seconds between logs
    ladleCooldown: 2.5,
    ladleStoneDrop: 6,     // water takes heat from the stones
    ladleSteam: 1,
    steamDecay: 0.35,      // per second
    doorEvery: [14, 24],   // a guest opens the door every 14-24 s
    doorDrop: 4,           // °C lost when the door opens
    pointsPerSec: 10,      // in the zone
    ladleBonus: 25         // a ladle thrown while in the zone
  };

  /* Mulberry32: small seeded generator so rounds replay exactly in tests. */
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function create(seed) {
    var r = rng(seed == null ? 1 : seed);
    return {
      seed: seed == null ? 1 : seed, rand: r,
      t: 0, status: 'ready',           // ready | playing | over
      end: null,                        // done | overheated | cold
      fuel: 1, stones: 90, temp: 50, steam: 0,
      hotFor: 0, coldFor: 0,
      logWait: 0, ladleWait: 0,
      nextDoor: CFG.doorEvery[0] + r() * (CFG.doorEvery[1] - CFG.doorEvery[0]),
      score: 0, inZoneSec: 0, ladles: 0, logs: 0, doors: 0,
      events: []                        // short-lived messages for the screen
    };
  }

  function zone(s) { return s.temp >= CFG.zoneLow && s.temp <= CFG.zoneHigh ? 'in' : s.temp > CFG.zoneHigh ? 'hot' : 'cold'; }

  function start(s) { if (s.status === 'ready') s.status = 'playing'; return s; }

  /* Player actions. Each returns true if it happened. */
  function addLog(s) {
    if (s.status !== 'playing' || s.logWait > 0) return false;
    if (s.fuel + 1 > CFG.maxFuel + 1e-9) { s.events.push({ kind: 'full', t: s.t }); return false; }
    s.fuel += 1; s.logs++; s.logWait = CFG.logCooldown;
    s.events.push({ kind: 'log', t: s.t });
    return true;
  }
  function ladle(s) {
    if (s.status !== 'playing' || s.ladleWait > 0) return false;
    if (s.stones < s.temp + 20) { s.events.push({ kind: 'coldstones', t: s.t }); return false; }
    s.stones -= CFG.ladleStoneDrop; s.steam = Math.min(1.5, s.steam + CFG.ladleSteam);
    s.ladleWait = CFG.ladleCooldown; s.ladles++;
    if (zone(s) === 'in') { s.score += CFG.ladleBonus; s.events.push({ kind: 'loyly', t: s.t }); }
    else s.events.push({ kind: 'ladle', t: s.t });
    return true;
  }

  /* Advance the round by dt seconds. Call it with small steps (<= 0.1 s). */
  function step(s, dt) {
    if (s.status !== 'playing') return s;
    dt = Math.max(0, Math.min(dt, 0.1));
    s.t += dt;
    s.logWait = Math.max(0, s.logWait - dt);
    s.ladleWait = Math.max(0, s.ladleWait - dt);

    var burn = Math.min(s.fuel, CFG.burnPerSec * dt);
    s.fuel -= burn;
    s.stones += burn * CFG.heatPerLog;
    var toRoom = (s.stones - s.temp) * CFG.stoneToRoom * dt;
    s.stones -= toRoom * 0.5;
    s.temp += toRoom - (s.temp - CFG.ambient) * CFG.roomLoss * dt;
    s.steam = Math.max(0, s.steam - s.steam * CFG.steamDecay * dt);

    if (s.t >= s.nextDoor) {
      s.temp -= CFG.doorDrop; s.doors++;
      s.nextDoor = s.t + CFG.doorEvery[0] + s.rand() * (CFG.doorEvery[1] - CFG.doorEvery[0]);
      s.events.push({ kind: 'door', t: s.t });
    }

    var z = zone(s);
    if (z === 'in') { s.inZoneSec += dt; s.score += CFG.pointsPerSec * dt; }
    s.hotFor = s.temp > CFG.tooHot ? s.hotFor + dt : 0;
    s.coldFor = z === 'cold' && s.fuel < 0.05 ? s.coldFor + dt : 0;

    if (s.hotFor >= CFG.tooHotSec) finish(s, 'overheated');
    else if (s.coldFor >= CFG.coldSec) finish(s, 'cold');
    else if (s.t >= CFG.roundSec) finish(s, 'done');
    s.events = s.events.filter(function (e) { return s.t - e.t < 2; });
    return s;
  }

  function finish(s, why) {
    s.status = 'over'; s.end = why;
    if (why === 'done') s.score += 100;  // finishing the round and going out to cool off
    s.score = Math.round(s.score);
  }

  function cToF(c) { return c * 9 / 5 + 32; }

  /* Best score, kept only on this device. Storage may be blocked; never throw. */
  var KEY = 'divelux-keep-the-heat-best';
  function loadBest(storage) {
    try { var v = parseInt(storage.getItem(KEY), 10); return isFinite(v) && v > 0 ? v : 0; } catch (e) { return 0; }
  }
  function saveBest(storage, score) {
    var best = loadBest(storage);
    if (score > best) { try { storage.setItem(KEY, String(score)); } catch (e) { /* private mode */ } return true; }
    return false;
  }

  return { CFG: CFG, KEY: KEY, rng: rng, create: create, start: start, step: step, addLog: addLog, ladle: ladle, zone: zone, cToF: cToF, loadBest: loadBest, saveBest: saveBest };
});
