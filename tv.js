/* Iron Timer TV — Fire TV version, driven by the remote. Same timers as the phone app, no camera. */
'use strict';
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

/* ---------- storage ---------- */
const LS = {
  get(k, d) { try { const v = localStorage.getItem('itv_' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('itv_' + k, JSON.stringify(v)); } catch (e) {} }
};
const S = Object.assign({ cd: 10, beep: true, voice: true }, LS.get('set', {}));
const saveS = () => LS.set('set', S);

/* ---------- helpers ---------- */
const pad = n => String(n).padStart(2, '0');
function fmt(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  return h ? h + ':' + pad(m) + ':' + pad(s) : m + ':' + pad(s);
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function toast(t) { const e = $('#toast'); e.textContent = t; e.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => e.classList.remove('on'), 2400); }
function setText(el, t) { if (el.textContent !== t) el.textContent = t; }

/* ---------- modes ---------- */
const MODES = {
  fortime: { n: 'For Time', d: 'Cronometro con time cap', def: { cap: 0 } },
  amrap: { n: 'AMRAP', d: 'Più round possibili nel tempo', def: { dur: 720 } },
  emom: { n: 'EMOM', d: 'Ogni intervallo, un round', def: { every: 60, rounds: 10 } },
  tabata: { n: 'Tabata', d: 'Lavoro / riposo a secondi', def: { work: 20, rest: 10, rounds: 8 } },
  interval: { n: 'Intervalli', d: 'Lavoro / riposo a minuti', def: { work: 180, rest: 60, rounds: 5 } },
  clock: { n: 'Cronometro', d: 'Conta in avanti, senza limiti', def: {} }
};
/* key, label, type (t = h:m:s, s = seconds, n = number), optional (0 allowed) */
const FIELDS = {
  fortime: [['cap', 'Time cap (facoltativo)', 't', true]],
  amrap: [['dur', 'Durata', 't']],
  emom: [['every', 'Ogni', 't'], ['rounds', 'Round', 'n']],
  tabata: [['work', 'Lavoro', 's'], ['rest', 'Riposo', 's'], ['rounds', 'Round', 'n']],
  interval: [['work', 'Lavoro', 't'], ['rest', 'Riposo', 't'], ['rounds', 'Round', 'n']],
  clock: []
};
function cfgLabel(c) {
  switch (c.mode) {
    case 'fortime': return 'For Time' + (c.cap ? ' · cap ' + fmt(c.cap) : '');
    case 'amrap': return 'AMRAP ' + fmt(c.dur);
    case 'emom': return 'EMOM ' + c.rounds + ' × ' + fmt(c.every);
    case 'tabata': return 'Tabata ' + c.rounds + ' × ' + c.work + '/' + c.rest;
    case 'interval': return 'Intervalli ' + c.rounds + ' × ' + fmt(c.work) + '/' + fmt(c.rest);
    case 'clock': return 'Cronometro';
  }
  return '';
}
const wodName = c => c.name || cfgLabel(c);

/* ---------- audio ---------- */
let AC = null;
function audio() {
  if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }
  if (AC && AC.state === 'suspended') AC.resume();
  return AC;
}
function beep(f = 880, d = 0.12, v = 0.5) {
  if (!S.beep) return;
  const a = audio(); if (!a) return;
  const o = a.createOscillator(), g = a.createGain(), t = a.currentTime;
  o.type = 'square'; o.frequency.value = f;
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v * 0.35, t + 0.01);
  g.gain.setValueAtTime(v * 0.35, t + d - 0.02); g.gain.linearRampToValueAtTime(0, t + d);
  o.connect(g); g.connect(a.destination);
  o.start(t); o.stop(t + d + 0.02);
}
/* inside the Fire TV app the voice comes from the system (window.IronTTS); in a browser, from speechSynthesis */
function say(t) {
  if (!S.voice) return;
  try {
    if (window.IronTTS) { window.IronTTS.speak(t); return; }
    if (!window.speechSynthesis) return;
    speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(t); u.lang = 'it-IT'; u.rate = 1.05; speechSynthesis.speak(u);
  } catch (e) {}
}

/* ---------- screen on (the Fire TV app already keeps it on by itself) ---------- */
let wl = null;
async function wake(on) {
  try {
    if (on && !wl && navigator.wakeLock) { wl = await navigator.wakeLock.request('screen'); wl.addEventListener('release', () => wl = null); }
    if (!on && wl) { await wl.release(); wl = null; }
  } catch (e) {}
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && E.running) wake(true); });

