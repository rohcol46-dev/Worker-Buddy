// live.js — shared by both apps: database connection, booking helpers, extra text, popups
// Owner: Member 4 (lead)

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// Private accounts: each phone signs in once (Supabase anonymous sign-in, no password or SMS).
// The database then lets this phone change only its own profiles and jobs.
async function ensureSignedIn() {
  try {
    const { data } = await db.auth.getSession();
    if (data.session && navigator.onLine) {
      // The saved sign-in may point to an account that no longer exists: start a fresh one
      const { error } = await db.auth.getUser();
      if (error && (error.status === 401 || error.status === 403)) {
        await db.auth.signOut({ scope: 'local' });
        data.session = null;
      }
    }
    if (!data.session) {
      if (!navigator.onLine) return false;
      const { error } = await db.auth.signInAnonymously();
      if (error) return false;
    }
    // Profiles made before accounts existed: this phone claims them once, using its old id
    const key = 'claimed_' + deviceId();
    if (!Store.get(key, false) && navigator.onLine) {
      const { error } = await db.rpc('claim_profiles', { p_device: deviceId() });
      if (!error) Store.set(key, true);
    }
    sendConsent();
    return true;
  } catch (e) {
    return false;
  }
}

// Each phone gets its own id: it picks which profile on this phone is "me" (shared phone mode)
function deviceId() {
  let id = Store.get('device', null);
  if (!id) {
    id = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
    Store.set('device', id);
  }
  return id;
}

const OPEN_STATUSES = ['assigned', 'started', 'completed'];
const STEPS = ['assigned', 'started', 'completed', 'paid'];
const SEARCH_SECONDS = 600;  // a posted job stays open 10 minutes: long enough to share on WhatsApp
const ACCEPT_SECONDS = 30;   // how long a worker has to accept

// ---------- Scores ----------
// Fair Pay Score 0–100: half from workers' star ratings, half from paying on time. null = new employer.
function fairPayScore(e) {
  if (!e || (!e.jobs && !e.rating_count)) return null;
  const ratingPart = e.rating_count ? e.rating_sum / e.rating_count / 5 : 0.8;
  const onTimePart = e.jobs ? e.paid_on_time / e.jobs : 0.8;
  return Math.round((ratingPart * 0.5 + onTimePart * 0.5) * 100);
}

function scoreBadge(e) {
  const s = fairPayScore(e);
  if (s === null) return `<span class="score score-ok">${t('newEmployer')}</span>`;
  const cls = s >= 80 ? 'score-good' : s >= 60 ? 'score-ok' : 'score-bad';
  return `<span class="score ${cls}">${t('fairPay')} ${s}/100</span>`;
}

function workerStars(w) {
  if (!w || !w.rating_count) return t('newWorker');
  return `<span class="stars-small">★</span> ${(w.rating_sum / w.rating_count).toFixed(1)}`;
}

function kmBetween(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return null;
  return distanceKm({ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng });
}

// ---------- People (supabase/016_private_data_and_fair_pay.sql) ----------
// Other people's profiles come from workers_public / employers_public: no phone number, and the
// location rounded to about 1 km. The phone, UPI ID and live location of the person on my own job
// come from job_contacts.
async function myProfile(kind) {
  const { data, error } = await db.rpc(kind === 'worker' ? 'get_my_worker' : 'get_my_employer', { p_device: deviceId() });
  if (error) throw error;
  const me = (data || [])[0] || null;
  if (me && me.device_id) Store.set('device', me.device_id);
  return me;
}

// The workers (or employers) on these jobs, by id, with their contact details added.
// If a lookup fails (bad network), the last details we had are kept so the call and pay buttons stay.
const KNOWN_PEOPLE = {};
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function peopleOn(kind, bookings) {
  const key = kind === 'worker' ? 'worker_id' : 'employer_id';
  const jobs = (bookings || []).filter((b) => b && b[key]);
  const ids = [...new Set(jobs.map((b) => b[key]))];
  if (!ids.length) return {};
  const synced = jobs.map((b) => b.id).filter((id) => UUID_RE.test(id)); // queued jobs have a local id
  const [rowsRes, contactsRes] = await Promise.all([
    db.from(kind === 'worker' ? 'workers_public' : 'employers_public').select('*').in('id', ids),
    synced.length ? db.rpc('job_contacts', { p_bookings: synced }) : Promise.resolve({ data: [] })
  ]);
  const people = {};
  ids.forEach((id) => {
    const known = KNOWN_PEOPLE[id];
    const row = (rowsRes.data || []).find((p) => p.id === id);
    if (row) people[id] = contactsRes.error && known ? { ...known, ...row, phone: known.phone, upi_id: known.upi_id, lat: known.lat, lng: known.lng } : row;
    else if (rowsRes.error && known) people[id] = { ...known };
  });
  (contactsRes.data || []).forEach((c) => {
    const p = people[c.person_id];
    if (!p) return;
    if (c.phone) p.phone = c.phone;
    if (c.upi_id) p.upi_id = c.upi_id;
    if (c.lat != null) { p.lat = c.lat; p.lng = c.lng; }
  });
  Object.values(people).forEach((p) => { KNOWN_PEOPLE[p.id] = p; });
  return people;
}

