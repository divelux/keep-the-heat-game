/*!
 * Keep the Heat — screen, controls, sound
 * (c) 2026 DIVELUX Inc. MIT License. https://diveluxsaunahat.com
 * No network requests. Sound is off until the player turns it on.
 */
(function () {
  'use strict';
  var G = window.KeepHeat;
  var cv = document.getElementById('kth-canvas');
  if (!G || !cv || !cv.getContext) return;
  var ctx = cv.getContext('2d');
  var C = G.CFG;

  function $(n) { return document.querySelector('[data-o="' + n + '"]'); }
  function btn(n) { return document.querySelector('[data-a="' + n + '"]'); }
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var store = (function () { try { return window.localStorage; } catch (e) { return null; } })();

  var s = G.create((Date.now() % 100000) + 1);
  var best = store ? G.loadBest(store) : 0;
  var paused = false, last = 0, acc = 0, raf = 0;
  var useC = false, soundOn = false, audio = null;
  var lastZone = 'cold';
  var puffs = [];

  /* ---------- sound: tiny generated tones, never on by default ---------- */
  function tone(freq, ms, type) {
    if (!soundOn) return;
    try {
      if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
      var o = audio.createOscillator(), g = audio.createGain();
      o.type = type || 'sine'; o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, audio.currentTime);
      g.gain.exponentialRampToValueAtTime(0.12, audio.currentTime + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + ms / 1000);
      o.connect(g); g.connect(audio.destination); o.start(); o.stop(audio.currentTime + ms / 1000 + 0.02);
    } catch (e) { /* no audio */ }
  }

  /* ---------- text ---------- */
  function deg(c) { return useC ? Math.round(c) + ' °C' : Math.round(G.cToF(c)) + ' °F'; }
  function clock(sec) { sec = Math.max(0, Math.ceil(sec)); return Math.floor(sec / 60) + ':' + ('0' + sec % 60).slice(-2); }
  var liveT = 0;
  function say(t, now) { if (now || Date.now() - liveT > 2500) { $('live').textContent = t; liveT = Date.now(); } }

  function hud() {
    $('temp').textContent = deg(s.temp);
    $('time').textContent = clock(C.roundSec - s.t);
    $('score').textContent = Math.round(s.score);
    $('best').textContent = best;
    var z = G.zone(s);
    $('temp').className = 'kth-' + z;
    if (s.status === 'playing' && z !== lastZone) {
      say(z === 'in' ? 'In the zone, ' + deg(s.temp) + '.' : z === 'hot' ? 'Too hot, ' + deg(s.temp) + '. Hold the logs.' : 'Below the zone, ' + deg(s.temp) + '.');
      lastZone = z;
    }
  }

  /* ---------- drawing ---------- */
  var W = cv.width, H = cv.height;
  function px(v) { return Math.round(v) + 0.5; }
  function draw() {
    var hot = Math.max(0, Math.min(1, (s.stones - 40) / 120));
    var fire = Math.min(1, s.fuel);
    ctx.clearRect(0, 0, W, H);
    // wall and floor
    ctx.fillStyle = '#e9dfd0'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#c99b6c';
    for (var y = 0; y < H - 70; y += 34) ctx.fillRect(0, y, W, 2);
    ctx.fillStyle = '#7a4e2d'; ctx.fillRect(0, H - 70, W, 70);
    // stove body
    var sx = 150, sy = 190, sw = 260, sh = 220;
    ctx.fillStyle = '#2a1b13'; ctx.fillRect(sx, sy, sw, sh);
    ctx.fillStyle = '#1c110b'; ctx.fillRect(sx - 10, sy + sh - 6, sw + 20, 12);
    // firebox window
    var fx = sx + 60, fy = sy + 90, fw = sw - 120, fh = 80;
    ctx.fillStyle = '#120b07'; ctx.fillRect(fx, fy, fw, fh);
    if (fire > 0.02) {
      var flick = reduce ? 0 : Math.sin(s.t * 13) * 0.08 + Math.sin(s.t * 7.3) * 0.06;
      var fl = Math.max(0.15, fire * (0.85 + flick));
      var grd = ctx.createLinearGradient(0, fy + fh, 0, fy + fh - fh * fl);
      grd.addColorStop(0, '#f0762e'); grd.addColorStop(1, 'rgba(255,200,90,0.2)');
      ctx.fillStyle = grd;
      ctx.beginPath(); ctx.moveTo(fx + 8, fy + fh);
      for (var i = 0; i <= 6; i++) {
        var xx = fx + 8 + (fw - 16) * i / 6;
        var hh = fh * fl * (0.6 + 0.4 * Math.abs(Math.sin(i * 1.7 + (reduce ? 0 : s.t * 5))));
        ctx.lineTo(xx, fy + fh - hh);
      }
      ctx.lineTo(fx + fw - 8, fy + fh); ctx.closePath(); ctx.fill();
    }
    // logs in the firebox
    var logs = Math.ceil(s.fuel - 0.02);
    for (var l = 0; l < logs; l++) {
      ctx.fillStyle = '#5a3a22'; ctx.fillRect(fx + 14 + l * 4, fy + fh - 14 - l * 9, fw - 28, 9);
    }
    // stones, colored by their heat
    var r0 = 64 + hot * 120, g0 = 58 + hot * 20, b0 = 54 - hot * 20;
    for (var row = 0; row < 3; row++) {
      for (var k = 0; k < 7 - row; k++) {
        var cx = sx + 34 + k * 32 + row * 16, cy = sy - 12 - row * 22;
        ctx.fillStyle = 'rgb(' + Math.round(r0 - k * 3) + ',' + Math.round(g0) + ',' + Math.round(b0 + row * 4) + ')';
        ctx.beginPath(); ctx.ellipse(cx, cy, 17, 12, 0, 0, Math.PI * 2); ctx.fill();
      }
    }
    // steam
    if (s.steam > 0.03) {
      if (reduce) {
        ctx.fillStyle = 'rgba(255,255,255,' + Math.min(0.55, s.steam * 0.4) + ')';
        ctx.fillRect(sx - 20, 40, sw + 40, sy - 70);
      } else {
        if (puffs.length < 40 && Math.random() < s.steam) puffs.push({ x: sx + 40 + Math.random() * (sw - 80), y: sy - 60, r: 10 + Math.random() * 10, a: 0.5 });
      }
    }
    for (var p = puffs.length - 1; p >= 0; p--) {
      var pf = puffs[p];
      ctx.fillStyle = 'rgba(255,255,255,' + pf.a + ')';
      ctx.beginPath(); ctx.arc(pf.x, pf.y, pf.r, 0, Math.PI * 2); ctx.fill();
      if (!paused && s.status === 'playing') { pf.y -= 1.6; pf.r += 0.4; pf.a -= 0.008; }
      if (pf.a <= 0) puffs.splice(p, 1);
    }
    // door flash
    var door = s.events.filter(function (e) { return e.kind === 'door'; })[0];
    if (door) {
      ctx.fillStyle = 'rgba(29,92,69,' + (0.25 * (1 - (s.t - door.t) / 2)) + ')';
      ctx.fillRect(0, 0, 70, H - 70);
      ctx.fillStyle = '#1c110b'; ctx.font = '700 28px system-ui, sans-serif'; ctx.fillText('Door opened', 20, 40);
    }
    // thermometer
    var tx = 560, tTop = 60, tBot = H - 110, tw = 34;
    var lo = 20, hi = 110;
    var yOf = function (c) { return tBot - (Math.max(lo, Math.min(hi, c)) - lo) / (hi - lo) * (tBot - tTop); };
    ctx.fillStyle = '#fffdf9'; ctx.fillRect(tx, tTop, tw, tBot - tTop);
    ctx.fillStyle = 'rgba(29,92,69,0.28)'; ctx.fillRect(tx, yOf(C.zoneHigh), tw, yOf(C.zoneLow) - yOf(C.zoneHigh));
    ctx.strokeStyle = '#1c110b'; ctx.lineWidth = 2; ctx.strokeRect(px(tx), px(tTop), tw, tBot - tTop);
    var z = G.zone(s);
    ctx.fillStyle = z === 'hot' ? '#b3261e' : z === 'in' ? '#1d5c45' : '#4a3a30';
    ctx.fillRect(tx + 9, yOf(s.temp), tw - 18, tBot - yOf(s.temp));
    ctx.beginPath(); ctx.arc(tx + tw / 2, tBot + 18, 22, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#b3261e'; ctx.setLineDash([6, 4]);
    ctx.beginPath(); ctx.moveTo(tx - 14, px(yOf(C.tooHot))); ctx.lineTo(tx + tw + 14, px(yOf(C.tooHot))); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#1c110b'; ctx.font = '600 24px system-ui, sans-serif'; ctx.textAlign = 'right';
    ctx.fillText(useC ? '100 °C' : '212 °F', tx - 18, yOf(C.tooHot) + 6);
    ctx.fillStyle = '#1d5c45';
    ctx.fillText('zone', tx - 18, (yOf(C.zoneHigh) + yOf(C.zoneLow)) / 2 + 6);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#1c110b'; ctx.font = '700 30px system-ui, sans-serif';
    ctx.fillText(deg(s.temp), tx - 8, tBot + 80 > H - 8 ? H - 14 : tBot + 80);
    // messages
    var ev = s.events[s.events.length - 1];
    var msg = ev && { full: 'Firebox is full', coldstones: 'Stones are not hot enough', loyly: 'Good steam! +25', log: 'Log in', ladle: 'Splash', door: '' }[ev.kind];
    if (msg) { ctx.fillStyle = '#1c110b'; ctx.font = '700 32px system-ui, sans-serif'; ctx.fillText(msg, 150, 110); }
  }

  /* ---------- loop ---------- */
  function frame(ts) {
    raf = 0;
    if (s.status !== 'playing' || paused) { draw(); return; }
    if (!last) last = ts;
    acc += Math.min(0.25, (ts - last) / 1000); last = ts;
    while (acc >= 0.05) { G.step(s, 0.05); acc -= 0.05; }
    handleEvents();
    hud(); draw();
    if (s.status === 'over') return ended();
    raf = requestAnimationFrame(frame);
  }
  function loop() { if (!raf) { last = 0; raf = requestAnimationFrame(frame); } }

  var seen = 0;
  function handleEvents() {
    s.events.forEach(function (e) {
      if (e.t <= seen) return;
      seen = e.t;
      if (e.kind === 'door') { say('Someone opened the door. The room cooled a little.', true); tone(330, 120); }
      if (e.kind === 'loyly') tone(660, 160, 'triangle');
    });
  }

  function setPlaying(on) {
    btn('log').disabled = !on; btn('ladle').disabled = !on; btn('pause').disabled = !on;
  }

  function ended() {
    setPlaying(false);
    var isBest = store ? G.saveBest(store, s.score) : false;
    if (isBest) best = s.score;
    hud();
    var head = { done: 'Round over. Time to cool off.', overheated: 'The stove overheated', cold: 'The fire went out' }[s.end];
    var body = { done: 'In a real sauna this is where you step out, cool down and have some water before the next round.',
      overheated: 'The room stayed over ' + (useC ? '100 °C' : '212 °F') + '. Fewer logs at a time, and let the stones catch up.',
      cold: 'The room fell below the zone with no wood left. Add a log a little before the fire dies.' }[s.end];
    $('overh').textContent = head;
    $('overp').textContent = 'Score ' + s.score + (isBest ? ', a new best.' : '. Best ' + best + '.') + ' ' + Math.round(s.inZoneSec) + ' seconds in the zone. ' + body;
    btn('start').textContent = 'Play again';
    $('over').hidden = false;
    say(head + ' Score ' + s.score + '.', true);
    tone(s.end === 'done' ? 520 : 200, 300);
    btn('start').focus();
  }

  function startRound() {
    s = G.start(G.create((Date.now() % 100000) + 1));
    seen = 0; puffs = []; paused = false; acc = 0; lastZone = 'cold';
    btn('pause').textContent = 'Pause';
    $('over').hidden = true;
    setPlaying(true);
    hud(); loop();
    say('Round started. Keep the room in the zone.', true);
    btn('log').focus();
  }

  function doLog() { if (G.addLog(s)) tone(180, 90, 'square'); hud(); draw(); }
  function doLadle() { if (G.ladle(s)) tone(880, 80); hud(); draw(); }
  function togglePause() {
    if (s.status !== 'playing') return;
    paused = !paused;
    btn('pause').textContent = paused ? 'Resume' : 'Pause';
    btn('log').disabled = paused; btn('ladle').disabled = paused;
    say(paused ? 'Paused.' : 'Playing.', true);
    if (!paused) loop();
  }

  btn('start').addEventListener('click', startRound);
  btn('log').addEventListener('click', doLog);
  btn('ladle').addEventListener('click', doLadle);
  btn('pause').addEventListener('click', togglePause);
  btn('sound').addEventListener('click', function () {
    soundOn = !soundOn;
    this.setAttribute('aria-pressed', String(soundOn));
    this.textContent = 'Sound: ' + (soundOn ? 'on' : 'off');
    if (soundOn) tone(520, 120);
  });
  btn('units').addEventListener('click', function () {
    useC = !useC;
    this.setAttribute('aria-pressed', String(useC));
    this.textContent = useC ? 'Show °F' : 'Show °C';
    hud(); draw();
  });
  document.addEventListener('keydown', function (e) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    var t = e.target;
    if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    var k = e.key;
    if (s.status !== 'playing') return;
    if (k === 'l' || k === 'L' || k === 'ArrowUp') { e.preventDefault(); if (!paused) doLog(); }
    else if (k === 'w' || k === 'W' || (k === ' ' && !(t && t.tagName === 'BUTTON'))) { e.preventDefault(); if (!paused) doLadle(); }
    else if (k === 'p' || k === 'P' || k === 'Escape') { e.preventDefault(); togglePause(); }
  });
  document.addEventListener('visibilitychange', function () { if (document.hidden && s.status === 'playing' && !paused) togglePause(); });

  hud(); draw();
})();
