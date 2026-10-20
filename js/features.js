// features.js — the four novelty features shared by both apps:
//   1. Proof of pay (pay slip confirmed by both sides)   2. Wage record (statement)
//   3. Works offline (cache + action queue)               4. Language barrier (3 languages,
//      translated quick messages, read-aloud)
// plus real nearby water / shade / tea shops from OpenStreetMap.
// Owner: Member 4 (lead), with Member 3 (places) and Member 1 (messages)

const LANGS = { en: 'English', ta: 'தமிழ்', hi: 'हिंदी' };
const SPEECH_LANG = { en: 'en-IN', ta: 'ta-IN', hi: 'hi-IN' };

// ---------- Language ----------
function setLang(lang) {
  App.lang = LANGS[lang] ? lang : 'en';
  Store.set('lang', App.lang);
  if (App.onLang) App.onLang();
}

function langSelectHTML() {
  return Object.entries(LANGS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
}

function initLangSelect() {
  const sel = document.getElementById('langSelect');
  if (!sel) return;
  sel.innerHTML = langSelectHTML();
  sel.value = App.lang;
  sel.addEventListener('change', () => setLang(sel.value));
}

// Read text aloud in the phone's chosen language (for workers who cannot read)
function speak(text) {
  if (!('speechSynthesis' in window)) return showToast(t('noVoice'));
  const u = new SpeechSynthesisUtterance(text);
  u.lang = SPEECH_LANG[App.lang] || 'en-IN';
  u.rate = 0.9;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}

// Safe inside an HTML attribute value
function attr(text) {
  return String(text).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// 🔊 buttons carry their words in data-say; one listener reads any of them aloud
function speakButton(text) {
  return `<button type="button" class="speak-btn" aria-label="${attr(t('listen'))}" data-say="${attr(text)}">🔊</button>`;
}
document.addEventListener('click', (e) => {
  const btn = e.target.closest && e.target.closest('[data-say]');
  if (btn) speak(btn.dataset.say);
});

// ---------- Quick messages: a fixed phrase list in 3 languages ----------
// Only the phrase key goes to the database, so each phone shows it in ITS language.
const PHRASES = {
  worker: ['onMyWay', 'reached', 'waterBreak', 'needTools', 'lateTen', 'workDone'],
  employer: ['comeIn', 'showWork', 'drinkWater', 'payingNow', 'goodWork', 'callMe']
};

const Msg = { list: [], bookingId: null, listening: false };

async function loadMessages(bookingId) {
  Msg.bookingId = bookingId;
  if (!bookingId) { Msg.list = []; return; }
  const { data } = await db.from('messages').select('*').eq('booking_id', bookingId).order('created_at');
  Msg.list = data || [];
}

function listenMessages(onNew) {
  if (Msg.listening) return;
  Msg.listening = true;
  db.channel('quick-messages')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (p) => {
      if (p.new.booking_id !== Msg.bookingId) {
        if (App.onOtherMessage) App.onOtherMessage(p.new);
        return;
      }
      if (Msg.list.some((m) => m.id === p.new.id)) return;
      Msg.list.push(p.new);
      if (onNew) onNew(p.new);
    })
    .subscribe();
}

async function sendPhrase(sender, phrase) {
  if (!Msg.bookingId) return;
  if (!navigator.onLine) return showToast(t('offlineBanner'));
  const { data, error } = await db.from('messages')
    .insert({ booking_id: Msg.bookingId, sender, phrase }).select().single();
  if (error) return showToast(t('saveError'));
  if (!Msg.list.some((m) => m.id === data.id)) Msg.list.push(data);
  if (App.onMessages) App.onMessages();
}

// me = 'worker' | 'employer'; otherName = the other person's name
function messagesHTML(me, otherName) {
  const recent = Msg.list.slice(-4).map((m) => {
    const text = t('ph_' + m.phrase);
    const who = m.sender === me ? t('you') : esc(otherName || '');
    return `<li class="${m.sender === me ? 'mine' : 'theirs'}"><span><small>${who}</small>${esc(text)}</span>${speakButton(text)}</li>`;
  }).join('');
  const chips = PHRASES[me].map((p) =>
    `<button type="button" class="chip" onclick="sendPhrase('${me}', '${p}')">${esc(t('ph_' + p))}</button>`).join('');
  return `
    <div class="messages">
      <b>💬 ${t('quickMessages')}</b>
      <p class="muted small">${t('msgHint')}</p>
      ${recent ? `<ul class="msg-list">${recent}</ul>` : ''}
      <div class="chips wrap">${chips}</div>
    </div>`;
}

// ---------- Proof of pay: the pay slip ----------
function workedMinutes(b) {
  if (!b.started_at) return 0;
  const end = b.completed_at ? Date.parse(b.completed_at) : Date.now();
  return Math.max(0, Math.round((end - Date.parse(b.started_at)) / 60000));
}

function fmtDuration(mins) {
  const h = Math.floor(mins / 60), m = mins % 60;
  return h ? `${h} h ${m} min` : `${m} min`;
}

function fmtDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(App.lang === 'en' ? 'en-IN' : App.lang + '-IN',
    { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function amountOf(b) {
  return b.paid_amount != null ? b.paid_amount : b.agreed_wage + 80 * (b.overtime_hours || 0);
}

// The slip itself (also used for printing / saving as PDF)
function slipHTML(b, employer, worker) {
  const rows = [
    [t('receiptNo'), `<b class="code">${esc(b.receipt_no || '—')}</b>`],
    [t('work'), `${WORK_TYPES[b.type].icon} ${t(b.type)}, ${esc(b.area)}`],
    [t('employer'), `${esc(employer ? employer.name : '—')}${employer && employer.phone ? ' · ' + esc(employer.phone) : ''}`],
    [t('worker'), `${esc(worker ? worker.name : '—')}${worker && worker.phone ? ' · ' + esc(worker.phone) : ''}`],
    [t('hours'), `${b.hours} ${t('hoursUnit')}`],
    [t('workedTime'), fmtDuration(workedMinutes(b))],
    [t('agreedWage'), `₹${b.agreed_wage}`],
    [t('overtimeLabel'), b.overtime_hours ? `${b.overtime_hours} h · +₹${80 * b.overtime_hours}` : '—'],
    [t('tipLabel'), b.tip ? `+₹${b.tip}` : '—'],
    [t('travelPay'), b.travel_pay ? `+₹${b.travel_pay}` : '—'],
    ...(b.materials_amount ? [[t('materialsLabel'), `+₹${b.materials_amount}`]] : []),
    ...(b.rain_off ? [[t('rainLabel'), '🌧️ ✓']] : []),
    [t('commissionLabel'), t('commissionValue')],
    [t('totalPaid'), `<b>₹${amountOf(b)}</b>`],
    [t('paidOn'), fmtDateTime(b.paid_at)],
    [t('confirmedOn'), fmtDateTime(b.worker_confirmed_at)]
  ];
  return `
    <div class="slip" id="slipPrint">
      <div class="slip-head"><b>🤝 Worker Buddy</b><span>${t('paySlip')}</span></div>
      <div class="slip-amount">₹${amountOf(b)}</div>
      <div class="slip-ok">✅ ${t('slipConfirmed')}</div>
      <div class="agreement">${rows.map(([k, v]) => `<div><span>${k}</span><span>${v}</span></div>`).join('')}</div>
      <p class="muted small">${t('statementNote')}</p>
    </div>`;
}

function slipText(b, employer, worker) {
  return [
    `🧾 Worker Buddy · ${t('paySlip')} ${b.receipt_no}`,
    `${t('work')}: ${t(b.type)}, ${b.area}`,
    `${t('employer')}: ${employer ? employer.name : ''}`,
    `${t('worker')}: ${worker ? worker.name : ''}`,
    `${t('workedTime')}: ${fmtDuration(workedMinutes(b))}`,
    `${t('totalPaid')}: ₹${amountOf(b)}`,
    `${t('paidOn')}: ${fmtDateTime(b.paid_at)}`,
    `${t('confirmedOn')}: ${fmtDateTime(b.worker_confirmed_at)}`,
    t('slipConfirmed')
  ].join('\n');
}

let slipShareText = '';
function openSlip(b, employer, worker) {
  slipShareText = slipText(b, employer, worker);
  const sms = document.getElementById('slipSms');
  if (sms) sms.href = smsLink(worker && worker.phone, slipShareText); // pay slip by SMS for basic phones
  document.getElementById('slipBody').innerHTML = slipHTML(b, employer, worker);
  document.getElementById('slipShare').hidden = false;
  document.getElementById('slipModal').classList.add('open');
}

function shareSlip() {
  shareOnWhatsApp(slipShareText);
}

function printSlip() {
  window.print();
}

// ---------- Wage record: a statement of confirmed payments ----------
function periodTotals(slips) {
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7)); // Monday
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const sum = (from) => slips.filter((b) => Date.parse(b.worker_confirmed_at) >= from).reduce((s, b) => s + amountOf(b), 0);
  return { week: sum(weekStart.getTime()), month: sum(monthStart.getTime()), all: sum(0) };
}

function statementHTML(worker, slips) {
  const rows = slips.map((b) => `
    <tr><td>${fmtDateTime(b.worker_confirmed_at)}</td><td>${esc(b.receipt_no)}</td>
    <td>${t(b.type)}</td><td>${esc(b.employer_name || '')}</td><td class="num">₹${amountOf(b)}</td></tr>`).join('');
  const total = slips.reduce((s, b) => s + amountOf(b), 0);
  return `
    <div class="slip" id="slipPrint">
      <div class="slip-head"><b>🤝 Worker Buddy</b><span>${t('statementTitle')}</span></div>
      <p><b>${esc(worker.name)}</b> · ${esc(worker.phone)} · ${t(worker.skill)}</p>
      <p class="muted small">${t('printedOn')}: ${fmtDateTime(new Date().toISOString())}</p>
      <table class="statement">
        <thead><tr><th>${t('paidOn')}</th><th>${t('receiptNo')}</th><th>${t('work')}</th><th>${t('employer')}</th><th class="num">₹</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="5">${t('noSlips')}</td></tr>`}</tbody>
        <tfoot><tr><td colspan="4"><b>${t('totalPaid')}</b></td><td class="num"><b>₹${total}</b></td></tr></tfoot>
      </table>
      <p class="muted small">${t('statementNote')}</p>
    </div>`;
}

function openStatement(worker, slips) {
  document.getElementById('slipBody').innerHTML = statementHTML(worker, slips);
  document.getElementById('slipShare').hidden = true;
  document.getElementById('slipModal').classList.add('open');
}

function downloadCSV(worker, slips) {
  const head = ['Receipt', 'Confirmed on', 'Work', 'Area', 'Employer', 'Hours agreed', 'Overtime hours', 'Amount (INR)'];
  const cell = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const lines = [head.map(cell).join(',')].concat(slips.map((b) => [
    b.receipt_no, b.worker_confirmed_at, T.en[b.type], b.area, b.employer_name || '', b.hours, b.overtime_hours || 0, amountOf(b)
  ].map(cell).join(',')));
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `wage-statement-${worker.name.replace(/\W+/g, '-')}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- Works offline ----------
// 1) A service worker keeps the app's files, so it opens without internet.
// 2) Actions done offline are saved and sent when the internet is back.
function registerOffline() {
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    const hadOld = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register(new URL('../sw.js', location.href), { scope: new URL('../', location.href).pathname, updateViaCache: 'none' })
      .then((reg) => reg.update())
      .catch(() => { /* offline support is a bonus; the app still works online */ });
    // A new version took over: reload once so every screen uses it (not the old saved copy)
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadOld && !sessionStorage.getItem('wb_reloaded')) {
        sessionStorage.setItem('wb_reloaded', '1');
        location.reload();
      }
    });
  }
  window.addEventListener('online', () => { renderOfflineBanner(); flushQueue(); });
  window.addEventListener('offline', renderOfflineBanner);
  renderOfflineBanner();

  let installEvent = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installEvent = e;
    const btn = document.getElementById('installBtn');
    if (btn) {
      btn.hidden = false;
      btn.onclick = async () => { btn.hidden = true; installEvent.prompt(); };
    }
  });
}