/* ---------- timer engine ---------- */
const E = {
  cfg: null, segs: [], total: 0, t0: 0, paused: false, pauseAt: 0, pausedTot: 0,
  running: false, done: false, rounds: [], key: '', idx: -1, endAt: 0,
  build(c) {
    const s = [];
    if (S.cd > 0) s.push({ k: 'prep', d: S.cd });
    switch (c.mode) {
      case 'fortime': s.push({ k: 'work', d: c.cap || Infinity, up: true }); break;
      case 'clock': s.push({ k: 'work', d: Infinity, up: true }); break;
      case 'amrap': s.push({ k: 'work', d: c.dur }); break;
      case 'emom': for (let i = 1; i <= c.rounds; i++) s.push({ k: 'work', d: c.every, r: i, n: c.rounds }); break;
      case 'tabata': case 'interval':
        for (let i = 1; i <= c.rounds; i++) {
          s.push({ k: 'work', d: c.work, r: i, n: c.rounds });
          if (i < c.rounds && c.rest > 0) s.push({ k: 'rest', d: c.rest, r: i, n: c.rounds });
        }
        break;
    }
    let acc = 0; s.forEach(x => { x.at = acc; acc += x.d; });
    this.segs = s; this.total = acc;
  },
  start(c) {
    this.cfg = c; this.build(c);
    this.t0 = performance.now(); this.paused = false; this.pausedTot = 0;
    this.running = true; this.done = false; this.rounds = []; this.key = ''; this.idx = -1;
    audio(); wake(true);
  },
  el() { return ((this.paused ? this.pauseAt : performance.now()) - this.t0 - this.pausedTot) / 1000; },
  pause() { if (!this.running || this.done) return; if (this.paused) { this.pausedTot += performance.now() - this.pauseAt; this.paused = false; } else { this.pauseAt = performance.now(); this.paused = true; } },
  workStart() { const w = this.segs.find(x => x.k === 'work'); return w ? w.at : 0; },
  workEl() { return Math.max(0, Math.min(this.el(), this.done ? this.endAt : 1e9) - this.workStart()); },
  state() {
    if (!this.cfg) return null;
    const el = this.done ? this.endAt : this.el();
    let i = this.segs.findIndex(x => el < x.at + x.d);
    if (i < 0) i = this.segs.length - 1;
    const sg = this.segs[i], se = el - sg.at, rem = sg.d - se;
    const st = { seg: sg, idx: i, phase: sg.k, el, se, rem };
    if (sg.k === 'prep') { st.big = String(Math.max(1, Math.ceil(rem))); st.lbl = 'Pronti'; st.secs = Math.ceil(rem); }
    else if (sg.up) { st.big = fmt(se); st.secs = Math.floor(se); st.lbl = this.cfg.mode === 'clock' ? 'Tempo' : 'For Time'; }
    else { st.big = fmt(Math.ceil(rem - 1e-6)); st.secs = Math.ceil(rem - 1e-6); st.lbl = sg.k === 'rest' ? 'Riposo' : (this.cfg.mode === 'amrap' ? 'AMRAP' : 'Lavoro'); }
    if (this.done) st.lbl = 'Fine';
    if (sg.r) st.round = 'Round ' + sg.r + '/' + sg.n;
    else if (['fortime', 'amrap', 'clock'].includes(this.cfg.mode) && sg.k === 'work') st.round = 'Round ' + (this.rounds.length + 1);
    return st;
  },
  tick() {
    if (!this.running || this.paused || this.done) return;
    const el = this.el();
    if (el >= this.total) { this.finish(true); return; }
    const st = this.state(), k = st.idx + ':' + st.secs;
    if (k === this.key) return;
    const newSeg = st.idx !== this.idx;
    this.key = k; this.idx = st.idx;
    const sg = st.seg;
    if (newSeg) {
      if (sg.k === 'prep') say('Pronti');
      else if (sg.k === 'work') {
        beep(1320, 0.45, 0.7);
        if (sg.r && sg.r === sg.n && sg.n > 1) say('Ultimo round'); else if (!sg.r || sg.r === 1) say('Via!');
      } else if (sg.k === 'rest') { beep(520, 0.45, 0.7); say('Riposo'); }
      return;
    }
    if (!sg.up || isFinite(sg.d)) {
      const r = Math.ceil(sg.d - st.se - 1e-6);
      if (r <= 3 && r >= 1 && (sg.d >= 4 || sg.k === 'prep')) beep(880, 0.12, 0.6);
      if (this.cfg.mode === 'amrap' && sg.k === 'work' && sg.d >= 180 && r === 60) say('Ultimo minuto');
    }
  },
  finish(natural) {
    if (this.done) return;
    this.endAt = Math.min(this.el(), this.total);
    this.done = true; this.running = false; this.paused = false;
    if (natural) { beep(1320, 0.25, 0.8); setTimeout(() => beep(1320, 0.25, 0.8), 330); setTimeout(() => beep(1760, 0.6, 0.8), 660); say('Tempo!'); }
    wake(false);
    if (cur === 'run') openResult();
  },
  reset() { this.cfg = null; this.running = false; this.done = false; this.paused = false; }
};
setInterval(() => { E.tick(); if (cur === 'run' && E.cfg) drawRun(); }, 100);