// The exact job site and full address. Open jobs show only the area, to about 1 km; the employer,
// and the worker once the job is theirs, get the exact one (job_sites). Kept on the phone for offline use.
const Sites = Store.get('sites', {}) || {};
const SitesAsked = new Set();
function withSite(b) {
  if (!b || !b.id) return b;
  const s = Sites[b.id];
  if (s) return { ...b, lat: s.lat, lng: s.lng, area: s.address || b.area };
  const key = `${b.id}:${b.worker_id || ''}`; // ask again once a worker has the job
  if (UUID_RE.test(b.id) && navigator.onLine && !SitesAsked.has(key)) {
    SitesAsked.add(key);
    db.rpc('job_sites', { p_bookings: [b.id] }).then(({ data, error }) => {
      if (error) return SitesAsked.delete(key);
      if (!data || !data.length) return;
      data.forEach((r) => { Sites[r.booking_id] = { lat: r.lat, lng: r.lng, address: r.address }; });
      const keep = Object.keys(Sites).slice(-50);
      Store.set('sites', Object.fromEntries(keep.map((k) => [k, Sites[k]])));
      if (App.onSite) App.onSite();
    }, () => SitesAsked.delete(key));
  }
  return b;
}

// Overtime per hour: twice the agreed wage per hour (Code on Wages, 2019). The database sets it on every job;
// a finished job saved on the phone before that was paid at the old flat ₹80.
function otRate(b) {
  if (b.ot_rate) return b.ot_rate;
  if (b.completed_at) return 80;
  return Math.ceil((b.agreed_wage * 2) / Math.max(b.hours || 8, 4));
}

// The text worker and employer share on WhatsApp as their work agreement
function agreementText(b, employerName, workerName) {
  return [
    `📄 ${t('agreementTitle')} WB-${b.id.slice(0, 6).toUpperCase()}`,
    `${t('work')}: ${t(b.type)}, ${b.area}`,
    `${t('hours')}: ${b.hours} ${t('hoursUnit')}`,
    `${t('agreedWage')}: ₹${b.agreed_wage}`,
    `${t('employer')}: ${employerName}`,
    `${t('worker')}: ${workerName}`,
    t('agreementNote')
  ].join('\n');
}

function shareOnWhatsApp(text) {
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
}

// Progress dots: Assigned → Started → Completed → Paid
function stepperHTML(status) {
  const at = STEPS.indexOf(status);
  return `<ol class="stepper">${STEPS.map((s, i) => `
    <li class="${i < at ? 'done' : i === at ? 'now' : ''}"><span></span>${t('step' + s[0].toUpperCase() + s.slice(1))}</li>`).join('')}</ol>`;
}

function statusLabel(status) {
  return t('status' + status[0].toUpperCase() + status.slice(1));
}

function timeAgo(iso) {
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (mins < 1) return t('justNowShort');
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  return h < 24 ? `${h} h` : new Date(iso).toLocaleDateString(App.lang === 'ta' ? 'ta-IN' : 'en-IN', { day: 'numeric', month: 'short' });
}