function queue() { return Store.get('queue', []) || []; }

function renderOfflineBanner() {
  const el = document.getElementById('offlineBanner');
  if (!el) return;
  const waiting = queue().length;
  if (!navigator.onLine) {
    el.hidden = false;
    el.textContent = `📴 ${t('offlineBanner')}${waiting ? ' · ' + tf('queued', waiting) : ''}`;
  } else if (waiting) {
    el.hidden = false;
    el.textContent = `🔄 ${t('backOnline')}`;
  } else {
    el.hidden = true;
  }
}

function isNetworkError(error) {
  return !navigator.onLine || /fetch|network|Failed to/i.test(String(error && (error.message || error)));
}

// Call a booking function; when offline, save it to send later.
async function callAction(name, params) {
  if (!navigator.onLine) return saveForLater(name, params);
  try {
    const { data, error } = await db.rpc(name, params);
    if (error) {
      if (isNetworkError(error)) return saveForLater(name, params);
      return { error };
    }
    return { data };
  } catch (e) {
    if (isNetworkError(e)) return saveForLater(name, params);
    return { error: e };
  }
}

function saveForLater(name, params) {
  const q = queue();
  q.push({ name, params, at: new Date().toISOString() });
  Store.set('queue', q);
  showToast(t('savedOffline'));
  renderOfflineBanner();
  return { queued: true };
}