/* ---------- navigation ---------- */
let cur = '', leaving = false;
function show(v, first) {
  cur = v;
  $$('.view').forEach(x => x.classList.toggle('on', x.id === v));
  if (v === 'home') renderHome();
  if (v === 'hist') renderHist();
  if (v === 'sett') renderSett();
  focusIn(first);
}
function focusIn(el) {
  const t = el || $('#' + cur + ' .f');
  if (t) t.focus();
}
/* the remote's Back button walks the browser history: one entry for "away from home" */
function go(v, first) {
  if (cur === 'home' && v !== 'home') history.pushState({ away: 1 }, '');
  show(v, first);
}
function goHome() {
  if (history.state && history.state.away) { leaving = true; history.back(); }
  else show('home');
}
addEventListener('popstate', () => {
  if (leaving) { leaving = false; show('home'); return; }
  // Back during a timer pauses it instead of losing the WOD
  if (cur === 'run') { history.pushState({ away: 1 }, ''); if (!E.done && !E.paused && E.running) E.pause(); drawRun(); $('#runStop').focus(); return; }
  if (cur === 'result') { history.pushState({ away: 1 }, ''); $('#resDiscard').focus(); return; }
  show('home');
});

/* ---------- remote: arrows move between controls, up/down change the value on a number box ---------- */
function move(dir) {
  const a = document.activeElement;
  const all = $$('#' + cur + ' .f').filter(e => !e.hidden && e.offsetParent !== null);
  if (!a || !all.includes(a)) { if (all[0]) all[0].focus(); return; }
  const r = a.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  let best = null, bs = Infinity;
  all.forEach(e => {
    if (e === a) return;
    const q = e.getBoundingClientRect(), x = q.left + q.width / 2, y = q.top + q.height / 2;
    const horiz = dir === 'L' || dir === 'R';
    // distance between the edges in the direction of travel, centers on the other axis
    const main = dir === 'L' ? r.left - q.right : dir === 'R' ? q.left - r.right : dir === 'U' ? r.top - q.bottom : q.top - r.bottom;
    const ctr = dir === 'L' ? cx - x : dir === 'R' ? x - cx : dir === 'U' ? cy - y : y - cy;
    if (ctr <= 1 || main < -Math.min(horiz ? r.width : r.height, horiz ? q.width : q.height) / 2) return;
    const cross = horiz ? Math.abs(y - cy) : Math.abs(x - cx);
    const s = Math.max(0, main) + cross * 2;
    if (s < bs) { bs = s; best = e; }
  });
  if (best) { best.focus(); best.scrollIntoView({ block: 'nearest' }); }
}
const KEYS = { 37: 'L', 38: 'U', 39: 'R', 40: 'D', 19: 'U', 20: 'D', 21: 'L', 22: 'R' };
addEventListener('keydown', e => {
  audio();
  const a = document.activeElement, dir = KEYS[e.keyCode];
  if (dir) {
    e.preventDefault();
    if (a && a.spin && (dir === 'U' || dir === 'D')) { a.spin(dir === 'U' ? 1 : -1, e.repeat); return; }
    move(dir);
    return;
  }
  if (e.keyCode === 179 || e.keyCode === 85 || e.key === 'MediaPlayPause') { // play/pause on the remote
    e.preventDefault();
    if (cur === 'run') $('#runPause').click();
    return;
  }
  if (e.keyCode === 13 || e.keyCode === 23) {
    if (a && a.tagName === 'INPUT') return; // let the system open the on-screen keyboard
    e.preventDefault();
    if (!e.repeat && a && a.click) a.click();
  }
});
// a mouse-free device can still lose focus (e.g. after the keyboard closes): put it back on the next arrow
addEventListener('click', () => { if (document.activeElement === document.body) focusIn(); });

