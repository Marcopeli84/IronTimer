/* Iron Timer — Iron Training System */
'use strict';
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const G = '#81F105', RED = '#ff4433';

/* ---------- storage ---------- */
const LS = {
  get(k, d) { try { const v = localStorage.getItem('it_' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('it_' + k, JSON.stringify(v)); } catch (e) {} }
};
const S = Object.assign({ cd: 10, beep: true, voice: true, vib: true, name: '', q: 720 }, LS.get('set', {}));
const OV = Object.assign({
  logo: true, gym: true, app: true, time: true, round: true, wod: true, athlete: true, date: true, clock: true,
  pos: 'bottom', size: 'm', bg: 0.55, col: 'green'
}, LS.get('ov', {}));
const saveS = () => LS.set('set', S), saveOV = () => LS.set('ov', OV);

/* ---------- helpers ---------- */
const pad = n => String(n).padStart(2, '0');
function fmt(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  return h ? h + ':' + pad(m) + ':' + pad(s) : m + ':' + pad(s);
}
function toast(t) { const e = $('#toast'); e.textContent = t; e.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => e.classList.remove('on'), 2400); }
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function stamp(d = new Date()) { return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '_' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds()); }

/* ---------- modes ---------- */
const MODES = {
  fortime: { n: 'For Time', d: 'Cronometro con time cap', def: { cap: 0 } },
  amrap: { n: 'AMRAP', d: 'Più round possibili nel tempo', def: { dur: 720 } },
  emom: { n: 'EMOM', d: 'Ogni intervallo, un round', def: { every: 60, rounds: 10 } },
  tabata: { n: 'Tabata', d: 'Lavoro / riposo a secondi', def: { work: 20, rest: 10, rounds: 8 } },
  interval: { n: 'Intervalli', d: 'Lavoro / riposo a minuti', def: { work: 180, rest: 60, rounds: 5 } },
  clock: { n: 'Cronometro', d: 'Conta in avanti, senza limiti', def: {} }
};
function cfgLabel(c) {
  if (!c) return 'Nessun timer';
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
const wodName = c => c ? (c.name ? c.name : cfgLabel(c)) : '';

/* ---------- audio ---------- */
let AC = null, recDest = null;
function audio() {
  if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }
  if (AC && AC.state === 'suspended') AC.resume();
  return AC;
}
function setSession(t) { try { if (navigator.audioSession) navigator.audioSession.type = t; } catch (e) {} }
function beep(f = 880, d = 0.12, v = 0.5) {
  if (!S.beep) return;
  const a = audio(); if (!a) return;
  const o = a.createOscillator(), g = a.createGain(), t = a.currentTime;
  o.type = 'square'; o.frequency.value = f;
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v * 0.35, t + 0.01);
  g.gain.setValueAtTime(v * 0.35, t + d - 0.02); g.gain.linearRampToValueAtTime(0, t + d);
  o.connect(g); g.connect(a.destination); if (recDest) g.connect(recDest);
  o.start(t); o.stop(t + d + 0.02);
}
function say(t) {
  if (!S.voice || !window.speechSynthesis) return;
  try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(t); u.lang = 'it-IT'; u.rate = 1.05; speechSynthesis.speak(u); } catch (e) {}
}
function vib(p) { if (S.vib && navigator.vibrate) try { navigator.vibrate(p); } catch (e) {} }

/* ---------- wake lock ---------- */
let wl = null;
async function wake(on) {
  try {
    if (on && !wl && navigator.wakeLock) { wl = await navigator.wakeLock.request('screen'); wl.addEventListener('release', () => wl = null); }
    if (!on && wl) { await wl.release(); wl = null; }
  } catch (e) {}
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && (E.running || REC.recording || cur === 'rec')) wake(true); });

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
    loop();
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
    if (sg.k === 'prep') { st.big = String(Math.max(1, Math.ceil(rem))); st.lbl = 'Pronti'; st.secs = Math.ceil(rem); st.pr = se / sg.d; }
    else if (sg.up) { st.big = fmt(se); st.secs = Math.floor(se); st.pr = isFinite(sg.d) ? se / sg.d : 0; st.lbl = this.cfg.mode === 'clock' ? 'Tempo' : 'For Time'; }
    else { st.big = fmt(Math.ceil(rem - 1e-6)); st.secs = Math.ceil(rem - 1e-6); st.pr = se / sg.d; st.lbl = sg.k === 'rest' ? 'Riposo' : (this.cfg.mode === 'amrap' ? 'AMRAP' : 'Lavoro'); }
    if (this.done) { st.lbl = 'Fine'; st.pr = 1; }
    if (sg.r) st.round = 'Round ' + sg.r + '/' + sg.n;
    else if ((this.cfg.mode === 'fortime' || this.cfg.mode === 'amrap' || this.cfg.mode === 'clock') && sg.k === 'work') st.round = 'Round ' + (this.rounds.length + 1);
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
      if (sg.k === 'prep') { say('Pronti'); }
      else if (sg.k === 'work') {
        beep(1320, 0.45, 0.7); vib(300);
        if (sg.r && sg.r === sg.n && sg.n > 1) say('Ultimo round'); else if (!sg.r || sg.r === 1) say('Via!');
      } else if (sg.k === 'rest') { beep(520, 0.45, 0.7); vib([120, 80, 120]); say('Riposo'); }
      return;
    }
    if (!sg.up || isFinite(sg.d)) {
      const r = Math.ceil(sg.d - st.se - 1e-6);
      if (r <= 3 && r >= 1 && (sg.d >= 4 || sg.k === 'prep')) { beep(880, 0.12, 0.6); vib(60); }
      if (this.cfg.mode === 'amrap' && sg.k === 'work' && sg.d >= 180 && r === 60) say('Ultimo minuto');
    }
  },
  finish(natural) {
    if (this.done) return;
    this.endAt = Math.min(this.el(), this.total);
    this.done = true; this.running = false; this.paused = false;
    if (natural) { beep(1320, 0.25, 0.8); setTimeout(() => beep(1320, 0.25, 0.8), 330); setTimeout(() => beep(1760, 0.6, 0.8), 660); vib([300, 100, 300]); say('Tempo!'); }
    if (!REC.recording) wake(false);
    if (cur === 'run') openResult();
    else if (cur === 'rec') { REC.pendingResult = true; updRecUi(); }
  },
  reset() { this.cfg = null; this.running = false; this.done = false; this.paused = false; }
};
let raf = 0, iv = 0;
function loop() {
  cancelAnimationFrame(raf);
  const f = () => { E.tick(); if (cur === 'run') drawRun(); raf = requestAnimationFrame(f); };
  raf = requestAnimationFrame(f);
  clearInterval(iv); iv = setInterval(() => E.tick(), 200); // keeps cues when rAF is throttled
}