let flushing = false;
async function flushQueue() {
  if (flushing || !navigator.onLine) return;
  const q = queue();
  if (!q.length) return;
  flushing = true;
  let failed = 0;
  for (const item of q) {
    try {
      const { data, error } = await db.rpc(item.name, item.params);
      if (error && isNetworkError(error)) break;
      if (error || data === false || data === null) failed += 1;
    } catch (e) {
      if (isNetworkError(e)) break;
      failed += 1;
    }
    Store.set('queue', queue().slice(1));
  }
  flushing = false;
  renderOfflineBanner();
  showToast(failed ? tf('syncFailed', failed) : t('synced'));
  if (App.onSynced) App.onSynced();
}

// ---------- Real nearby water, shade, tea shops and toilets (OpenStreetMap) ----------
let PLACES = REST_POINTS.slice();
let HOST_POINTS = Store.get('hostPoints', []); // shops that host workers (more.js)
let placesSource = 'saved';
let placesLoading = false;

function currentPlaces() { return HOST_POINTS.concat(PLACES); }

function kindOf(tags) {
  if (tags.amenity === 'drinking_water') return 'water';
  if (tags.amenity === 'shelter') return 'shade';
  if (tags.amenity === 'toilets') return 'toilet';
  return 'tea';
}

// ---------- Shared places cache ----------
// Places near a ~1 km map cell are shared by everyone through the database for 7 days.
// Only when no one has looked up this area recently do we ask the free Overpass servers
// (two servers are asked at once; the first answer wins). Returns a list, or null if nothing worked.
const OVERPASS_SERVERS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
const CACHE_DAYS = 7;
async function placesFromCache(kind, at, query, toPlace, waitMs) {
  const cell = `${kind}:${at.lat.toFixed(2)},${at.lng.toFixed(2)}`;
  let stale = null;
  try {
    const { data } = await db.from('places_cache').select('list,updated_at').eq('cell', cell).maybeSingle();
    if (data) {
      if (Date.now() - Date.parse(data.updated_at) < CACHE_DAYS * 86400000) return data.list;
      stale = data.list;
    }
  } catch (e) { /* no cache: ask Overpass */ }
  // Ask both servers at once; the first good answer wins and the other request is stopped
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), waitMs);
  try {
    const json = await Promise.any(OVERPASS_SERVERS.map((server) => fetch(server, {
      method: 'POST', body: 'data=' + encodeURIComponent(query),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: stop.signal
    }).then((res) => (res.ok ? res.json() : Promise.reject(new Error('busy'))))));
    stop.abort();
    const list = (json.elements || []).map((e) => {
      const p = e.lat != null ? { lat: e.lat, lng: e.lon } : (e.center ? { lat: e.center.lat, lng: e.center.lon } : null);
      return p && toPlace(e.tags || {}, p);
    }).filter(Boolean).slice(0, 100);
    if (list.length) db.from('places_cache').upsert({ cell, list }).then(() => {});
    return list;
  } catch (e) {
    /* both busy or too slow: fall back to an older saved answer */
  } finally {
    clearTimeout(timer);
  }
  return stale;
}