/* ---------- home ---------- */
function renderHome() {
  const lastM = LS.get('lastMode', 'amrap');
  $('#modes').innerHTML = Object.entries(MODES).map(([k, m]) => `<button class="mode f" data-m="${k}"><b>${m.n}</b><span>${m.d}</span></button>`).join('');
  $$('#modes .mode').forEach(b => b.onclick = () => openSetup(b.dataset.m));
  const P = LS.get('presets', []);
  $('#presets').innerHTML = P.map((p, i) => `<button class="btn f" data-i="${i}">${esc(wodName(p))}</button>`).join('');
  $$('#presets .btn').forEach(b => b.onclick = () => openSetup(P[+b.dataset.i].mode, +b.dataset.i));
  const t = $('#modes [data-m="' + lastM + '"]');
  if (t) setTimeout(() => { if (cur === 'home') t.focus(); }, 0);
}
$('#toHist').onclick = () => go('hist');
$('#toSett').onclick = () => go('sett');

/* ---------- number boxes ---------- */
function spinBox(val, onChange, sub, dim) {
  const b = document.createElement('button');
  b.className = 'spin f';
  const draw = () => { b.innerHTML = val() + (sub ? '<small>' + sub + '</small>' : ''); if (dim) b.classList.toggle('dim', dim()); };
  b.spin = (d, repeat) => { onChange(d, repeat); draws.forEach(f => f()); };
  draws.push(draw); draw();
  return b;
}
let draws = [];
const hms = v => [Math.floor(v / 3600), Math.floor(v % 3600 / 60), v % 60];

/* ---------- setup ---------- */
let SU = {}, suPreset = -1;
function openSetup(mode, presetIdx) {
  const P = LS.get('presets', []);
  suPreset = presetIdx === undefined ? -1 : presetIdx;
  const base = suPreset >= 0 ? P[suPreset] : LS.get('last_' + mode, {});
  SU = Object.assign({ mode }, MODES[mode].def, base, { mode });
  $('#suTitle').textContent = MODES[mode].n;
  $('#suDesc').textContent = MODES[mode].d;
  $('#suName').value = SU.name || '';
  $('#suDel').hidden = suPreset < 0; armDel = false; $('#suDel').textContent = 'Elimina preset';
  const host = $('#fields'); host.innerHTML = ''; draws = [];
  const defs = FIELDS[mode];
  // size the digits so that all boxes fit on one row: an h:m:s field is about 4.35 digits-boxes wide
  const ems = defs.reduce((a, f) => a + (f[2] === 't' ? 4.35 : 1.25), 0) + Math.max(0, defs.length - 1) * 0.4;
  const fs = ems ? 'min(' + (58 / ems).toFixed(2) + 'vw,20vh)' : '';
  defs.forEach(f => {
    const fd = document.createElement('div'); fd.className = 'fd';
    fd.innerHTML = '<label>' + f[1] + '</label><div class="boxes" style="font-size:' + fs + '"></div>';
    const bx = fd.querySelector('.boxes'), k = f[0];
    if (f[2] === 't') {
      const low = f[3] ? 0 : 1, HI = [99, 59, 59], names = ['ore', 'min', 'sec'];
      [0, 1, 2].forEach(i => {
        if (i) { const c = document.createElement('i'); c.textContent = ':'; bx.appendChild(c); }
        bx.appendChild(spinBox(() => pad(hms(SU[k])[i]), d => {
          const p = hms(SU[k]);
          p[i] = (p[i] + d + HI[i] + 1) % (HI[i] + 1);
          SU[k] = Math.max(low, p[0] * 3600 + p[1] * 60 + p[2]);
        }, names[i], () => !SU[k]));
      });
    } else {
      const hi = f[2] === 'n' ? 99 : 5940, sub = f[2] === 's' ? 'sec' : '';
      bx.appendChild(spinBox(() => String(SU[k]), d => { SU[k] = Math.max(1, Math.min(hi, SU[k] + d)); }, sub));
    }
    host.appendChild(fd);
  });
  if (!defs.length) host.innerHTML = '<div class="empty">Conta in avanti finché non premi Fine.</div>';
  $('#suHint').style.visibility = defs.length ? '' : 'hidden';
  go('setup', defs.length ? host.querySelector('.f') : $('#suStart'));
}
function suCfg() { const c = Object.assign({}, SU); c.name = $('#suName').value.trim(); LS.set('last_' + c.mode, c); LS.set('lastMode', c.mode); return c; }
$('#suStart').onclick = () => { const c = suCfg(); E.start(c); $('#runLbl').textContent = wodName(c); buildProg(); show('run', $('#runRound')); drawRun(); focusRun(); };
$('#suSave').onclick = () => { const c = suCfg(), P = LS.get('presets', []); P.unshift(c); LS.set('presets', P.slice(0, 8)); suPreset = -1; toast('Preset salvato'); };
let armDel = false;
$('#suDel').onclick = () => {
  if (!armDel) { armDel = true; $('#suDel').textContent = 'OK di nuovo per eliminare'; return; }
  const P = LS.get('presets', []); P.splice(suPreset, 1); LS.set('presets', P); toast('Preset eliminato'); goHome();
};