/* ---------- navigation ---------- */
let cur = 'home', setupMode = 'amrap', setupFrom = 'home';
function go(v) {
  if (cur === 'rec' && v !== 'rec') closeCam();
  cur = v;
  $$('.view').forEach(x => x.classList.toggle('on', x.id === v));
  $('#nav').classList.toggle('on', ['home', 'hist', 'sett'].includes(v));
  $$('#nav button').forEach(b => b.classList.toggle('on', b.dataset.go === v));
  if (v === 'home') renderHome();
  if (v === 'hist') renderHist();
  if (v === 'sett') renderSett();
  if (v === 'rec') openRec();
}
$$('#nav button').forEach(b => b.onclick = () => go(b.dataset.go));
$$('[data-back]').forEach(b => b.onclick = () => go(setupFrom === 'rec' ? 'rec' : 'home'));
$$('[data-close]').forEach(b => b.onclick = () => b.closest('.sheet').classList.remove('on'));
$$('.sheet').forEach(s => s.addEventListener('click', e => { if (e.target === s && (s.id === 'shOv' || s.id === 'shPick')) s.classList.remove('on'); }));

/* ---------- home ---------- */
function renderHome() {
  $('#modes').innerHTML = Object.entries(MODES).map(([k, m]) => `<button class="mode" data-m="${k}"><b>${m.n}</b><span>${m.d}</span></button>`).join('');
  $$('#modes .mode').forEach(b => b.onclick = () => openSetup(b.dataset.m, 'home'));
  const P = LS.get('presets', []);
  $('#presets').innerHTML = P.length ? P.map((p, i) => `<div class="item" data-i="${i}"><div class="grow"><div class="t1">${esc(wodName(p))}</div><div class="t2">${esc(p.name ? cfgLabel(p) : MODES[p.mode].n)}</div></div><button class="x" data-del="${i}">×</button></div>`).join('')
    : '<div class="empty">Imposta un timer e tocca "Salva come preset" per averlo qui.</div>';
  $$('#presets .item').forEach(el => el.onclick = e => {
    const i = +el.dataset.i;
    if (e.target.dataset.del !== undefined) { if (confirm('Eliminare il preset?')) { P.splice(i, 1); LS.set('presets', P); renderHome(); } return; }
    openSetup(P[i].mode, 'home', P[i]);
  });
}
$('#homeRec').onclick = () => go('rec');