function clock(secs) {
  const s = Math.max(0, Math.floor(secs));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const two = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${two(m)}:${two(r)}` : `${m}:${two(r)}`;
}

// t() for text that needs values: tf('onlineNearby', 3, 'electricians')
function tf(key, ...args) {
  const value = (T[App.lang] && T[App.lang][key]) || T.en[key];
  return typeof value === 'function' ? value(...args) : (value || key);
}

// ---------- Small UI helpers ----------
let toastTimer = null;
function showToast(message) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}

function applyLang() {
  document.documentElement.lang = App.lang;
  document.querySelectorAll('[data-t]').forEach((el) => { el.textContent = t(el.dataset.t); });
  document.querySelectorAll('[data-t-ph]').forEach((el) => { el.placeholder = t(el.dataset.tPh); });
  const sel = document.getElementById('langSelect');
  if (sel) sel.value = App.lang;
  if (typeof renderAccount === 'function' && typeof Acc !== 'undefined' && Acc.haveProfile) renderAccount();
}

function show(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
  document.querySelectorAll('.bottom-nav button').forEach((b) => b.classList.toggle('active', b.dataset.go === id));
  if (id === 'safety') initMap();
  if (App.onShow) App.onShow(id);
}

function fillSelect(el, current) {
  el.innerHTML = Object.keys(WORK_TYPES)
    .map((k) => `<option value="${k}">${WORK_TYPES[k].icon} ${t(k)}</option>`).join('');
  el.value = current || 'coolie';
}

// Star rating popup with optional review tags:
// openStars('How was this employer?', (stars, tags) => …, REVIEW_TAGS.employer)
let starsDone = null;
let starsValue = 0;
let starsTagKeys = [];
let starsTags = new Set();
function openStars(title, onDone, tagKeys) {
  starsDone = onDone;
  starsValue = 0;
  starsTagKeys = tagKeys || [];
  starsTags = new Set();
  document.getElementById('rateTitle').textContent = title;
  drawStars();
  document.getElementById('rateModal').classList.add('open');
}
function drawStars() {
  document.getElementById('stars').innerHTML = [1, 2, 3, 4, 5].map((n) =>
    `<button class="star ${n <= starsValue ? 'on' : ''}" onclick="pickStar(${n})" aria-label="${n}">★</button>`).join('');
  const box = document.getElementById('rateTags');
  if (!box) return;
  box.innerHTML = starsTagKeys.length ? `<p class="muted small">${t('reviewHint')}</p><div class="chips wrap">${starsTagKeys.map((k) =>
    `<button type="button" class="chip ${starsTags.has(k) ? 'active' : ''}" onclick="toggleStarTag('${k}')">${TAG_ICONS[k] || ''} ${t('tag_' + k)}</button>`).join('')}</div>` : '';
}
function pickStar(n) {
  starsValue = n;
  drawStars();
}
function toggleStarTag(k) {
  if (starsTags.has(k)) starsTags.delete(k); else starsTags.add(k);
  drawStars();
}
async function submitStars() {
  if (!starsValue) return showToast(t('pickStars'));
  closeModal('rateModal');
  if (starsDone) await starsDone(starsValue, [...starsTags]);
  showToast(t('thanksRating'));
}

// A short beep + vibration for a new job request (works after the first tap on the page)
let audioCtx = null;
function unlockSound() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch (e) { /* no sound on this phone */ }
}
function ring() {
  try {
    const tapped = !navigator.userActivation || navigator.userActivation.hasBeenActive;
    if (navigator.vibrate && tapped) navigator.vibrate([300, 150, 300]);
    if (!audioCtx) return;
    [0, 0.35].forEach((delay) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.2, audioCtx.currentTime + delay);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + delay + 0.3);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(audioCtx.currentTime + delay);
      osc.stop(audioCtx.currentTime + delay + 0.3);
    });
  } catch (e) { /* ignore */ }
}

// A Leaflet map for the top of each app's home screen
function heroMap(id) {
  const el = document.getElementById(id);
  if (typeof L === 'undefined' || !el) return null;
  if (el.wbMap) return el.wbMap.setView([App.here.lat, App.here.lng], 14); // already made (e.g. right after sign-up)
  const m = L.map(el, { zoomControl: false, attributionControl: true }).setView([App.here.lat, App.here.lng], 14);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(m);
  el.wbMap = m;
  return m;
}
function pin(html, cls) {
  return L.divIcon({ className: 'map-pin ' + (cls || ''), html, iconSize: [34, 34] });
}

function locate(done) {
  if (!navigator.geolocation) return done && done(false);
  navigator.geolocation.getCurrentPosition((pos) => {
    App.here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    if (done) done(true);
  }, () => done && done(false), { timeout: 8000, maximumAge: 60000 });
}

// ---------- Extra text for the live apps (English + Tamil) ----------
Object.assign(T.en, {
  onboardWorkerTitle: 'Join as a worker',
  onboardEmployerTitle: 'Set up your account',
  onboardHint: 'Your name and number are shown only to the person you work with.',
  continueBtn: 'Continue',
  hello: (n) => `Hi ${n}`,
  goOnline: 'Go online',
  goOffline: 'Go offline',
  onlineWaiting: "You're online. Waiting for jobs near you…",
  offlineHint: 'Go online to get job requests.',
  todayEarnings: "Today's earnings",
  jobsDone: 'Jobs done',
  newRequest: 'New job request',
  decline: 'Decline',
  acceptJob: 'Accept',
  takenByOther: 'Another worker took this job.',
  requestGone: 'This request is no longer available.',
  stepAssigned: 'Assigned', stepStarted: 'Started', stepCompleted: 'Completed', stepPaid: 'Paid',
  enterOtp: 'Ask the employer for the 4-digit OTP',
  startWork: 'Start work',
  wrongOtp: 'Wrong OTP. Try again.',
  workInProgress: 'Work in progress',
  completeJob: 'Complete job',
  waitingPayment: (w) => `Waiting for payment of ₹${w}`,
  paymentReceived: (w) => `₹${w} received`,
  backHome: 'Back to home',
  call: 'Call',
  whatsapp: 'WhatsApp',
  navHome: 'Home', navHistory: 'History', navBook: 'Book', navBookings: 'Bookings',
  historyTitle: 'Your jobs',
  noHistory: 'No jobs yet.',
  bookTitle: 'What work do you need?',
  onlineNearby: (n, name) => `${name}: ${n} online nearby`,
  noneOnline: (name) => `${name}: none online right now. You can still book; workers who come online will see it.`,
  whereWork: 'Where is the work?',
  bookNow: (w) => `Book worker · ₹${w}`,
  agreedPay: 'Pay you agree to',
  searchingFor: (name) => `Finding ${/^[aeiou]/i.test(name) ? 'an' : 'a'} ${name.toLowerCase()} near you…`,
  requestSentTo: (n) => `Request sent to ${n} online worker${n === 1 ? '' : 's'}`,
  cancelBooking: 'Cancel booking',
  noWorkerFound: 'No worker accepted in time. Try again or change the work.',
  tryAgain: 'Try again',
  workerOnTheWay: (n) => `${n} accepted and is on the way`,
  shareOtp: 'Share this OTP when the worker arrives',
  payNow: (w) => `Pay ₹${w} and finish`,
  paidThanks: 'Paid. Thank you for paying on time!',
  bookAgain: 'Book another worker',
  yourFairPay: 'Your Fair Pay Score',
  bookingsTitle: 'Your bookings',
  statusSearching: 'Searching', statusAssigned: 'Assigned', statusStarted: 'In progress', statusCompleted: 'Completed',
  statusPaid: 'Paid', statusCancelled: 'Cancelled', statusExpired: 'No worker',
  saveError: 'Could not save. Check your internet and try again.',
  justNowShort: 'just now',
  jobsCount: (n) => `${n} job${n === 1 ? '' : 's'}`,
  timeWorked: 'Time worked',
  ago: 'ago',
  workDetails: 'Work details',
  rateEmployerShort: 'Rate employer',
  rateWorkerShort: 'Rate worker',
  shareAgreement: '📄 Share agreement',
  myLocation: '📍 Use my location',
  minus: 'Fewer hours', plus: 'More hours',
  workersOnline: 'workers online'
});

Object.assign(T.ta, {
  onboardWorkerTitle: 'வேலையாளாக சேருங்கள்',
  onboardEmployerTitle: 'உங்கள் கணக்கை அமைக்கவும்',
  onboardHint: 'உங்கள் பெயர் மற்றும் எண் உங்களுடன் வேலை செய்பவருக்கு மட்டுமே காட்டப்படும்.',
  continueBtn: 'தொடரவும்',
  hello: (n) => `வணக்கம் ${n}`,
  goOnline: 'ஆன்லைனில் செல்',
  goOffline: 'ஆஃப்லைனில் செல்',
  onlineWaiting: 'நீங்கள் ஆன்லைனில் உள்ளீர்கள். அருகிலுள்ள வேலைக்காக காத்திருக்கிறது…',
  offlineHint: 'வேலை கோரிக்கைகளைப் பெற ஆன்லைனில் செல்லவும்.',
  todayEarnings: 'இன்றைய வருமானம்',
  jobsDone: 'முடிந்த வேலைகள்',
  newRequest: 'புதிய வேலை கோரிக்கை',
  decline: 'வேண்டாம்',
  acceptJob: 'ஏற்கிறேன்',
  takenByOther: 'இந்த வேலையை வேறொருவர் எடுத்துவிட்டார்.',
  requestGone: 'இந்த கோரிக்கை இப்போது இல்லை.',
  stepAssigned: 'ஒதுக்கப்பட்டது', stepStarted: 'தொடங்கியது', stepCompleted: 'முடிந்தது', stepPaid: 'கூலி பெற்றது',
  enterOtp: 'முதலாளியிடம் 4 இலக்க OTP கேளுங்கள்',
  startWork: 'வேலையைத் தொடங்கு',
  wrongOtp: 'தவறான OTP. மீண்டும் முயற்சிக்கவும்.',
  workInProgress: 'வேலை நடக்கிறது',
  completeJob: 'வேலை முடிந்தது',
  waitingPayment: (w) => `₹${w} கூலிக்காக காத்திருக்கிறது`,
  paymentReceived: (w) => `₹${w} பெறப்பட்டது`,
  backHome: 'முகப்புக்குத் திரும்பு',
  call: 'அழை',
  whatsapp: 'வாட்ஸ்அப்',
  navHome: 'முகப்பு', navHistory: 'வரலாறு', navBook: 'புக்', navBookings: 'புக்கிங்ஸ்',
  historyTitle: 'உங்கள் வேலைகள்',
  noHistory: 'இன்னும் வேலைகள் இல்லை.',
  bookTitle: 'உங்களுக்கு என்ன வேலை வேண்டும்?',
  onlineNearby: (n, name) => `அருகில் ${n} ${name} ஆன்லைனில்`,
  noneOnline: (name) => `இப்போது ${name} யாரும் ஆன்லைனில் இல்லை. நீங்கள் புக் செய்யலாம்; ஆன்லைனுக்கு வருபவர்கள் பார்ப்பார்கள்.`,
  whereWork: 'வேலை எங்கே?',
  bookNow: (w) => `வேலையாளை புக் செய் · ₹${w}`,
  agreedPay: 'நீங்கள் ஒப்புக்கொள்ளும் கூலி',
  searchingFor: (name) => `அருகில் ${name} தேடுகிறது…`,
  requestSentTo: (n) => `${n} ஆன்லைன் வேலையாட்களுக்கு கோரிக்கை அனுப்பப்பட்டது`,
  cancelBooking: 'புக்கிங்கை ரத்து செய்',
  noWorkerFound: 'நேரத்தில் யாரும் ஏற்கவில்லை. மீண்டும் முயற்சிக்கவும் அல்லது வேலையை மாற்றவும்.',
  tryAgain: 'மீண்டும் முயற்சி',
  workerOnTheWay: (n) => `${n} ஏற்றுக்கொண்டு வருகிறார்`,
  shareOtp: 'வேலையாள் வந்ததும் இந்த OTP-ஐ சொல்லுங்கள்',
  payNow: (w) => `₹${w} செலுத்தி முடி`,
  paidThanks: 'கூலி கொடுக்கப்பட்டது. நேரத்தில் கொடுத்ததற்கு நன்றி!',
  bookAgain: 'மற்றொரு வேலையாளை புக் செய்',
  yourFairPay: 'உங்கள் நியாய ஊதிய மதிப்பெண்',
  bookingsTitle: 'உங்கள் புக்கிங்ஸ்',
  statusSearching: 'தேடுகிறது', statusAssigned: 'ஒதுக்கப்பட்டது', statusStarted: 'நடக்கிறது', statusCompleted: 'முடிந்தது',
  statusPaid: 'கொடுக்கப்பட்டது', statusCancelled: 'ரத்து', statusExpired: 'யாரும் இல்லை',
  saveError: 'சேமிக்க முடியவில்லை. இணையத்தைச் சரிபார்த்து மீண்டும் முயற்சிக்கவும்.',
  justNowShort: 'இப்போது',
  jobsCount: (n) => `${n} வேலைகள்`,
  timeWorked: 'வேலை செய்த நேரம்',
  ago: 'முன்பு',
  workDetails: 'வேலை விவரம்',
  rateEmployerShort: 'முதலாளியை மதிப்பிடு',
  rateWorkerShort: 'வேலையாளை மதிப்பிடு',
  shareAgreement: '📄 ஒப்பந்தத்தைப் பகிர்',
  myLocation: '📍 என் இருப்பிடம்',
  minus: 'குறைவான மணி', plus: 'கூடுதல் மணி',
  workersOnline: 'வேலையாட்கள் ஆன்லைனில்'
});