/* ---------- run ---------- */
const hasRoundBtn = () => ['fortime', 'amrap', 'clock'].includes(E.cfg.mode);
function focusRun() { $('#runRound').hidden = !hasRoundBtn(); (hasRoundBtn() ? $('#runRound') : $('#runPause')).focus(); }
let progN = 0, progLast = -2;
function buildProg() {
  const c = E.cfg, el = $('#prog');
  progN = !isFinite(E.total) ? 0 : (c.rounds ? Math.min(40, c.rounds) : 20);
  el.style.display = progN ? '' : 'none';
  el.style.gridTemplateColumns = 'repeat(' + progN + ', minmax(0, 1fr))';
  el.innerHTML = '<i></i>'.repeat(progN); progLast = -2;
}
function drawProg(st) {
  if (!progN) return;
  const ws = E.workStart(), span = E.total - ws;
  const p = st.phase === 'prep' ? 0 : Math.max(0, Math.min(1, (st.el - ws) / span));
  const full = E.done ? progN : Math.floor(p * progN + 1e-9);
  if (full === progLast) return; progLast = full;
  [...$('#prog').children].forEach((n, i) => { n.className = i < full ? 'on' : (i === full && st.phase !== 'prep' ? 'cur' : ''); });
}
function drawRun() {
  const st = E.state(); if (!st) return;
  const v = $('#run');
  v.classList.toggle('rest', st.phase === 'rest' && !E.done);
  v.classList.toggle('prep', st.phase === 'prep' && !E.done);
  v.classList.toggle('paused', E.paused);
  setText($('#phase'), E.paused ? 'In pausa' : st.lbl);
  setText($('#big'), st.big);
  $('#big').classList.toggle('long', st.big.length > 5);
  setText($('#sub'), st.phase === 'prep' ? wodName(E.cfg) : (st.round || ''));
  const m = E.cfg.mode;
  let s2 = '';
  if (st.phase !== 'prep') {
    if (m === 'fortime' && E.cfg.cap) s2 = 'Cap ' + fmt(E.cfg.cap);
    if (hasRoundBtn() && E.rounds.length) { const r = E.rounds, last = r[r.length - 1] - (r[r.length - 2] || 0); s2 = (s2 ? s2 + ' · ' : '') + 'Ultimo round ' + fmt(last); }
    if (m !== 'fortime' && m !== 'clock') s2 = (s2 ? s2 + ' · ' : '') + 'Totale ' + fmt(Math.max(0, st.el - E.workStart()));
  }
  setText($('#sub2'), s2);
  drawProg(st);
  setText($('#runPause'), E.paused ? 'Via' : 'Pausa');
  setText($('#runStop'), (m === 'fortime' || m === 'clock') && st.phase === 'work' ? 'Fine' : 'Stop');
}
$('#runRound').onclick = () => {
  if (!E.running || E.paused || E.done) return;
  const st = E.state(); if (st.phase !== 'work') return;
  E.rounds.push(E.workEl()); beep(1000, 0.08, 0.5);
};
$('#runPause').onclick = () => { if (E.done) return; E.pause(); drawRun(); };
$('#runStop').onclick = () => {
  const st = E.state();
  if (st && st.phase === 'prep' && !E.done) { E.reset(); wake(false); show('setup'); return; }
  E.finish(false);
};