/* ---------- setup ---------- */
let SU = {};
const FIELDS = {
  fortime: [['cap', 'Time cap', 't', 30, 'nessuno']],
  amrap: [['dur', 'Durata', 't', 30]],
  emom: [['every', 'Ogni', 't', 15], ['rounds', 'Round', 'n', 1]],
  tabata: [['work', 'Lavoro', 's', 5], ['rest', 'Riposo', 's', 5], ['rounds', 'Round', 'n', 1]],
  interval: [['work', 'Lavoro', 't', 15], ['rest', 'Riposo', 't', 15], ['rounds', 'Round', 'n', 1]],
  clock: []
};
function openSetup(mode, from, preset) {
  setupMode = mode; setupFrom = from;
  SU = Object.assign({ mode }, MODES[mode].def, preset || LS.get('last_' + mode, {}), { mode });
  $('#suTitle').textContent = MODES[mode].n;
  $('#suDesc').textContent = MODES[mode].d;
  $('#suName').value = SU.name || '';
  $('#suRec').textContent = from === 'rec' ? 'Usa per la ripresa' : 'Registra con timer';
  $('#suStart').style.display = from === 'rec' ? 'none' : '';
  $('#suFields').innerHTML = FIELDS[mode].map(([k, l]) => `<div class="field"><label>${l}</label><div class="stp"><button data-k="${k}" data-d="-1">−</button><div class="val" id="v_${k}"></div><button data-k="${k}" data-d="1">+</button></div></div>`).join('')
    + (mode === 'fortime' ? '<p class="hint" style="margin:-2px 2px 10px">Senza cap il timer va avanti finché non tocchi Stop.</p>' : '');
  FIELDS[mode].forEach(f => updField(f));
  $$('#suFields .stp button').forEach(b => {
    const f = FIELDS[mode].find(x => x[0] === b.dataset.k);
    let rep = 0, tt = 0;
    const step = () => { const d = +b.dataset.d * stepFor(f, SU[f[0]], +b.dataset.d); SU[f[0]] = Math.max(f[2] === 'n' ? 1 : (f[4] ? 0 : f[3]), Math.min(f[2] === 'n' ? 99 : 5940, SU[f[0]] + d)); updField(f); };
    const stop = () => { clearTimeout(tt); clearInterval(rep); };
    b.onpointerdown = e => { e.preventDefault(); step(); tt = setTimeout(() => rep = setInterval(step, 90), 420); };
    b.onpointerup = b.onpointerleave = b.onpointercancel = stop;
  });
  go('setup');
}
function stepFor(f, v, dir) { if (f[2] !== 't') return f[3]; if (v + (dir < 0 ? -1 : 0) >= 600) return 60; return f[3]; }
function updField(f) {
  const v = SU[f[0]], el = $('#v_' + f[0]);
  if (f[2] === 'n') el.innerHTML = v;
  else if (f[2] === 's') el.innerHTML = v + '<small>sec</small>';
  else el.innerHTML = (f[4] && !v) ? '<span style="font-size:32px">Nessuno</span>' : fmt(v);
}
function suCfg() { const c = Object.assign({}, SU); c.name = $('#suName').value.trim(); LS.set('last_' + c.mode, c); return c; }
$('#suStart').onclick = () => startRun(suCfg());
$('#suRec').onclick = () => { REC.cfg = suCfg(); LS.set('recCfg', REC.cfg); go('rec'); };
$('#suSave').onclick = () => { const c = suCfg(), P = LS.get('presets', []); P.unshift(c); LS.set('presets', P.slice(0, 30)); toast('Preset salvato'); };

/* ---------- run ---------- */
function startRun(c) { setSession('transient'); E.start(c); go('run'); $('#runLbl').textContent = wodName(c); drawRun(); }
function drawRun() {
  const st = E.state(); if (!st) return;
  const v = $('#run');
  v.classList.toggle('rest', st.phase === 'rest' && !E.done);
  v.classList.toggle('prep', st.phase === 'prep' && !E.done);
  $('#runPhase').textContent = E.paused ? 'In pausa' : st.lbl;
  $('#runBig').textContent = st.big;
  $('#runSub').textContent = st.phase === 'prep' ? wodName(E.cfg) : (st.round || '');
  const m = E.cfg.mode, sg = st.seg;
  let s2 = '';
  if (st.phase !== 'prep') {
    if (m === 'fortime' && E.cfg.cap) s2 = 'Cap ' + fmt(E.cfg.cap);
    if ((m === 'fortime' || m === 'amrap' || m === 'clock') && E.rounds.length) { const r = E.rounds, last = r[r.length - 1] - (r[r.length - 2] || 0); s2 = (s2 ? s2 + ' · ' : '') + 'Ultimo round ' + fmt(last); }
    if (m === 'amrap' || m === 'emom' || m === 'tabata' || m === 'interval') s2 = (s2 ? s2 + ' · ' : '') + 'Totale ' + fmt(Math.max(0, st.el - E.workStart()));
  }
  $('#runSub2').textContent = s2;
  $('#runProg').style.width = Math.min(100, (st.pr || 0) * 100) + '%';
  $('#runRound').hidden = !['fortime', 'amrap', 'clock'].includes(m);
  $('#runPause').textContent = E.paused ? 'Via' : 'Pausa';
  $('#runStop').textContent = (m === 'fortime' || m === 'clock') && st.phase === 'work' ? 'Fine' : 'Stop';
}
function addRound() {
  if (!E.running || E.paused || E.done) return;
  const st = E.state(); if (st.phase !== 'work') return;
  E.rounds.push(E.workEl()); beep(1000, 0.08, 0.5); vib(40);
}
$('#runRound').onclick = addRound;
$('#runPause').onclick = () => { if (E.done) return; E.pause(); drawRun(); };
$('#runStop').onclick = () => {
  if (E.done) { openResult(); return; }
  const st = E.state();
  if (st.phase === 'prep') { E.reset(); wake(false); go(setupFrom === 'rec' ? 'home' : 'setup'); return; }
  E.finish(false);
};