async function loadPlaces() {
  const cached = Store.get('places', null);
  if (cached && cached.list && kmBetween(cached.at, App.here) < 0.5) {
    PLACES = cached.list;          // already looked up for this spot: no need to ask again
    placesSource = 'live';
    renderPlacesNote();
    if (typeof refreshPlacesOnMap === 'function') refreshPlacesOnMap();
    renderRestList();
    return;
  }
  if (navigator.onLine && !placesLoading) placesLoading = true; else return renderPlacesNote();
  renderPlacesNote(); // saved places show at once; real ones replace them when they arrive
  const { lat, lng } = App.here;
  // nwr = points and buildings; "out center" gives every result one map position
  const q = `[out:json][timeout:25];(` +
    `nwr(around:1500,${lat},${lng})[amenity~"^(drinking_water|shelter|toilets|cafe|fast_food|restaurant)$"];` +
    `nwr(around:1500,${lat},${lng})[shop~"^(convenience|beverages|kiosk|supermarket|bakery)$"];);out center 80;`;
  const list = await placesFromCache('rest', { lat, lng }, q, (tags, p) => {
    const kind = kindOf(tags);
    return { kind, name: tags.name || tags['name:en'] || t(kind), ...p };
  }, 30000); // the free servers can be slow at busy times
  if (list && list.length) {
    PLACES = list;
    placesSource = 'live';
    Store.set('places', { at: { lat, lng }, list });
  } // otherwise keep the saved places
  placesLoading = false;
  renderPlacesNote();
  if (typeof refreshPlacesOnMap === 'function') refreshPlacesOnMap();
  renderRestList();
}

