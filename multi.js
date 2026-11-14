/* Iron Timer TV — Multiatleta: 2-8 athletes on the same screen.
   Scaglionata: same WOD for everyone, automatic starts every N seconds, each with a 10 s countdown.
   Libera: every athlete has their own mode and is started with OK on their tile.
   No voice: the existing beeps, plus the athlete's tile flashing at the key moments. */
'use strict';

/* ---------- screens (added to the page, the existing ones stay as they are) ---------- */
document.getElementById('toast').insertAdjacentHTML('beforebegin', `
<section class="view" id="mset">
  <div class="top"><img src="img/helmet.png" alt=""><h1>Multiatleta</h1><span>Da 2 a 8 atleti sullo stesso schermo</span></div>
  <div class="msmain">
    <div class="mscol">
      <div class="lab">Numero atleti</div><div class="row" id="msN"></div>
      <div class="lab">Partenza</div><div class="row" id="msType"></div>
      <div id="msStag">
        <div class="lab">WOD per tutti</div><button class="btn f" id="msWod"></button>
        <div class="row" style="align-items:center;gap:2vw"><div><div class="lab" style="margin-bottom:1.4vh">Partenza ogni</div><div class="boxes" id="msEvery"></div></div>
        <div class="note" style="flex:1">Minimo 10 s. Ogni atleta parte col conto alla rovescia da 10, in automatico.</div></div>
      </div>
      <div id="msFree" class="note" style="font-size:2.8vh">Ogni atleta sceglie la sua modalità nel proprio riquadro (OK sul riquadro) e parte quando vuole con OK.</div>
    </div>
    <div class="mscol" style="flex:.8"><div class="lab">Nomi (facoltativi)</div><div id="msNames"></div></div>
    <div class="side"><button class="btn go f" id="msStart">Avvia</button><button class="btn f" id="msSave">Salva preset</button></div>
  </div>
  <div class="row" id="msPresets"></div>
  <div class="hint">◀▶▲▼ scegli · OK conferma · su "Partenza ogni" ▲▼ cambia il tempo · Indietro per uscire</div>
</section>
<section class="view" id="mpick">
  <div class="top"><img src="img/helmet.png" alt=""><h1 id="mpTitle"></h1><span>Scegli la modalità</span></div>
  <div id="mpModes"></div>
</section>
<section class="view" id="multi">
  <div class="rtop"><span id="mLbl"></span><img src="img/helmet.png" alt=""></div>
  <div id="mgrid"></div>
  <div class="hint" id="mHint"></div>
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
    if (newSeg) { if (sg.k === 'work') beep(1320, 0.45, 0.7); else if (sg.k === 'rest') beep(520, 0.45, 0.7); return; }
    if (isFinite(sg.d) && secs <= 3 && secs >= 1 && (sg.d >= 4 || sg.k === 'prep')) beep(880, 0.12, 0.6);
  }
  finish(natural) {
    if (this.st !== 'run') return;
    this.endAt = Math.min(Math.max(0, this.el()), this.total);
    this.st = 'done'; this.paused = false; this.manual = !natural; this.endReal = performance.now();
    if (natural && !horn()) { beep(1320, 0.25, 0.8); setTimeout(() => beep(1320, 0.25, 0.8), 330); setTimeout(() => beep(1760, 0.6, 0.8), 660); }
  }
  /* undo a Fine pressed by mistake: the time never stopped */
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
  if (!a.cfg) { v.cls.push('idle'); v.ph = 'Da impostare'; v.big = '--:--'; v.sub = 'OK = modalità'; return v; }
  if (a.st === 'idle') { v.cls.push('idle'); v.ph = 'Pronto'; v.big = preview(a.cfg); v.sub = 'OK = Start'; return v; }
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
      if (se < 0.5) v.cls.push(sg.k === 'rest' ? 'rfull' : 'gfull');            // start of work / rest
      else if (isFinite(sg.d) && sg.d >= 6 && rem <= 5 && frac(rem) > 0.5) v.cls.push('last'); // last 5 s
    }
  }
  if (a.paused) { v.cls.push('paused'); v.ph = 'In pausa'; }
  return v;
}

/* ---------- setup screen ---------- */
function renderMset(keep) {
  const was = keep || (document.activeElement && document.activeElement.dataset.k);
  draws = [];
  $('#msN').innerHTML = [2, 3, 4, 5, 6, 7, 8].map(n => `<button class="btn f${n === MA.n ? ' sel' : ''}" data-k="n${n}">${n}</button>`).join('');
  $$('#msN .btn').forEach(b => b.onclick = () => { MA.n = +b.dataset.k.slice(1); saveMA(); renderMset(b.dataset.k); });
  $('#msType').innerHTML = [['stag', 'Scaglionata'], ['free', 'Libera']].map(([v, l]) => `<button class="btn f${v === MA.type ? ' sel' : ''}" data-k="t${v}">${l}</button>`).join('');
  $$('#msType .btn').forEach(b => b.onclick = () => { MA.type = b.dataset.k.slice(1); saveMA(); renderMset(b.dataset.k); });
  $('#msStag').hidden = MA.type !== 'stag'; $('#msFree').hidden = MA.type === 'stag';
  $('#msWod').textContent = cfgLabel(MA.wod); $('#msWod').dataset.k = 'wod';
  const ev = $('#msEvery'); ev.innerHTML = '';
  const sb = spinBox(() => fmt(MA.every), d => { MA.every = Math.max(10, Math.min(600, MA.every + d * 5)); saveMA(); }, 'min:sec');
  sb.dataset.k = 'every'; sb.style.width = '2.6em'; ev.appendChild(sb);
  $('#msNames').innerHTML = Array.from({ length: MA.n }, (_, i) =>
    `<input class="txt f" data-k="nm${i}" maxlength="14" placeholder="Atleta ${i + 1}" value="${esc(MA.names[i] || '')}">`).join('');
  $$('#msNames .txt').forEach(t => t.onchange = t.oninput = () => { MA.names[+t.dataset.k.slice(2)] = t.value; saveMA(); });
  const P = LS.get('mpresets', []);
  $('#msPresets').innerHTML = P.map((p, i) => `<button class="btn f" data-k="p${i}">${esc(presetLabel(p))}</button>`).join('');
  $$('#msPresets .btn').forEach(b => b.onclick = () => {
    const p = P[+b.dataset.k.slice(1)];
    Object.assign(MA, JSON.parse(JSON.stringify(p))); saveMA(); renderMset('start'); toast('Preset caricato');
  });
  $('#msStart').dataset.k = 'start'; $('#msSave').dataset.k = 'save';
  const t = was && $('#mset [data-k="' + was + '"]');
  if (t && !t.closest('[hidden]')) t.focus();
}
const presetLabel = p => (p.type === 'stag' ? cfgLabel(p.wod) + ' ogni ' + fmt(p.every) : 'Libera') + ' · ' + p.n + ' atleti';
$('#msWod').onclick = () => pickMode('WOD per tutti', 'mset', MA.wod, c => { MA.wod = c; saveMA(); show('mset'); renderMset('wod'); });
$('#msSave').onclick = () => {
  const P = LS.get('mpresets', []);
  P.unshift(JSON.parse(JSON.stringify({ n: MA.n, type: MA.type, every: MA.every, wod: MA.wod, names: MA.names.slice(0, MA.n), cfgs: MA.cfgs.slice(0, MA.n) })));
  LS.set('mpresets', P.slice(0, 6)); renderMset('save'); toast('Preset salvato');
};
$('#msStart').onclick = startMulti;

/* ---------- mode picker + the existing setup screen, used for one athlete or for the shared WOD ---------- */
let SU_CB = null, MP_RET = 'mset';
function pickMode(title, ret, base, cb) {
  MP_RET = ret;
  $('#mpTitle').textContent = title;
  $('#mpModes').innerHTML = Object.entries(MODES).map(([k, m]) => `<button class="mode f" data-m="${k}"><b>${m.n}</b><span>${m.d}</span></button>`).join('');
  $$('#mpModes .mode').forEach(b => b.onclick = () => {
    const mode = b.dataset.m;
    openSetup(mode);
    SU = Object.assign({ mode }, MODES[mode].def, base && base.mode === mode ? base : {}, { mode });
    draws.forEach(f => f());
    $('#suTitle').textContent = MODES[mode].n + ' · ' + title;
    $('#suName').hidden = true; $('#suSave').hidden = true; $('#suDel').hidden = true;
    $('#suStart').textContent = 'Conferma';
    SU_CB = cb;
  });
  show('mpick', $('#mpModes [data-m="' + (base && base.mode || 'amrap') + '"]'));
}
function setupUiBack() { SU_CB = null; $('#suName').hidden = false; $('#suSave').hidden = false; $('#suStart').textContent = 'Avvia'; }
const _openSetup = openSetup;
openSetup = function (mode, presetIdx) { setupUiBack(); return _openSetup(mode, presetIdx); };
const _suStart = $('#suStart').onclick;
$('#suStart').onclick = () => {
  if (!SU_CB) return _suStart();
  const c = Object.assign({}, SU), cb = SU_CB; delete c.name;
  setupUiBack(); cb(c);
};

/* ---------- home: the new tile ---------- */
const _renderHome = renderHome;
renderHome = function () {
  _renderHome();
  $('#modes').insertAdjacentHTML('beforeend', '<button class="mode f multi" id="toMulti"><b>Multiatleta</b><span>Da 2 a 8 atleti sullo stesso schermo · partenze scaglionate o timer indipendenti</span></button>');
  $('#toMulti').onclick = () => { go('mset'); renderMset('start'); };
};

/* ---------- run ---------- */
let ATS = [], menuOpen = false, lastTile = 0, armExit = false;
function startMulti() {
  ATS = Array.from({ length: MA.n }, (_, i) => new AT(i, MA.type === 'stag' ? MA.wod : (MA.cfgs[i] || null)));
  audio();
  if (MA.type === 'stag') { ATS.forEach((a, i) => a.start(10, i * MA.every * 1000)); wake(true); }
  $('#mLbl').textContent = 'Multiatleta · ' + (MA.type === 'stag' ? 'Scaglionata · ' + cfgLabel(MA.wod) + ' · ogni ' + fmt(MA.every) : 'Libera · ' + MA.n + ' atleti');
  $('#mHint').textContent = MA.type === 'stag'
    ? '◀▶▲▼ scegli l\'atleta · OK = + Round (AMRAP) / Fine (For Time) · Play/Pausa = menu atleta · Indietro = pausa tutti / esci'
    : '◀▶▲▼ scegli l\'atleta · OK = modalità / Start / + Round (AMRAP) / Fine (For Time) · Play/Pausa = menu atleta · Indietro = menu';
  buildGrid();
  show('multi', $('#mgrid .tile'));
  drawGrid();
}
const LAYOUT = { 2: [2, 1], 3: [3, 1], 4: [2, 2], 5: [3, 2], 6: [3, 2], 7: [4, 2], 8: [4, 2] };
function buildGrid() {
  const [cols, rows] = LAYOUT[ATS.length], g = $('#mgrid');
  g.style.gridTemplateColumns = 'repeat(' + cols + ', minmax(0,1fr))';
  g.style.gridTemplateRows = 'repeat(' + rows + ', minmax(0,1fr))';
  g.innerHTML = ATS.map((a, i) => `<button class="tile f" data-i="${i}"><div class="tn"><i>${i + 1}</i><b>${esc(athName(i))}</b></div><div class="tmd"></div><div class="tph"></div><div class="tbig"></div><div class="tsub"></div><div class="tbar"></div></button>`).join('');
  // digits sized from the tile: wide enough for "12:00", tall enough to leave room for the labels
  const w = innerWidth * 0.96 / cols, h = innerHeight * 0.84 / rows;
  g.style.setProperty('--fs', Math.min(w * 0.33, h * 0.42) + 'px');
  g.style.setProperty('--fc', Math.min(w * 0.5, h * 0.55) + 'px');
  g.style.setProperty('--fp', Math.max(18, Math.min(h * 0.075, innerHeight * 0.055)) + 'px');
  g.style.setProperty('--fl', Math.max(18, Math.min(h * 0.075, innerHeight * 0.05)) + 'px');
  $$('#mgrid .tile').forEach(t => {
    t.onclick = () => primary(+t.dataset.i);
    t.onfocus = () => { lastTile = +t.dataset.i; };
  });
}
function drawGrid() {
  $$('#mgrid .tile').forEach(t => {
    const a = ATS[+t.dataset.i], v = look(a), c = 'tile' + (menuOpen ? '' : ' f') + (v.cls.length ? ' ' + v.cls.join(' ') : '');
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

/* OK on a tile: the one action that makes sense at that moment, otherwise the athlete's menu */
function primary(i) {
  const a = ATS[i];
  if (MA.type === 'free' && !a.cfg) return pickAthlete(i);
  if (a.st === 'idle') { audio(); a.start(S.cd, 0); wake(true); return; }
  if (a.inWork()) {
    if (a.cfg.mode === 'amrap') { a.rounds.push(a.workEl()); beep(1000, 0.08, 0.5); return; }
    if (a.cfg.mode === 'fortime' || a.cfg.mode === 'clock') { a.finish(false); return; }
  }
  athleteMenu(i);
}
function pickAthlete(i) {
  pickMode(athName(i), 'multi', ATS[i].cfg || MA.cfgs[i], c => {
    ATS[i].cfg = c; ATS[i].reset(); MA.cfgs[i] = c; saveMA();
    show('multi', $('#mgrid .tile[data-i="' + i + '"]')); drawGrid();
  });
}

/* ---------- menus ---------- */
function openMenu(title, items) {
  menuOpen = true;
  $$('#mgrid .tile').forEach(t => t.classList.remove('f'));
  $('#mmTitle').textContent = title;
  $('#mmBtns').innerHTML = items.map((it, k) => `<button class="btn f${it[2] ? ' ' + it[2] : ''}" data-k="${k}">${it[0]}</button>`).join('');
  $$('#mmBtns .btn').forEach(b => b.onclick = () => items[+b.dataset.k][1]());
  $('#mmenu').hidden = false;
  $('#mmBtns .btn').focus();
}
function closeMenu() {
  if (!menuOpen) return;
  menuOpen = false; $('#mmenu').hidden = true;
  $$('#mgrid .tile').forEach(t => t.classList.add('f'));
  const t = $('#mgrid .tile[data-i="' + lastTile + '"]'); if (t) t.focus();
  drawGrid();
}
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
    const b = $('#mmBtns .btn:last-child');
    if (running.length && !armExit) { armExit = true; b.textContent = 'OK di nuovo per uscire'; return; }
    menuOpen = false; $('#mmenu').hidden = true; ATS = []; wake(false); goHome();
  }, 'danger']);
  openMenu('Multiatleta', items);
}

/* remote: Back and play/pause (called from tv.js) */
window.multiBack = function () {
  if (cur === 'multi') { history.pushState({ away: 1 }, ''); if (menuOpen) closeMenu(); else mainMenu(); return true; }
  if (cur === 'mpick' || (cur === 'setup' && SU_CB)) {
    history.pushState({ away: 1 }, ''); setupUiBack();
    if (MP_RET === 'multi') { show('multi', $('#mgrid .tile[data-i="' + lastTile + '"]')); drawGrid(); }
    else { show('mset'); renderMset('wod'); }
    return true;
  }
  return false;
};
window.multiPlayPause = function () {
  if (cur !== 'multi' || menuOpen) return;
  athleteMenu(lastTile);
};

/* the home screen was drawn before this file loaded: draw it again with the new tile */
if (cur === 'home') renderHome();