/* ---------- result ---------- */
function resultInfo() {
  const c = E.cfg, m = c.mode, w = E.workEl();
  const r = { big: '', splits: '', reps: false };
  if (m === 'fortime' || m === 'clock') { r.big = (c.cap && w >= c.cap - 0.05) ? 'Cap ' + fmt(c.cap) : fmt(w); }
  else if (m === 'amrap') { r.big = E.rounds.length + ' round'; r.reps = true; }
  else { r.big = fmt(w); }
  if (E.rounds.length) r.splits = E.rounds.map((t, i) => 'R' + (i + 1) + ' ' + fmt(t - (E.rounds[i - 1] || 0))).join('  ·  ');
  return r;
}
function openResult() {
  const r = resultInfo();
  $('#resTitle').textContent = wodName(E.cfg);
  $('#resBig').textContent = r.big;
  $('#resSplits').textContent = r.splits;
  $('#resRepsF').style.display = r.reps ? '' : 'none';
  $('#resRounds').value = E.rounds.length || ''; $('#resReps').value = ''; $('#resNotes').value = '';
  $('#shRes').classList.add('on');
}
$('#resSave').onclick = () => {
  const c = E.cfg, r = resultInfo(), H = LS.get('hist', []);
  let res = r.big;
  if (r.reps) { const rr = +$('#resRounds').value || 0, rp = +$('#resReps').value || 0; res = rr + (rp ? ' + ' + rp : '') + ' round'; }
  H.unshift({ d: Date.now(), name: wodName(c), lbl: cfgLabel(c), res, splits: r.splits, notes: $('#resNotes').value.trim() });
  LS.set('hist', H.slice(0, 500));
  closeResult(); toast('Salvato nello storico');
};
$('#resDiscard').onclick = closeResult;
function closeResult() {
  $('#shRes').classList.remove('on');
  const was = cur; E.reset(); REC.pendingResult = false;
  if (was === 'run') go('home'); else updRecUi();
}

/* ---------- history ---------- */
function renderHist() {
  const H = LS.get('hist', []);
  $('#histList').innerHTML = H.length ? H.map((h, i) => {
    const d = new Date(h.d);
    return `<div class="item"><div class="grow"><div class="t1">${esc(h.name)}</div><div class="t2">${d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' })} · ${pad(d.getHours())}:${pad(d.getMinutes())}${h.notes ? ' · ' + esc(h.notes) : ''}</div>${h.splits ? `<div class="t2" style="font-size:12px">${esc(h.splits)}</div>` : ''}</div><div class="res">${esc(h.res)}</div><button class="x" data-del="${i}">×</button></div>`;
  }).join('') : '<div class="empty">Ancora nessun WOD salvato. Alla fine di ogni timer puoi salvare il risultato.</div>';
  $$('#histList [data-del]').forEach(b => b.onclick = () => { if (!confirm('Eliminare questo WOD?')) return; H.splice(+b.dataset.del, 1); LS.set('hist', H); renderHist(); });
}

/* ---------- settings ---------- */
function segCtl(el, opts, getv, setv) {
  el.innerHTML = opts.map(([v, l]) => `<button data-v="${v}">${l}</button>`).join('');
  const upd = () => [...el.children].forEach(b => b.classList.toggle('on', b.dataset.v == getv()));
  [...el.children].forEach(b => b.onclick = () => { setv(b.dataset.v); upd(); });
  upd();
}
function renderSett() {
  segCtl($('#setCd'), [[0, 'No'], [3, '3 s'], [5, '5 s'], [10, '10 s']], () => S.cd, v => { S.cd = +v; saveS(); });
  segCtl($('#setQ'), [[720, 'HD 720p'], [1080, 'Full HD']], () => S.q, v => { S.q = +v; saveS(); });
  [['beep', '#setBeep'], ['voice', '#setVoice'], ['vib', '#setVib']].forEach(([k, s]) => { const e = $(s); e.checked = S[k]; e.onchange = () => { S[k] = e.checked; saveS(); }; });
  const n = $('#setName'); n.value = S.name; n.oninput = () => { S.name = n.value.trim(); saveS(); };
  $('#setClear').onclick = () => { if (confirm('Cancellare tutto lo storico?')) { LS.set('hist', []); toast('Storico cancellato'); } };
}

/* ---------- RECORD ---------- */
const REC = { stream: null, facing: LS.get('facing', 'environment'), recording: false, mr: null, chunks: [], t0: 0, cfg: LS.get('recCfg', null), pendingResult: false, mic: null, raf: 0, w: 0, h: 0, mime: '' };
const vid = $('#vid'), ov = $('#ov'), rc = $('#rc');
const helmG = new Image(); helmG.src = 'img/helmet.png';
const helmW = new Image(); helmW.src = 'img/helmet-white.png';