function renderPlacesNote() {
  const el = document.getElementById('placesNote');
  if (!el) return;
  if (placesSource === 'live') el.textContent = tf('placesLive', PLACES.length);
  else el.textContent = placesLoading ? t('loadingPlaces') : t('placesSaved');
}

// ---------- Text for these features (English + Tamil; Hindi is in lang-hi.js) ----------
Object.assign(T.en, {
  langLabel: 'Language',
  you: 'You',
  quickMessages: 'Quick messages',
  msgHint: 'Tap to send. They see it in their own language.',
  ph_onMyWay: 'I am on my way', ph_reached: 'I have reached', ph_waterBreak: 'Taking a 10-minute water break',
  ph_needTools: 'I need tools or materials', ph_lateTen: 'I will be 10 minutes late', ph_workDone: 'The work is done',
  ph_comeIn: 'Please come in', ph_showWork: 'Let me show you the work', ph_drinkWater: 'Take a break and drink water',
  ph_payingNow: 'I am paying now', ph_goodWork: 'Good work, thank you', ph_callMe: 'Please call me',
  overtimeLive: (h) => `Past the agreed hours: +₹80 for each extra hour (${h} so far)`,
  overtimeLabel: 'Overtime',
  employerSaysPaid: (w) => `The employer says ₹${w} was paid. Did you receive it?`,
  yesReceived: '✅ Yes, I received it',
  notReceived: '❌ Not received',
  disputedNote: 'You reported this payment as not received. The employer’s Fair Pay Score went down. Tap Yes if you get it later.',
  waitingWorkerConfirm: 'Paid. Waiting for the worker to confirm they received it.',
  workerDisputed: 'The worker says the money has not reached them. Please check and pay again.',
  paySlip: 'Pay slip',
  viewSlip: '🧾 View pay slip',
  slipConfirmed: 'Payment confirmed by both employer and worker',
  receiptNo: 'Receipt no.',
  paidOn: 'Paid on',
  confirmedOn: 'Confirmed by worker',
  workedTime: 'Time worked',
  totalPaid: 'Total paid',
  savePdf: '⬇️ Save as PDF',
  shareSlip: 'Share on WhatsApp',
  statusDisputed: 'Not received',
  awaitingConfirm: 'Awaiting worker confirmation',
  navEarnings: 'Earnings',
  earningsTitle: 'My wage record',
  thisWeek: 'This week', thisMonth: 'This month', allTime: 'All time',
  confirmedPayments: 'Confirmed payments', disputedPayments: 'Not received',
  downloadStatement: '⬇️ Wage statement (PDF)',
  downloadCsv: '⬇️ Spreadsheet (CSV)',
  statementTitle: 'Wage statement',
  statementNote: 'Every payment here was confirmed by both the employer and the worker in Worker Buddy.',
  noSlips: 'No confirmed payments yet.',
  printedOn: 'Generated on',
  offlineBanner: 'Offline. Your pay slips, wage record and saved places still work. Actions will be sent when the internet is back.',
  queued: (n) => `${n} action${n === 1 ? '' : 's'} waiting to send`,
  savedOffline: 'Saved. It will be sent when the internet is back.',
  backOnline: 'Back online. Sending saved actions…',
  synced: 'All saved actions sent ✅',
  syncFailed: (n) => `${n} saved action${n === 1 ? '' : 's'} could not be completed. Please check and try again.`,
  installApp: '📲 Install app',
  placesLive: (n) => `${n} places near you, from OpenStreetMap`,
  placesSaved: 'Showing saved places (offline, or none found nearby).',
  nearbyBtn: '🚰 Water, shade and tea nearby',
  loadingPlaces: 'Finding real places near you from OpenStreetMap… (showing saved places for now)',
  listenJob: '🔊 Listen'
});

