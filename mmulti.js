/* Iron Timer (telefono / tablet) — Multiatleta: fino a 4 atleti sul telefono, 8 sul tablet.
   Same rules as the Fire TV version (multi.js), with touch instead of the remote:
   tap on a tile = the one action that makes sense now, long press = the athlete's menu. */
'use strict';
(function () {
const ACOL = ['#3D8BFF', '#FF8A1F', '#FF3DA8', '#1FD6F0', '#A16BFF', '#EDEDED', '#FFD400', '#FF4433'];
const isTablet = () => Math.min(screen.width, screen.height) >= 600;
const MAXN = () => isTablet() ? 8 : 4;
const setText = (el, t) => { if (el.textContent !== t) el.textContent = t; };

/* ---------- screens ---------- */
$('#nav').insertAdjacentHTML('beforebegin', `
<section class="view" id="mset">
  <div class="topbar"><button class="back" id="msBack">‹ Indietro</button><button class="pillbtn" id="msSave">☆ Salva preset</button></div>
  <div class="titrow"><h1>Multiatleta</h1><span class="muted" id="msDesc"></span></div>
  <div class="msmain">
    <div class="field"><span class="flabel">Numero atleti</span><div class="seg" id="msN"></div></div>
    <div class="field"><span class="flabel">Partenza</span><div class="seg" id="msType"></div></div>
    <div class="field" id="msStag">
      <span class="flabel">WOD per tutti</span><button class="mswod" id="msWod"></button>
      <span class="flabel">Partenza ogni</span>
      <div class="stp"><button data-d="-1">−</button><div class="val" id="msEvery"></div><button data-d="1">+</button></div>
    </div>
    <div class="field" id="msFree"><span class="muted">Ogni atleta sceglie la sua modalità toccando il proprio riquadro, e parte quando vuole con un altro tocco.</span></div>
    <div class="field msnames"><span class="flabel">Nomi (facoltativi)</span><div id="msNames"></div></div>
    <div class="prow" id="msProw"><span class="lb">Preset</span><div class="pstrip" id="msPresets"></div></div>
    <button class="cta" id="msStart">Avvia</button>
  </div>
</section>
<section class="view" id="mpick">
  <div class="topbar"><button class="back" id="mpBack">‹ Indietro</button></div>
  <div class="titrow"><h1 id="mpTitle"></h1><span class="muted">Scegli la modalità</span></div>
  <div class="grid" id="mpModes"></div>
</section>
<section class="view" id="multi">
  <div class="mtop"><span id="mLbl"></span><button class="mmbtn" id="mMenu" aria-label="Menu">☰</button></div>
  <div id="mgrid"></div>
  <div class="mhint">Tocca = Start / + Round / Fine · Tieni premuto = menu atleta</div>
  <div id="mmenu" hidden><div class="mbox"><h2 id="mmTitle"></h2><div id="mmBtns"></div></div></div>
</section>`);

/* ---------- settings of the last multi session ---------- */
const MA = Object.assign({ n: 4, type: 'stag', every: 30, wod: { mode: 'amrap', dur: 720 }, names: [], cfgs: [] }, LS.get('multi', {}));
const saveMA = () => LS.set('multi', MA);
const athName = i => (MA.names[i] || '').trim() || 'Atleta ' + (i + 1);
const ROUNDS = ['fortime', 'amrap', 'clock'];

/* ---------- one timer per athlete (same rules as the single timer) ---------- */
class AT {
  constructor(i, cfg) { this.i = i; this.cfg = cfg || null; this.st = 'idle'; this.rounds = []; this.segs = []; }
  build(cd) {
    const c = this.cfg, s = [];
    if (cd > 0) s.push({ k: 'prep', d: cd });
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
  }
  start(cd, delayMs) {
    this.build(cd);
    this.t0 = performance.now() + (delayMs || 0); this.paused = false; this.pausedTot = 0;
    this.st = 'run'; this.rounds = []; this.key = ''; this.idx = -1; this.manual = false; this.endAt = 0; this.endReal = 0;
  }
  reset() { this.st = 'idle'; this.paused = false; this.rounds = []; }
  el() { return ((this.paused ? this.pauseAt : performance.now()) - this.t0 - this.pausedTot) / 1000; }
  pause(on) {
    if (this.st !== 'run') return;
    if (on && !this.paused) { this.pauseAt = performance.now(); this.paused = true; }
    else if (!on && this.paused) { this.pausedTot += performance.now() - this.pauseAt; this.paused = false; }
  }
  workStart() { const w = this.segs.find(x => x.k === 'work'); return w ? w.at : 0; }
  workEl() { return Math.max(0, (this.st === 'done' ? this.endAt : this.el()) - this.workStart()); }
  segAt(el) { let i = this.segs.findIndex(x => el < x.at + x.d); return i < 0 ? this.segs.length - 1 : i; }
  inWork() { if (this.st !== 'run' || this.paused) return false; const el = this.el(); return el >= 0 && this.segs[this.segAt(el)].k === 'work'; }
  tick() {
    if (this.st !== 'run' || this.paused) return;
    const el = this.el(); if (el < 0) return;
    if (el >= this.total) { this.finish(true); return; }
    const i = this.segAt(el), sg = this.segs[i], se = el - sg.at;
    const secs = isFinite(sg.d) ? Math.ceil(sg.d - se - 1e-6) : Math.floor(se);
    const k = i + ':' + secs; if (k === this.key) return;
    const newSeg = i !== this.idx; this.key = k; this.idx = i;
    if (newSeg) { if (sg.k === 'work') { beep(1320, 0.45, 0.7); vib(300); } else if (sg.k === 'rest') { beep(520, 0.45, 0.7); vib(300); } return; }
    if (isFinite(sg.d) && secs <= 3 && secs >= 1 && (sg.d >= 4 || sg.k === 'prep')) beep(880, 0.12, 0.6);
  }
  finish(natural) {
    if (this.st !== 'run') return;
    this.endAt = Math.min(Math.max(0, this.el()), this.total);
    this.st = 'done'; this.paused = false; this.manual = !natural; this.endReal = performance.now();
    if (natural) { beep(1320, 0.25, 0.8); setTimeout(() => beep(1320, 0.25, 0.8), 330); setTimeout(() => beep(1760, 0.6, 0.8), 660); vib([200, 100, 200]); }
  }
  undo() { if (this.st === 'done' && this.manual) { this.st = 'run'; this.key = ''; } }
}

/* ---------- what a tile shows, and when it flashes ---------- */
const frac = x => x - Math.floor(x);
function preview(c) {
  switch (c.mode) {
    case 'amrap': return fmt(c.dur);
    case 'emom': return fmt(c.every);
    case 'tabata': case 'interval': return fmt(c.work);
  }
  return '0:00';
}
function look(a) {
  const v = { cls: [], ph: '', big: '', sub: '', md: a.cfg ? (a.cfg.mode === 'tabata' ? 'Tabata ' + a.cfg.work + '/' + a.cfg.rest : cfgLabel(a.cfg)) : '', bar: 0 };
  if (!a.cfg) { v.cls.push('idle'); v.ph = 'Da impostare'; v.big = '--:--'; v.sub = 'Tocca = modalità'; return v; }
  if (a.st === 'idle') { v.cls.push('idle'); v.ph = 'Pronto'; v.big = preview(a.cfg); v.sub = 'Tocca = Start'; return v; }
  const span = a.total - a.workStart();
  if (a.st === 'done') {
    const dt = performance.now() - a.endReal;
    v.cls.push(dt < 1000 && Math.floor(dt / 167) % 2 === 0 ? 'gfull' : 'done');
    v.ph = 'Finito'; v.bar = 100;
    if (a.cfg.mode === 'amrap') { v.big = String(a.rounds.length); v.sub = 'Round'; }
    else { v.big = fmt(a.workEl()); v.sub = a.rounds.length ? 'Round ' + a.rounds.length : ''; }
    return v;
  }
  const el = a.el();
  if (el < 0) { v.cls.push('wait'); v.ph = 'Parte tra'; v.big = fmt(Math.ceil(-el)); if (a.paused) v.cls.push('paused'); return v; }
  const sg = a.segs[a.segAt(el)], se = el - sg.at, rem = sg.d - se;
  if (sg.k === 'prep') {
    v.cls.push(rem <= 3 && frac(rem) > 0.5 && !a.paused ? 'yfull' : 'cdb');
    v.ph = 'Via tra'; v.big = String(Math.max(1, Math.ceil(rem))); v.sub = 'Preparati';
  } else {
    if (sg.up) { v.big = fmt(se); v.ph = a.cfg.mode === 'clock' ? 'Tempo' : 'For Time'; }
    else { v.big = fmt(Math.ceil(rem - 1e-6)); v.ph = sg.k === 'rest' ? 'Riposo' : (a.cfg.mode === 'amrap' ? 'AMRAP' : 'Lavoro'); }
    if (sg.r) v.sub = 'Round ' + sg.r + ' / ' + sg.n;
    else if (ROUNDS.includes(a.cfg.mode)) v.sub = 'Round ' + (a.rounds.length + 1);
    if (isFinite(span)) v.bar = Math.max(0, Math.min(100, (el - a.workStart()) / span * 100));
    if (sg.k === 'rest') v.cls.push('rest');
    if (!a.paused) {
      if (se < 0.5) v.cls.push(sg.k === 'rest' ? 'rfull' : 'gfull');
      else if (isFinite(sg.d) && sg.d >= 6 && rem <= 5 && frac(rem) > 0.5) v.cls.push('last');
    }
  }
  if (a.paused) { v.cls.push('paused'); v.ph = 'In pausa'; }
  return v;
}

/* ---------- setup screen ---------- */
function renderMset() {
  MA.n = Math.min(MA.n, MAXN());
  $('#msDesc').textContent = 'Fino a ' + MAXN() + ' atleti sullo stesso schermo';
  segCtl($('#msN'), Array.from({ length: MAXN() - 1 }, (_, i) => [i + 2, String(i + 2)]), () => MA.n, v => { MA.n = +v; saveMA(); renderNames(); });
  segCtl($('#msType'), [['stag', 'Scaglionata'], ['free', 'Libera']], () => MA.type, v => { MA.type = v; saveMA(); renderMset(); });
  $('#msStag').hidden = MA.type !== 'stag'; $('#msFree').hidden = MA.type === 'stag';
  $('#msWod').textContent = cfgLabel(MA.wod);
  $('#msEvery').textContent = fmt(MA.every);
  renderNames();
  const P = LS.get('mpresets', []).filter(p => p.n <= MAXN());
  $('#msProw').style.display = P.length ? '' : 'none';
  $('#msPresets').innerHTML = P.map((p, i) => `<div class="pchip" data-i="${i}">${esc(presetLabel(p))}<button class="x" data-del="${i}">×</button></div>`).join('');
  $$('#msPresets .pchip').forEach(el => el.onclick = e => {
    const i = +el.dataset.i, all = LS.get('mpresets', []), k = all.indexOf(all.find(x => JSON.stringify(x) === JSON.stringify(P[i])));
    if (e.target.dataset.del !== undefined) { if (confirm('Eliminare il preset?')) { all.splice(k, 1); LS.set('mpresets', all); renderMset(); } return; }
    Object.assign(MA, JSON.parse(JSON.stringify(P[i]))); saveMA(); renderMset(); toast('Preset caricato');
  });
}
function renderNames() {
  $('#msNames').innerHTML = Array.from({ length: MA.n }, (_, i) =>
    `<input class="txt" data-i="${i}" maxlength="14" placeholder="Atleta ${i + 1}" value="${esc(MA.names[i] || '')}" style="border-left:6px solid ${ACOL[i]}">`).join('');
  $$('#msNames .txt').forEach(t => t.oninput = () => { MA.names[+t.dataset.i] = t.value; saveMA(); });
}
const presetLabel = p => (p.type === 'stag' ? cfgLabel(p.wod) + ' ogni ' + fmt(p.every) : 'Libera') + ' · ' + p.n + ' atleti';
$$('#msStag .stp button').forEach(b => {
  let rep = 0, tt = 0;
  const step = () => { MA.every = Math.max(10, Math.min(600, MA.every + (+b.dataset.d) * 5)); saveMA(); $('#msEvery').textContent = fmt(MA.every); };
  const stop = () => { clearTimeout(tt); clearInterval(rep); };
  b.onpointerdown = e => { e.preventDefault(); step(); tt = setTimeout(() => rep = setInterval(step, 90), 420); };
  b.onpointerup = b.onpointerleave = b.onpointercancel = stop;
});
$('#msWod').onclick = () => pickMode('WOD per tutti', 'mset', MA.wod, c => { MA.wod = c; saveMA(); go('mset'); renderMset(); });
$('#msSave').onclick = () => {
  const P = LS.get('mpresets', []);
  P.unshift(JSON.parse(JSON.stringify({ n: MA.n, type: MA.type, every: MA.every, wod: MA.wod, names: MA.names.slice(0, MA.n), cfgs: MA.cfgs.slice(0, MA.n) })));
  LS.set('mpresets', P.slice(0, 12)); renderMset(); toast('Preset salvato');
};
$('#msBack').onclick = () => go('home');
$('#msStart').onclick = startMulti;

/* ---------- mode picker + the existing setup screen, for one athlete or for the shared WOD ---------- */
let SU_CB = null, MP_RET = 'mset';
function pickMode(title, ret, base, cb) {
  MP_RET = ret;
  $('#mpTitle').textContent = title;
  $('#mpModes').innerHTML = Object.entries(MODES).map(([k, m], i) => `<button class="mode${base && base.mode === k ? ' last' : ''}" data-m="${k}"><i class="num">0${i + 1}</i><span class="mt"><b>${m.n}</b><span class="d">${m.d}</span></span></button>`).join('');
  $$('#mpModes .mode').forEach(b => b.onclick = () => {
    const mode = b.dataset.m;
    openSetup(mode, 'multi', base && base.mode === mode ? base : null);
    $('#suTitle').textContent = MODES[mode].n + ' · ' + title;
    $('#suName').parentElement.style.display = 'none'; $('#suSave').hidden = true; $('#suRec').style.display = 'none';
    $('#suStart').textContent = 'Conferma';
    SU_CB = cb;
  });
  go('mpick');
}
function setupUiBack() { SU_CB = null; $('#suName').parentElement.style.display = ''; $('#suSave').hidden = false; $('#suRec').style.display = ''; $('#suStart').textContent = 'Avvia timer'; }
const back = () => {
  setupUiBack();
  if (MP_RET === 'multi') { go('multi'); buildGrid(); drawGrid(); } else { go('mset'); renderMset(); }
};
$('#mpBack').onclick = back;
// the setup screen's own buttons, when it is used for Multiatleta
$$('#setup [data-back]').forEach(b => { const f = b.onclick; b.onclick = e => SU_CB ? go('mpick') : f(e); });
const _suStart = $('#suStart').onclick;
$('#suStart').onclick = () => {
  if (!SU_CB) return _suStart();
  commitEdit();
  const c = Object.assign({}, SU), cb = SU_CB; delete c.name;
  setupUiBack(); cb(c);
};
const _openSetup = openSetup;
openSetup = function (mode, from, preset) { if (from !== 'multi') setupUiBack(); return _openSetup(mode, from, preset); };

/* ---------- home: the new tile ---------- */
const _renderHome = renderHome;
renderHome = function () {
  _renderHome();
  $('#modes').insertAdjacentHTML('beforeend', `<button class="mode multi" id="toMulti"><i class="num">07 · Novità</i><span class="mt"><b>Multiatleta</b><span class="d">Fino a ${MAXN()} atleti sullo stesso schermo · partenze scaglionate o libere</span></span><span class="stripe">${ACOL.map(c => `<i style="background:${c}"></i>`).join('')}</span></button>`);
  $('#toMulti').onclick = () => { go('mset'); renderMset(); };
};

/* ---------- run ---------- */
let ATS = [], menuOpen = false, armExit = false;
function startMulti() {
  MA.n = Math.min(MA.n, MAXN());
  ATS = Array.from({ length: MA.n }, (_, i) => new AT(i, MA.type === 'stag' ? MA.wod : (MA.cfgs[i] || null)));
  audio(); setSession('transient');
  if (MA.type === 'stag') { ATS.forEach((a, i) => a.start(10, i * MA.every * 1000)); wake(true); }
  $('#mLbl').textContent = MA.type === 'stag' ? 'Scaglionata · ' + cfgLabel(MA.wod) + ' · ogni ' + fmt(MA.every) : 'Libera · ' + MA.n + ' atleti';
  go('multi'); buildGrid(); drawGrid();
}
function layout(n) {
  const port = innerHeight > innerWidth;
  if (port) return n <= 3 ? [1, n] : [2, Math.ceil(n / 2)];
  return n <= 3 ? [n, 1] : n === 4 ? [2, 2] : [Math.ceil(n / 2), 2];
}
function buildGrid() {
  const g = $('#mgrid'), [cols, rows] = layout(ATS.length);
  g.style.gridTemplateColumns = 'repeat(' + cols + ', minmax(0,1fr))';
  g.style.gridTemplateRows = 'repeat(' + rows + ', minmax(0,1fr))';
  g.innerHTML = ATS.map((a, i) => `<button class="mt" data-i="${i}" style="--ac:${ACOL[i]}"><div class="tn"><i>${i + 1}</i><b>${esc(athName(i))}</b></div><div class="tmd"></div><div class="tph"></div><div class="tbig"></div><div class="tsub"></div><div class="tbar"></div></button>`).join('');
  sizeGrid();
  $$('#mgrid .mt').forEach(t => {
    const i = +t.dataset.i; let lp = 0, longed = false;
    t.onpointerdown = () => { audio(); longed = false; clearTimeout(lp); lp = setTimeout(() => { longed = true; vib(30); athleteMenu(i); }, 550); };
    t.onpointerup = t.onpointerleave = t.onpointercancel = () => clearTimeout(lp);
    t.oncontextmenu = e => e.preventDefault();
    t.onclick = () => { if (longed) { longed = false; return; } primary(i); };
  });
}
function sizeGrid() {
  const g = $('#mgrid'), [cols, rows] = layout(ATS.length);
  const w = g.clientWidth / cols, h = g.clientHeight / rows;
  g.style.setProperty('--fl', Math.max(13, Math.min(h * 0.09, w * 0.09, 26)) + 'px');
  g.style.setProperty('--fs', Math.min(w * 0.3, h * 0.36) + 'px');
  g.style.setProperty('--fc', Math.min(w * 0.45, h * 0.48) + 'px');
  g.style.setProperty('--fp', Math.max(12, Math.min(h * 0.07, w * 0.08, 24)) + 'px');
}
addEventListener('resize', () => { if (cur === 'multi' && ATS.length) { buildGrid(); drawGrid(); } });
function drawGrid() {
  $$('#mgrid .mt').forEach(t => {
    const a = ATS[+t.dataset.i], v = look(a), c = 'mt' + (v.cls.length ? ' ' + v.cls.join(' ') : '');
    if (t.className !== c) t.className = c;
    setText(t.children[1], v.md); setText(t.children[2], v.ph); setText(t.children[3], v.big); setText(t.children[4], v.sub);
    t.children[3].classList.toggle('long', v.big.length > 5);
    const bw = v.bar.toFixed(1) + '%'; if (t.children[5].style.width !== bw) t.children[5].style.width = bw;
  });
}
setInterval(() => {
  if (!ATS.length) return;
  ATS.forEach(a => a.tick());
  if (cur === 'multi') drawGrid();
}, 50);
window.multiBusy = () => ATS.some(a => a.st === 'run');

/* tap on a tile: the one action that makes sense at that moment, otherwise the athlete's menu */
function primary(i) {
  const a = ATS[i];
  if (menuOpen) return;
  if (MA.type === 'free' && !a.cfg) return pickAthlete(i);
  if (a.st === 'idle') { audio(); a.start(S.cd, 0); wake(true); return; }
  if (a.inWork()) {
    if (a.cfg.mode === 'amrap') { a.rounds.push(a.workEl()); beep(1000, 0.08, 0.5); vib(40); return; }
    if (a.cfg.mode === 'fortime' || a.cfg.mode === 'clock') { a.finish(false); return; }
  }
  athleteMenu(i);
}
function pickAthlete(i) {
  pickMode(athName(i), 'multi', ATS[i].cfg || MA.cfgs[i], c => {
    ATS[i].cfg = c; ATS[i].reset(); MA.cfgs[i] = c; saveMA();
    go('multi'); buildGrid(); drawGrid();
  });
}

/* ---------- menus ---------- */
function openMenu(title, items) {
  menuOpen = true;
  $('#mmTitle').textContent = title;
  $('#mmBtns').innerHTML = items.map((it, k) => `<button class="cta${it[2] === 'danger' ? ' red' : ' sec'}" data-k="${k}">${it[0]}</button>`).join('');
  $$('#mmBtns .cta').forEach(b => b.onclick = () => items[+b.dataset.k][1]());
  $('#mmenu').hidden = false;
}
function closeMenu() { if (!menuOpen) return; menuOpen = false; $('#mmenu').hidden = true; drawGrid(); }
$('#mmenu').onclick = e => { if (e.target.id === 'mmenu') closeMenu(); };
const act = f => () => { f(); closeMenu(); };
function athleteMenu(i) {
  const a = ATS[i], free = MA.type === 'free', items = [];
  if (a.st === 'run') {
    if (a.inWork() && ROUNDS.includes(a.cfg.mode)) items.push(['+ Round', act(() => { a.rounds.push(a.workEl()); beep(1000, 0.08, 0.5); })]);
    items.push([a.paused ? 'Riprendi' : 'Pausa', act(() => a.pause(!a.paused))]);
    items.push([(a.cfg.mode === 'fortime' || a.cfg.mode === 'clock') ? 'Fine' : 'Stop', act(() => a.finish(false)), 'danger']);
    if (free) items.push(['Azzera', act(() => a.reset())]);
  }
  if (a.st === 'done' && a.manual) items.push(['Riprendi il tempo (Fine per sbaglio)', act(() => a.undo())]);
  if (free && a.st === 'done') items.push(['Riparti', act(() => a.reset())]);
  if (free && a.st !== 'run') items.push(['Cambia modalità', () => { closeMenu(); pickAthlete(i); }]);
  items.push(['Chiudi', closeMenu]);
  openMenu((i + 1) + ' · ' + athName(i), items);
}
function mainMenu() {
  armExit = false;
  const running = ATS.filter(a => a.st === 'run'), anyGoing = running.some(a => !a.paused);
  const items = [['Torna al timer', closeMenu]];
  if (running.length) items.push([anyGoing ? 'Pausa tutti' : 'Riprendi tutti', act(() => running.forEach(a => a.pause(anyGoing)))]);
  items.push(['Esci da Multiatleta', () => {
    const b = $('#mmBtns .cta:last-child');
    if (running.length && !armExit) { armExit = true; b.textContent = 'Tocca di nuovo per uscire'; return; }
    menuOpen = false; $('#mmenu').hidden = true; ATS = []; wake(false); go('home');
  }, 'danger']);
  openMenu('Multiatleta', items);
}
$('#mMenu').onclick = mainMenu;
document.addEventListener('visibilitychange', () => { if (!document.hidden && ATS.some(a => a.st === 'run')) wake(true); });
renderHome();
})();