async function openRec() {
  setSession('play-and-record');
  updRecUi();
  wake(true);
  await startCam();
  cancelAnimationFrame(REC.raf);
  const f = () => { drawRec(); REC.raf = requestAnimationFrame(f); };
  REC.raf = requestAnimationFrame(f);
  if (!E.running) loop();
}
async function startCam() {
  stopTracks();
  const err = $('#camErr'); err.classList.remove('on');
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { err.innerHTML = 'La fotocamera non è disponibile su questo browser.'; err.classList.add('on'); return; }
  const q = S.q === 1080 ? { width: { ideal: 1920 }, height: { ideal: 1080 } } : { width: { ideal: 1280 }, height: { ideal: 720 } };
  const v = Object.assign({ facingMode: { ideal: REC.facing }, frameRate: { ideal: 30 } }, q);
  try {
    try { REC.stream = await navigator.mediaDevices.getUserMedia({ video: v, audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true } }); }
    catch (e) { REC.stream = await navigator.mediaDevices.getUserMedia({ video: v, audio: false }); toast('Microfono non disponibile: video senza audio'); }
  } catch (e) {
    err.innerHTML = 'Non riesco ad aprire la fotocamera.<br><br>Consenti l\'accesso a fotocamera e microfono per questo sito (su iPhone: Impostazioni › Safari › Fotocamera e Microfono › Consenti) e riprova.';
    err.classList.add('on'); return;
  }
  vid.srcObject = REC.stream;
  vid.classList.toggle('mir', REC.facing === 'user');
  try { await vid.play(); } catch (e) {}
  await new Promise(r => { if (vid.videoWidth) r(); else vid.onloadedmetadata = () => r(); setTimeout(r, 1500); });
  layoutStage();
}
function stopTracks() { if (REC.stream) { REC.stream.getTracks().forEach(t => t.stop()); REC.stream = null; } }
function closeCam() {
  if (REC.recording) stopRec();
  cancelAnimationFrame(REC.raf); stopTracks(); vid.srcObject = null;
  if (!E.running) wake(false);
  setSession('transient');
}
function layoutStage() {
  // while recording, the frame keeps the recording's shape even if the phone is rotated
  const vw = REC.recording ? rc.width : (vid.videoWidth || 1280), vh = REC.recording ? rc.height : (vid.videoHeight || 720);
  const sw = $('#swrap'), W = sw.clientWidth || innerWidth, H = sw.clientHeight || innerHeight, k = Math.min(W / vw, H / vh);
  const st = $('#stage'); st.style.width = Math.round(vw * k) + 'px'; st.style.height = Math.round(vh * k) + 'px';
  const dpr = Math.min(2, devicePixelRatio || 1);
  ov.width = Math.round(vw * k * dpr); ov.height = Math.round(vh * k * dpr);
}
const relayout = () => { if (cur === 'rec') { layoutStage(); setTimeout(layoutStage, 300); setTimeout(layoutStage, 800); } };
addEventListener('resize', relayout);
addEventListener('orientationchange', relayout);
// draw the camera frame filling the target without stretching (crop the excess)
function drawCover(x, w, h) {
  const vw = vid.videoWidth, vh = vid.videoHeight; if (!vw || !vh) return;
  const k = Math.max(w / vw, h / vh), dw = vw * k, dh = vh * k;
  x.drawImage(vid, (w - dw) / 2, (h - dh) / 2, dw, dh);
}
let lastVW = 0, lastVH = 0, lastSW = 0, lastSH = 0;