Object.assign(T.ta, {
  langLabel: 'மொழி',
  you: 'நீங்கள்',
  quickMessages: 'விரைவு செய்திகள்',
  msgHint: 'அனுப்ப தட்டவும். அவர்கள் தங்கள் மொழியில் பார்ப்பார்கள்.',
  ph_onMyWay: 'நான் வந்துகொண்டிருக்கிறேன்', ph_reached: 'நான் வந்துவிட்டேன்', ph_waterBreak: '10 நிமிடம் தண்ணீர் இடைவேளை எடுக்கிறேன்',
  ph_needTools: 'எனக்கு கருவிகள் அல்லது பொருட்கள் வேண்டும்', ph_lateTen: '10 நிமிடம் தாமதமாகும்', ph_workDone: 'வேலை முடிந்தது',
  ph_comeIn: 'உள்ளே வாருங்கள்', ph_showWork: 'வேலையைக் காட்டுகிறேன்', ph_drinkWater: 'ஓய்வு எடுத்து தண்ணீர் குடியுங்கள்',
  ph_payingNow: 'இப்போது கூலி கொடுக்கிறேன்', ph_goodWork: 'நல்ல வேலை, நன்றி', ph_callMe: 'என்னை அழையுங்கள்',
  overtimeLive: (h) => `ஒப்புக்கொண்ட நேரத்தைத் தாண்டியது: ஒவ்வொரு கூடுதல் மணிக்கும் +₹80 (இதுவரை ${h})`,
  overtimeLabel: 'கூடுதல் நேரம்',
  employerSaysPaid: (w) => `₹${w} கொடுத்ததாக முதலாளி சொல்கிறார். உங்களுக்கு கிடைத்ததா?`,
  yesReceived: '✅ ஆம், கிடைத்தது',
  notReceived: '❌ கிடைக்கவில்லை',
  disputedNote: 'இந்த கூலி கிடைக்கவில்லை என்று சொன்னீர்கள். முதலாளியின் நியாய ஊதிய மதிப்பெண் குறைந்தது. பின்னர் கிடைத்தால் ஆம் தட்டவும்.',
  waitingWorkerConfirm: 'கொடுக்கப்பட்டது. வேலையாள் பெற்றதை உறுதிசெய்ய காத்திருக்கிறது.',
  workerDisputed: 'பணம் வரவில்லை என்று வேலையாள் சொல்கிறார். சரிபார்த்து மீண்டும் கொடுக்கவும்.',
  paySlip: 'கூலி ரசீது',
  viewSlip: '🧾 கூலி ரசீது பார்',
  slipConfirmed: 'முதலாளி மற்றும் வேலையாள் இருவரும் உறுதிசெய்த கூலி',
  receiptNo: 'ரசீது எண்',
  paidOn: 'கொடுத்த நேரம்',
  confirmedOn: 'வேலையாள் உறுதிசெய்தது',
  workedTime: 'வேலை செய்த நேரம்',
  totalPaid: 'மொத்த கூலி',
  savePdf: '⬇️ PDF ஆக சேமி',
  shareSlip: 'வாட்ஸ்அப்பில் பகிர்',
  statusDisputed: 'கிடைக்கவில்லை',
  awaitingConfirm: 'வேலையாள் உறுதிக்காக காத்திருக்கிறது',
  navEarnings: 'வருமானம்',
  earningsTitle: 'என் கூலி பதிவு',
  thisWeek: 'இந்த வாரம்', thisMonth: 'இந்த மாதம்', allTime: 'மொத்தம்',
  confirmedPayments: 'உறுதிசெய்த கூலிகள்', disputedPayments: 'கிடைக்காதவை',
  downloadStatement: '⬇️ கூலி அறிக்கை (PDF)',
  downloadCsv: '⬇️ அட்டவணை (CSV)',
  statementTitle: 'கூலி அறிக்கை',
  statementNote: 'இங்குள்ள ஒவ்வொரு கூலியும் Worker Buddy-ல் முதலாளி மற்றும் வேலையாள் இருவராலும் உறுதிசெய்யப்பட்டது.',
  noSlips: 'இன்னும் உறுதிசெய்த கூலி இல்லை.',
  printedOn: 'உருவாக்கிய நேரம்',
  offlineBanner: 'இணையம் இல்லை. உங்கள் கூலி ரசீதுகள், கூலி பதிவு, சேமித்த இடங்கள் வேலை செய்யும். இணையம் வந்ததும் செயல்கள் அனுப்பப்படும்.',
  queued: (n) => `${n} செயல்கள் அனுப்ப காத்திருக்கின்றன`,
  savedOffline: 'சேமிக்கப்பட்டது. இணையம் வந்ததும் அனுப்பப்படும்.',
  backOnline: 'இணையம் வந்தது. சேமித்த செயல்கள் அனுப்பப்படுகின்றன…',
  synced: 'சேமித்த அனைத்தும் அனுப்பப்பட்டன ✅',
  syncFailed: (n) => `${n} சேமித்த செயல்கள் முடியவில்லை. சரிபார்த்து மீண்டும் முயற்சிக்கவும்.`,
  installApp: '📲 ஆப்பை நிறுவு',
  placesLive: (n) => `அருகில் ${n} இடங்கள், OpenStreetMap-இலிருந்து`,
  placesSaved: 'சேமித்த இடங்கள் காட்டப்படுகின்றன (இணையம் இல்லை, அல்லது அருகில் இல்லை).',
  nearbyBtn: '🚰 அருகில் தண்ணீர், நிழல், டீ',
  loadingPlaces: 'OpenStreetMap-இலிருந்து அருகிலுள்ள இடங்களைத் தேடுகிறது… (இப்போது சேமித்த இடங்கள்)',
  listenJob: '🔊 கேளுங்கள்'
});