/* ---------- result ---------- */
let resR = 0, resP = 0;
function resultInfo() {
  const c = E.cfg, m = c.mode, w = E.workEl();
  const r = { big: '', splits: '', reps: false };
  if (m === 'fortime' || m === 'clock') r.big = (c.cap && w >= c.cap - 0.05) ? 'Cap ' + fmt(c.cap) : fmt(w);
  else if (m === 'amrap') { r.big = E.rounds.length + ' round'; r.reps = true; }
  else r.big = fmt(w);
  if (E.rounds.length) r.splits = E.rounds.map((t, i) => 'R' + (i + 1) + ' ' + fmt(t - (E.rounds[i - 1] || 0))).join('  ·  ');
  return r;
}
function openResult() {
  const r = resultInfo();
  $('#resTitle').textContent = wodName(E.cfg);
  $('#resBig').textContent = r.big;
  $('#resSplits').textContent = r.splits;
  $('#resNotes').value = '';
  const host = $('#resReps'); host.innerHTML = ''; draws = [];
  resR = E.rounds.length; resP = 0;
  if (r.reps) {
    const mk = (label, val, set) => {
      const fd = document.createElement('div'); fd.className = 'fd';
      fd.innerHTML = '<label>' + label + '</label><div class="boxes"></div>';
      fd.querySelector('.boxes').appendChild(spinBox(val, set));
      host.appendChild(fd);
    };
    mk('Round', () => String(resR), d => { resR = Math.max(0, Math.min(999, resR + d)); });
    mk('+ Reps', () => String(resP), d => { resP = Math.max(0, Math.min(999, resP + d)); });
  }
  show('result', $('#resSave'));
}
$('#resSave').onclick = () => {
  const c = E.cfg, r = resultInfo(), H = LS.get('hist', []);
  let res = r.big;
  if (r.reps) res = resR + (resP ? ' + ' + resP : '') + ' round';
  H.unshift({ d: Date.now(), name: wodName(c), res, splits: r.splits, notes: $('#resNotes').value.trim() });
  LS.set('hist', H.slice(0, 200));
  E.reset(); toast('Salvato nello storico'); goHome();
};
$('#resDiscard').onclick = () => { E.reset(); goHome(); };

/* ---------- history ---------- */
let armHist = -1;
function renderHist() {
  const H = LS.get('hist', []);
  armHist = -1;
  $('#histList').innerHTML = H.length ? H.map((h, i) => {
    const d = new Date(h.d);
    return `<button class="item f" data-i="${i}"><div><b>${esc(h.name)}</b><span>${d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' })} · ${pad(d.getHours())}:${pad(d.getMinutes())}${h.notes ? ' · ' + esc(h.notes) : ''}${h.splits ? ' · ' + esc(h.splits) : ''}</span></div><em>${esc(h.res)}</em></button>`;
  }).join('') : '<div class="empty">Ancora nessun WOD salvato.</div>';
  $$('#histList .item').forEach(b => b.onclick = () => {
    const i = +b.dataset.i;
    if (armHist !== i) { armHist = i; toast('Premi OK di nuovo per eliminare'); return; }
    H.splice(i, 1); LS.set('hist', H); renderHist(); focusIn();
  });
}

/* ---------- settings ---------- */
function seg(el, opts, getv, setv) {
  el.innerHTML = opts.map(([v, l]) => `<button class="btn f" data-v="${v}">${l}</button>`).join('');
  const upd = () => [...el.children].forEach(b => b.classList.toggle('sel', b.dataset.v == String(getv())));
  [...el.children].forEach(b => b.onclick = () => { setv(b.dataset.v); saveS(); upd(); });
  upd();
}
let armClear = false;
function renderSett() {
  seg($('#setCd'), [[0, 'No'], [3, '3 s'], [5, '5 s'], [10, '10 s']], () => S.cd, v => { S.cd = +v; });
  seg($('#setBeep'), [['true', 'Sì'], ['false', 'No']], () => S.beep, v => { S.beep = v === 'true'; });
  seg($('#setVoice'), [['true', 'Sì'], ['false', 'No']], () => S.voice, v => { S.voice = v === 'true'; });
  armClear = false; $('#setClear').textContent = 'Cancella tutto';
}
$('#setTest').onclick = () => { beep(880, 0.2, 0.7); say('Prova audio. Via!'); };
$('#setClear').onclick = () => {
  if (!armClear) { armClear = true; $('#setClear').textContent = 'OK di nuovo per cancellare'; return; }
  LS.set('hist', []); armClear = false; $('#setClear').textContent = 'Cancella tutto'; toast('Storico cancellato');
};

/* ---------- boot ---------- */
if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {}));
show('home');