/* overlay content */
function ovData() {
  const now = new Date(), st = E.state(), d = { lines: [] };
  if (OV.gym) d.gym = 'IRON TRAINING SYSTEM';
  if (OV.app) d.app = 'IRON TIMER';
  const l2 = [];
  const cfg = E.cfg || REC.cfg;
  if (OV.wod && cfg) l2.push(wodName(cfg));
  if (OV.athlete && S.name) l2.push(S.name);
  if (l2.length) d.l2 = l2.join(' · ');
  const l3 = [];
  if (OV.date) l3.push(now.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' }));
  if (OV.clock) l3.push(pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds()));
  if (l3.length) d.l3 = l3.join('  ');
  if (cfg && (OV.time || OV.round)) {
    if (st) {
      if (OV.time) d.time = st.big;
      if (OV.round) d.sub = (E.paused ? 'PAUSA' : st.lbl.toUpperCase()) + (st.round && st.phase !== 'prep' ? ' · ' + st.round.toUpperCase() : '');
      d.rest = st.phase === 'rest' && !E.done;
    } else if (REC.cfg) {
      const c = REC.cfg;
      if (OV.time) d.time = c.mode === 'amrap' ? fmt(c.dur) : c.mode === 'emom' ? fmt(c.every) : c.mode === 'tabata' ? fmt(c.work) : c.mode === 'interval' ? fmt(c.work) : '0:00';
      if (OV.round) d.sub = 'PRONTI';
    }
  }
  return d;
}
function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
function fit(c, t, maxW) { if (c.measureText(t).width <= maxW) return t; while (t.length > 1 && c.measureText(t + '…').width > maxW) t = t.slice(0, -1); return t + '…'; }
function drawOverlay(c, W, H, d) {
  const sz = { s: 0.8, m: 1, l: 1.25 }[OV.size] || 1;
  const u = Math.min(W, H) / 100 * sz;
  const acc = OV.col === 'white' ? '#ffffff' : G;
  const hasL = OV.logo, hasT = d.gym || d.l2 || d.l3, hasR = d.time || d.sub;
  if (!hasL && !hasT && !hasR) return;
  const m = Math.max(10, u * 2.6), bh = u * 14.5, bw = W - m * 2;
  const y = OV.pos === 'top' ? m : H - m - bh, x = m;
  c.save();
  if (OV.bg > 0) { c.fillStyle = 'rgba(0,0,0,' + OV.bg + ')'; rr(c, x, y, bw, bh, u * 2.2); c.fill(); }
  c.textBaseline = 'alphabetic';
  let lx = x + u * 2.2;
  const cy = y + bh / 2;
  // right block
  let rw = 0;
  if (hasR) {
    c.textAlign = 'right';
    const rx = x + bw - u * 2.6;
    if (d.time) {
      c.font = `800 ${u * 8.6}px 'Barlow Condensed', 'Arial Narrow', sans-serif`;
      c.fillStyle = d.rest ? RED : acc;
      const ty = d.sub ? cy + u * 2.4 : cy + u * 3.1;
      c.fillText(d.time, rx, ty);
      rw = c.measureText(d.time).width;
    }
    if (d.sub) {
      c.font = `700 ${u * 2.7}px 'Barlow Condensed', 'Arial Narrow', sans-serif`;
      c.fillStyle = '#fff';
      const sy = d.time ? cy + u * 5.4 : cy + u * 1;
      c.fillText(d.sub, rx, sy);
      rw = Math.max(rw, c.measureText(d.sub).width);
    }
    if (d.time) { c.font = `800 ${u * 8.6}px 'Barlow Condensed', sans-serif`; }
  }
  // logo
  if (hasL) {
    const im = OV.col === 'white' ? helmW : helmG;
    if (im.complete && im.naturalWidth) { const ih = bh * 0.72, iw = ih * im.naturalWidth / im.naturalHeight; c.drawImage(im, lx, cy - ih / 2, iw, ih); lx += iw + u * 2; }
  }
  // text column
  if (hasT) {
    c.textAlign = 'left';
    const maxW = (x + bw - u * 2.6 - (rw ? rw + u * 3 : 0)) - lx;
    const rows = [];
    if (d.gym) rows.push(['g', u * 3.5]);
    if (d.l2) rows.push(['2', u * 2.9]);
    if (d.l3) rows.push(['3', u * 2.6]);
    const gap = u * 1.1, th = rows.reduce((a, r) => a + r[1], 0) + gap * (rows.length - 1);
    let yy = cy - th / 2;
    rows.forEach(([k, fs]) => {
      yy += fs;
      if (k === 'g') {
        c.font = `800 ${fs}px 'Barlow Condensed', 'Arial Narrow', sans-serif`; c.fillStyle = acc;
        const t = fit(c, d.gym, maxW); c.fillText(t, lx, yy - fs * 0.12);
        if (d.app) {
          const gw = c.measureText(t).width;
          c.font = `600 ${fs * 0.58}px 'Barlow Condensed', sans-serif`; c.fillStyle = 'rgba(255,255,255,.55)';
          if (gw + u * 1.5 + c.measureText(d.app).width < maxW) c.fillText(d.app, lx + gw + u * 1.5, yy - fs * 0.12);
        }
      } else if (k === '2') {
        c.font = `700 ${fs}px 'Barlow Condensed', 'Arial Narrow', sans-serif`; c.fillStyle = '#fff';
        c.fillText(fit(c, d.l2.toUpperCase(), maxW), lx, yy - fs * 0.12);
      } else {
        c.font = `500 ${fs}px 'Barlow', system-ui, sans-serif`; c.fillStyle = 'rgba(255,255,255,.72)';
        c.fillText(fit(c, d.l3, maxW), lx, yy - fs * 0.12);
      }
      yy += gap;
    });
  } else if (!hasT && d.app && hasL) { /* nothing */ }
  c.restore();
}
function drawRec() {
  if (vid.videoWidth && (vid.videoWidth !== lastVW || vid.videoHeight !== lastVH)) { lastVW = vid.videoWidth; lastVH = vid.videoHeight; layoutStage(); }
  const sw = $('#swrap'); if (sw.clientWidth !== lastSW || sw.clientHeight !== lastSH) { lastSW = sw.clientWidth; lastSH = sw.clientHeight; layoutStage(); }
  const d = ovData();
  const c = ov.getContext('2d');
  c.clearRect(0, 0, ov.width, ov.height);
  drawOverlay(c, ov.width, ov.height, d);
  if (REC.recording) {
    const r = rc.getContext('2d');
    try { r.fillStyle = '#000'; r.fillRect(0, 0, rc.width, rc.height); drawCover(r, rc.width, rc.height); } catch (e) {}
    drawOverlay(r, rc.width, rc.height, d);
    $('#recTime').textContent = fmt((performance.now() - REC.t0) / 1000);
  }
  if (cur === 'rec') updRecRound();
}
function outSize() {
  const vw = vid.videoWidth || 1280, vh = vid.videoHeight || 720;
  const long = S.q === 1080 ? 1920 : 1280, k = Math.min(1, long / Math.max(vw, vh));
  return [Math.round(vw * k / 2) * 2, Math.round(vh * k / 2) * 2];
}
function pickMime() {
  const L = ['video/mp4;codecs=avc1.42E01F,mp4a.40.2', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  if (!window.MediaRecorder) return null;
  for (const m of L) { try { if (MediaRecorder.isTypeSupported(m)) return m; } catch (e) {} }
  return '';
}
function startRec() {
  if (!REC.stream) { toast('Fotocamera non attiva'); return; }
  const mime = pickMime();
  if (mime === null || !rc.captureStream) { toast('Registrazione video non supportata da questo browser'); return; }
  const [w, h] = outSize(); rc.width = w; rc.height = h;
  const r = rc.getContext('2d'); try { r.drawImage(vid, 0, 0, w, h); } catch (e) {}
  const vs = rc.captureStream(30);
  const tracks = [...vs.getVideoTracks()];
  const mic = REC.stream.getAudioTracks()[0];
  let useMix = false;
  if (mic) {
    try {
      const a = audio();
      recDest = a.createMediaStreamDestination();
      REC.micSrc = a.createMediaStreamSource(new MediaStream([mic]));
      REC.micSrc.connect(recDest);
      tracks.push(recDest.stream.getAudioTracks()[0]); useMix = true;
    } catch (e) { recDest = null; tracks.push(mic); }
  }
  const ms = new MediaStream(tracks);
  const opt = { videoBitsPerSecond: S.q === 1080 ? 6000000 : 3500000 };
  if (mime) opt.mimeType = mime;
  try { REC.mr = new MediaRecorder(ms, opt); }
  catch (e) { try { REC.mr = new MediaRecorder(ms); } catch (e2) { toast('Impossibile avviare la registrazione'); return; } }
  REC.mime = REC.mr.mimeType || mime || 'video/mp4';
  REC.chunks = [];
  REC.mr.ondataavailable = e => { if (e.data && e.data.size) REC.chunks.push(e.data); };
  REC.mr.onstop = onRecStop;
  REC.mr.start(1000);
  REC.recording = true; REC.t0 = performance.now();
  $('#rec').classList.add('recording');
  wake(true);
  // start the linked timer together with the recording
  if (REC.cfg && !E.running && !E.done) E.start(REC.cfg);
  updRecUi(); layoutStage();
}
function stopRec() {
  if (!REC.recording) return;
  REC.recording = false;
  $('#rec').classList.remove('recording');
  try { REC.mr.stop(); } catch (e) { onRecStop(); }
  if (E.running && !E.done) E.finish(false);
  updRecUi(); layoutStage();
}
function onRecStop() {
  try { if (REC.micSrc) REC.micSrc.disconnect(); } catch (e) {}
  recDest = null; REC.micSrc = null;
  const type = (REC.mime || 'video/mp4').split(';')[0];
  const blob = new Blob(REC.chunks, { type });
  REC.chunks = [];
  if (!blob.size) { toast('Video vuoto, riprova'); return; }
  const ext = type.includes('mp4') ? 'mp4' : 'webm';
  showMedia(blob, 'IronTimer_' + stamp() + '.' + ext, 'video');
}
function takePhoto() {
  if (!REC.stream || !vid.videoWidth) { toast('Fotocamera non attiva'); return; }
  const c = document.createElement('canvas'); c.width = vid.videoWidth; c.height = vid.videoHeight;
  const x = c.getContext('2d'); x.drawImage(vid, 0, 0, c.width, c.height); drawOverlay(x, c.width, c.height, ovData());
  const fl = $('#flash'); fl.style.opacity = .8; setTimeout(() => fl.style.opacity = 0, 120);
  beep(1600, 0.05, 0.3);
  c.toBlob(b => { if (b) showMedia(b, 'IronTimer_' + stamp() + '.jpg', 'photo'); }, 'image/jpeg', 0.92);
}

/* media sheet */
let mediaURL = null, mediaFile = null;
function showMedia(blob, name, kind) {
  if (mediaURL) URL.revokeObjectURL(mediaURL);
  mediaURL = URL.createObjectURL(blob);
  mediaFile = new File([blob], name, { type: blob.type });
  $('#mTitle').textContent = kind === 'video' ? 'Video pronto' : 'Foto pronta';
  $('#mBox').innerHTML = kind === 'video' ? `<video class="media" src="${mediaURL}" controls playsinline></video>` : `<img class="media" src="${mediaURL}" alt="">`;
  const dl = $('#mDl'); dl.href = mediaURL; dl.download = name;
  const canShare = navigator.canShare && navigator.canShare({ files: [mediaFile] });
  $('#mShare').style.display = canShare ? '' : 'none';
  $('#mHint').textContent = canShare ? (kind === 'video' ? 'Tocca "Salva / Condividi" e poi "Salva video" per metterlo nel rullino.' : 'Tocca "Salva / Condividi" e poi "Salva immagine".') : 'Tocca "Scarica file" per salvarlo.';
  $('#shMedia').classList.add('on');
}
$('#mShare').onclick = async () => {
  try { await navigator.share({ files: [mediaFile], title: 'Iron Timer' }); }
  catch (e) { if (e.name !== 'AbortError') toast('Condivisione non riuscita: usa "Scarica file"'); }
};
$('#mClose').onclick = () => {
  $('#shMedia').classList.remove('on');
  if (REC.pendingResult && E.cfg) { REC.pendingResult = false; openResult(); }
};

/* record UI */
function updRecUi() {
  $('#recChipTxt').textContent = REC.cfg ? wodName(REC.cfg) : 'Nessuno';
  $('#recFlip').disabled = REC.recording;
  $('#recPhoto').style.visibility = '';
  updRecRound();
}
function updRecRound() {
  const b = $('#recRound');
  const show = E.running && !E.done && E.cfg && ['fortime', 'amrap', 'clock'].includes(E.cfg.mode) && E.state().phase === 'work';
  if (b.hidden === !!show) b.hidden = !show;
}
$('#recBtn').onclick = () => { audio(); REC.recording ? stopRec() : startRec(); };
$('#recPhoto').onclick = () => { audio(); takePhoto(); };
$('#recRound').onclick = addRound;
$('#recFlip').onclick = async () => { if (REC.recording) return; REC.facing = REC.facing === 'user' ? 'environment' : 'user'; LS.set('facing', REC.facing); await startCam(); };
$('#recClose').onclick = () => {
  if (REC.recording && !confirm('Interrompere la registrazione?')) return;
  if (REC.recording) stopRec();
  E.reset(); REC.pendingResult = false;
  go('home');
};
$('#recChip').onclick = () => {
  if (REC.recording) return;
  const P = LS.get('presets', []);
  const items = [['none', 'Nessun timer', 'Solo data, ora e logo']]
    .concat(Object.keys(MODES).map(k => ['m:' + k, MODES[k].n, MODES[k].d]))
    .concat(P.map((p, i) => ['p:' + i, wodName(p), 'Preset · ' + cfgLabel(p)]));
  $('#pickList').innerHTML = items.map(([k, a, b]) => `<button class="item" data-k="${k}" style="text-align:left"><div class="grow"><div class="t1">${esc(a)}</div><div class="t2">${esc(b)}</div></div></button>`).join('');
  $$('#pickList .item').forEach(el => el.onclick = () => {
    const k = el.dataset.k; $('#shPick').classList.remove('on');
    if (k === 'none') { REC.cfg = null; LS.set('recCfg', null); E.reset(); updRecUi(); }
    else if (k.startsWith('m:')) openSetup(k.slice(2), 'rec');
    else { REC.cfg = P[+k.slice(2)]; LS.set('recCfg', REC.cfg); E.reset(); updRecUi(); }
  });
  $('#shPick').classList.add('on');
};

$('#recTmr').onclick = () => $('#recChip').onclick();

/* overlay settings */
const OVT = [['logo', 'Logo (elmo)'], ['gym', 'Nome palestra'], ['app', 'Nome app'], ['time', 'Tempo del timer'], ['round', 'Fase e round'], ['wod', 'Nome del WOD'], ['athlete', 'Nome atleta'], ['date', 'Data'], ['clock', 'Ora']];
$('#recOv').onclick = () => {
  $('#ovToggles').innerHTML = OVT.map(([k, l]) => `<div class="tg">${l}${k === 'athlete' && !S.name ? ' <span class="muted" style="font-size:12px">(imposta il nome)</span>' : ''}<label class="sw"><input type="checkbox" data-k="${k}" ${OV[k] ? 'checked' : ''}><i></i></label></div>`).join('')
    + `<div class="tg" style="display:block"><input class="txt" id="ovName" placeholder="Nome atleta" maxlength="30" value="${esc(S.name)}"></div>`;
  $$('#ovToggles input[data-k]').forEach(i => i.onchange = () => { OV[i.dataset.k] = i.checked; saveOV(); });
  $('#ovName').oninput = e => { S.name = e.target.value.trim(); saveS(); };
  segCtl($('#ovPos'), [['top', 'In alto'], ['bottom', 'In basso']], () => OV.pos, v => { OV.pos = v; saveOV(); });
  segCtl($('#ovSize'), [['s', 'Piccola'], ['m', 'Media'], ['l', 'Grande']], () => OV.size, v => { OV.size = v; saveOV(); });
  segCtl($('#ovBg'), [[0, 'Nessuno'], [0.35, 'Leggero'], [0.55, 'Medio'], [0.8, 'Scuro']], () => OV.bg, v => { OV.bg = +v; saveOV(); });
  segCtl($('#ovCol'), [['green', 'Verde'], ['white', 'Bianco']], () => OV.col, v => { OV.col = v; saveOV(); });
  $('#shOv').classList.add('on');
};

/* ---------- install banner ---------- */
let bip = null;
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
function instShow() {
  if (standalone || LS.get('instX', false)) return;
  if (isIOS) { $('#instTxt').innerHTML = 'Installa l\'app: tocca <b>Condividi</b> e poi <b>Aggiungi alla schermata Home</b>.'; $('#inst').classList.add('on'); }
  else if (bip) { $('#instTxt').textContent = 'Installa Iron Timer sul telefono o sul PC.'; $('#instGo').hidden = false; $('#inst').classList.add('on'); }
}
addEventListener('beforeinstallprompt', e => { e.preventDefault(); bip = e; instShow(); });
$('#instGo').onclick = async () => { if (!bip) return; bip.prompt(); await bip.userChoice; bip = null; $('#inst').classList.remove('on'); };
$('#instX').onclick = () => { LS.set('instX', true); $('#inst').classList.remove('on'); };

/* ---------- boot ---------- */
if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
if (document.fonts) document.fonts.load("800 40px 'Barlow Condensed'").catch(() => {});
renderHome(); instShow();
