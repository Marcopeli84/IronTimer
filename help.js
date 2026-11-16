/* Iron Timer — Istruzioni (in Impostazioni). Same file for the phone/tablet app and the Fire TV app. */
'use strict';
(function () {
const TV = !!document.getElementById('toSett');
const MODI = '<b>For Time</b>: cronometro che conta in avanti, con time cap facoltativo.<br><b>AMRAP</b>: più round possibili nel tempo, conto alla rovescia.<br><b>EMOM</b>: un round ogni intervallo (es. ogni minuto per 10 minuti).<br><b>Tabata</b>: lavoro e riposo in secondi (classico 20/10 × 8).<br><b>Intervalli</b>: lavoro e riposo in minuti.<br><b>Cronometro</b>: conta in avanti senza limiti.';
const MULTI_STAG = 'Stesso WOD per tutti. Scegli il numero di atleti, il WOD e ogni quanto parte il successivo: ogni atleta ha il suo conto alla rovescia da 10 e parte da solo. Ogni atleta ha un colore.';
const T = TV ? [
  ['Telecomando', '<b>Frecce</b>: spostati tra i pulsanti.<br><b>▲▼</b> su un numero: cambia il valore.<br><b>OK</b>: conferma.<br><b>Play/Pausa</b>: pausa del timer; in Multiatleta apre il menu dell\'atleta.<br><b>Indietro</b>: torna indietro; durante il timer lo mette in pausa invece di uscire.'],
  ['Modalità', MODI],
  ['Avviare un timer', 'Scegli la modalità, imposta i valori con ▲▼ e premi <b>Avvia</b>. Parte il conto alla rovescia (lo cambi in Impostazioni).<br>Durante il timer: <b>+ Round</b> segna un round, <b>Pausa</b> e <b>Stop</b>. Alla fine puoi salvare il risultato nello storico.<br><b>Salva preset</b> memorizza le impostazioni per ritrovarle in home.'],
  ['Multiatleta · scaglionata', MULTI_STAG + '<br>Sul riquadro dell\'atleta: <b>OK</b> = + Round (AMRAP) o Fine (For Time); <b>Play/Pausa</b> = menu dell\'atleta (pausa, stop).'],
  ['Multiatleta · libera', 'Ogni atleta ha la sua modalità. Spostati sul riquadro con le frecce: il riquadro selezionato ha il bordo bianco che pulsa finché l\'atleta non parte.<br><b>OK</b> la prima volta sceglie la modalità, poi fa partire il timer. <b>Indietro</b> apre il menu generale (pausa tutti, esci).'],
  ['Storico e audio', 'Lo <b>Storico</b> raccoglie i WOD salvati. In <b>Impostazioni</b> scegli conto alla rovescia, beep e voce; <b>Fai sentire</b> prova l\'audio della TV.']
] : [
  ['Modalità', MODI],
  ['Avviare un timer', 'Tocca una modalità, imposta i valori con <b>− +</b> (tieni premuto per andare veloce) e tocca <b>Avvia timer</b>. Parte il conto alla rovescia, che cambi in Impostazioni.<br><b>☆ Salva preset</b> memorizza le impostazioni: le ritrovi in fondo alla home.'],
  ['Durante il timer', '<b>+1 Round</b> segna un round, <b>Pausa</b> lo ferma, <b>Stop</b> lo chiude. Alla fine puoi salvare il risultato nello <b>Storico</b>. Lo schermo resta acceso finché il timer va.'],
  ['Registrare un video', 'Tocca <b>Registra</b>: vedi l\'inquadratura, giri la camera (frontale/posteriore) e scegli il timer da usare. Tempo, round, data e logo restano impressi nel video o nella foto.<br>Con l\'icona <b>Dati sul video</b> scegli cosa mostrare, dove e quanto grande.'],
  ['Multiatleta', 'Fino a 4 atleti sul telefono, 8 sul tablet, ognuno col suo colore.<br><b>Scaglionata</b>: ' + MULTI_STAG.replace('Stesso WOD per tutti. ', '') + '<br><b>Libera</b>: ogni atleta sceglie la sua modalità toccando il proprio riquadro.<br><b>Tocca</b> il riquadro = Start, + Round (AMRAP) o Fine (For Time). <b>Tieni premuto</b> = menu dell\'atleta (pausa, stop, cambia modalità). <b>☰</b> in alto = pausa tutti / esci.'],
  ['Installare l\'app', '<b>Android</b>: apri il link con Chrome e tocca <b>Installa</b> (o menu ⋮ → Installa app).<br><b>iPhone/iPad</b>: apri con Safari, tocca <b>Condividi</b> → <b>Aggiungi alla schermata Home</b>.<br>Gli aggiornamenti arrivano da soli alla riapertura. I dati restano sul dispositivo.']
];

if (TV) {
  document.getElementById('toast').insertAdjacentHTML('beforebegin', `<section class="view" id="help">
    <div class="top"><img src="img/helmet.png" alt=""><h1>Istruzioni</h1><span>Come funziona Iron Timer</span></div>
    <div class="hmain"><div class="hlist">${T.map((t, i) => `<button class="btn f" data-h="${i}">${t[0]}</button>`).join('')}</div><div class="htxt" id="hTxt"></div></div>
    <div class="hint">▲▼ scegli l'argomento · Indietro per tornare alle impostazioni</div></section>`);
  const st = document.createElement('style');
  st.textContent = '.hmain{flex:1;min-height:0;display:flex;gap:2.5vw}.hlist{flex:none;width:30vw;display:flex;flex-direction:column;gap:1.4vh}.hlist .btn{text-align:left;font-size:3.6vh}.htxt{flex:1;background:var(--p);border:.35vh solid var(--b);padding:3vh 2.4vw;font-size:3.3vh;line-height:1.45;color:var(--t);overflow:hidden}.htxt b{color:var(--g)}';
  document.head.appendChild(st);
  $$('#help .hlist .btn').forEach(b => { b.onfocus = () => { $('#hTxt').innerHTML = T[+b.dataset.h][1]; }; b.onclick = b.onfocus; });
  $('#setTest').closest('.sett').insertAdjacentHTML('beforebegin', '<div class="sett"><span>Come funziona</span><button class="btn f" id="setHelp">Istruzioni</button></div>');
  $('#setHelp').onclick = () => show('help');
  window.helpBack = () => { if (cur !== 'help') return false; history.pushState({ away: 1 }, ''); show('sett', $('#setHelp')); return true; };
} else {
  $('#nav').insertAdjacentHTML('beforebegin', `<section class="view" id="help">
    <div class="topbar"><button class="back" id="hBack">‹ Impostazioni</button></div>
    <div class="titrow"><h1>Istruzioni</h1><span class="muted">Come funziona Iron Timer</span></div>
    <div class="hacc">${T.map((t, i) => `<div class="hitem"><button class="hhead" data-h="${i}">${t[0]}<span>+</span></button><div class="hbody">${t[1]}</div></div>`).join('')}</div></section>`);
  const st = document.createElement('style');
  st.textContent = '.hacc{flex:1;min-height:0;display:flex;flex-direction:column;gap:8px;overflow:auto}.hitem{flex:none;background:var(--p);border:1px solid var(--b);border-radius:4px}.hhead{width:100%;display:flex;justify-content:space-between;align-items:center;padding:12px 14px;font-family:var(--cond);font-weight:800;font-size:clamp(17px,calc(var(--vh)*2.6),22px);text-transform:uppercase;color:var(--t);text-align:left}.hhead span{color:var(--g);font-size:1.3em}.hbody{display:none;padding:0 14px 14px;font-size:15px;line-height:1.5;color:#cfcfcf}.hbody b{color:var(--g);font-weight:600}.hitem.on{border-color:var(--g)}.hitem.on .hbody{display:block}.hitem.on .hhead span{transform:rotate(45deg)}';
  document.head.appendChild(st);
  $$('#help .hhead').forEach(b => b.onclick = () => { const it = b.parentElement, on = !it.classList.contains('on'); $$('#help .hitem').forEach(x => x.classList.remove('on')); it.classList.toggle('on', on); });
  $('#setClear').closest('.field').insertAdjacentHTML('beforebegin', '<div class="field"><span class="flabel">Come funziona</span><button class="cta sec" id="setHelp" style="height:clamp(36px,calc(var(--vh)*5.6),46px);font-size:16px">Istruzioni</button></div>');
  $('#setHelp').onclick = () => go('help');
  $('#hBack').onclick = () => go('sett');
}
})();
