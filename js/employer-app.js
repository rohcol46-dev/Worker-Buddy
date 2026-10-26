// employer-app.js — the employer's app: book a worker, share OTP, pay with proof,
// quick messages in the worker's language, booking history with pay slips,
// plus live tracking, book for later, choose / rebook a worker, tips (see extras.js)
// Owner: Member 2 (Employer & trust)

const E = {
  when: 'now',         // 'now' or 'later'
  team: 1,             // workers needed (Porter-style "add helpers")
  tools: false,        // worker brings own tools (+₹50)
  perks: [],           // meal / water / shade / toilet provided
  crew: [],            // a team booking: one booking per worker
  crewWorkers: {},
  crewChat: null,      // team slot whose messages are open
  crewPay: null,       // { id, tip } for the team slot being paid
  offers: [],          // counter-offers from workers (inDrive-style)
  preferred: null,     // a worker chosen by name (or "book again")
  tip: 0,
  workerMarker: null,  // the assigned worker moving on the map
  trackLine: null,
  me: null,            // this employer's row
  booking: null,       // the booking in progress
  worker: null,        // the worker who accepted it
  workers: [],         // workers online now (for the map and counts)
  markers: {},
  map: null,
  type: 'electrician',
  hours: 8,
  load: 'light',
  risky: false,
  searchTimer: null,
  workTimer: null,
  records: []
};

// ---------- Profile ----------
async function loadMe() {
  E.me = await myProfile('employer');
}

async function saveProfile(event) {
  event.preventDefault();
  const f = event.target;
  const row = { name: f.name.value.trim(), phone: f.phone.value.replace(/\D/g, ''), device_id: deviceId() };
  if (!/^[6-9]\d{9}$/.test(row.phone)) return showToast(t('badPhone'));
  const { error } = await db.from('employers').insert(row);
  if (error) return showToast(t('saveError'));
  await loadMe();
  Store.set('e_me', E.me);
  renderAccount();
  document.body.classList.remove('onboarding');
  startApp();
}

// ---------- Online workers on the map (placed to about 1 km; no phone numbers) ----------
// Only workers within about 50 km, so each employer's phone doesn't download every online worker in India
const NEAR_DEG = 0.45;
async function loadWorkers() {
  const at = E.site || App.here;
  E.workersAt = { lat: at.lat, lng: at.lng };
  const { data } = await db.from('workers_public').select('*').eq('online', true)
    .gte('lat', at.lat - NEAR_DEG).lte('lat', at.lat + NEAR_DEG)
    .gte('lng', at.lng - NEAR_DEG).lte('lng', at.lng + NEAR_DEG)
    .limit(300);
  E.workers = data || [];
  drawWorkers();
}

function drawWorkers() {
  if (E.map) {
    Object.values(E.markers).forEach((m) => m.remove());
    E.markers = {};
    const tracked = E.booking && E.booking.worker_id;
    E.workers.filter((w) => w.lat != null && w.id !== tracked).forEach((w) => {
      E.markers[w.id] = L.marker([w.lat, w.lng], { icon: pin(WORK_TYPES[w.skill].icon, w.skill === E.type ? 'pin-match' : '') })
        .addTo(E.map).bindPopup(`<b>${esc(w.name)}</b><br>${t(w.skill)} · ${workerStars(w)}`);
    });
  }
  document.getElementById('onlineBadge').innerHTML = `<span class="pulse-dot"></span>${E.workers.length} ${t('workersOnline')}`;
  renderOnlineCount();
  renderPickWorker();
}

// ---------- Choose a worker by name (Urban Company) ----------
function renderPickWorker() {
  const box = document.getElementById('pickWorker');
  if (E.team > 1) { box.innerHTML = ''; return; }
  const near = E.workers.filter((w) => w.skill === E.type)
    .map((w) => ({ w, km: kmBetween(App.here, w) }))
    .sort((a, b) => (Fav.ids.includes(b.w.id) - Fav.ids.includes(a.w.id)) || (a.km ?? 99) - (b.km ?? 99)).slice(0, 8);
  const strip = near.map(({ w, km }) => `
    <button type="button" class="worker-pick ${E.preferred && E.preferred.id === w.id ? 'active' : ''}" onclick="openWorkerProfile('${w.id}')">
      <span class="avatar">${esc(w.name.slice(0, 1).toUpperCase())}</span>
      <b>${Fav.ids.includes(w.id) ? '❤️ ' : ''}${esc(w.name)}${isTrusted(w) ? ' <span class="trusted-dot">✔</span>' : ''}</b>
      <small>${workerStars(w)}</small>
      <small>${km !== null ? km.toFixed(1) + ' km' : ''}</small>
    </button>`).join('');
  box.innerHTML = `
    ${near.length ? `<span class="field-label">${t('chooseWorker')}</span><div class="worker-strip">${strip}</div>` : ''}
    ${E.preferred ? `<p class="preferred-note">🎯 ${tf('requestingOnly', esc(E.preferred.name))}
      <button type="button" class="link-btn" onclick="clearPreferred()">${t('sendToAll')}</button></p>` : ''}`;
}

async function openWorkerProfile(id) {
  let w = E.workers.find((x) => x.id === id);
  if (!w) {
    const { data } = await db.from('workers_public').select('*').eq('id', id).maybeSingle();
    w = data;
  }
  if (!w) return;
  document.getElementById('profileBody').innerHTML = workerProfileHTML(w, [], kmBetween(App.here, w));
  const btn = document.getElementById('profilePick');
  btn.textContent = tf('requestThis', w.name);
  btn.onclick = () => { closeModal('profileModal'); setPreferred(w); };
  const fav = document.getElementById('profileFav');
  fav.textContent = Fav.ids.includes(w.id) ? t('favOn') : t('favAdd');
  fav.onclick = () => toggleFavorite(w.id);
  document.getElementById('profileModal').classList.add('open');
  const counts = await reviewsOf('worker', w.id);
  document.getElementById('profileBody').innerHTML = workerProfileHTML(w, counts, kmBetween(App.here, w));
}

function setPreferred(w) {
  E.preferred = w;
  E.team = 1;
  document.getElementById('teamValue').textContent = 1;
  if (w.skill !== E.type) pickType(w.skill);
  renderPickWorker();
  renderEstimate();
}

function clearPreferred() {
  E.preferred = null;
  renderPickWorker();
  renderEstimate();
}

// ---------- Now or later (Urban Company) ----------
function pickWhen(when) {
  E.when = when;
  document.querySelectorAll('#whenSeg button').forEach((b) => b.classList.toggle('active', b.dataset.when === when));
  const input = document.getElementById('laterInput');
  input.hidden = when !== 'later';
  document.getElementById('repeatRow').hidden = when !== 'later';
  document.getElementById('freeOnDay').textContent = '';
  if (when === 'later') {
    input.min = toLocalInput(new Date(Date.now() + LATER_MIN_MINUTES * 60000));
    if (!input.value) input.value = tomorrowNine();
    renderFreeOnDay();
  }
  renderEstimate();
}

// Availability calendar: how many workers of this skill said they are free that day
async function renderFreeOnDay() {
  const el = document.getElementById('freeOnDay');
  const value = document.getElementById('laterInput').value;
  if (!value || !navigator.onLine) return (el.textContent = '');
  const day = value.slice(0, 10);
  const { count } = await db.from('workers_public').select('id', { count: 'exact', head: true })
    .eq('skill', E.type).contains('available_days', [day]);
  el.textContent = tf('freeOnDay', count || 0);
}

// Meal / water / shade / toilet provided at the site
function renderPerks() {
  document.getElementById('perksBox').innerHTML = PERKS.map((p) =>
    `<button type="button" class="chip ${E.perks.includes(p) ? 'active' : ''}" onclick="togglePerk('${p}')">${PERK_ICONS[p]} ${t('perk_' + p)}</button>`).join('');
}
function togglePerk(p) {
  E.perks = E.perks.includes(p) ? E.perks.filter((x) => x !== p) : [...E.perks, p];
  renderPerks();
}

function onlineOfType() {
  return E.workers.filter((w) => w.skill === E.type).length;
}

function renderOnlineCount() {
  const n = onlineOfType();
  document.getElementById('onlineCount').textContent = n ? tf('onlineNearby', n, t(E.type)) : tf('noneOnline', t(E.type));
}

// ---------- Booking form ----------
function renderTypes() {
  document.getElementById('typeGrid').innerHTML = Object.keys(WORK_TYPES).map((k) => `
    <button type="button" class="type-btn ${k === E.type ? 'active' : ''}" onclick="pickType('${k}')">
      <span>${WORK_TYPES[k].icon}</span>${t(k)}
    </button>`).join('');
}

function pickType(k) {
  E.type = k;
  if (E.preferred && E.preferred.skill !== k) E.preferred = null;
  renderTypes();
  drawWorkers();
  renderEstimate();
}

function changeTeam(d) {
  E.team = Math.min(MAX_TEAM, Math.max(1, E.team + d));
  document.getElementById('teamValue').textContent = E.team;
  if (E.team > 1) E.preferred = null;
  renderPickWorker();
  renderEstimate();
}

function changeHours(d) {
  E.hours = Math.min(14, Math.max(1, E.hours + d));
  document.getElementById('hoursValue').textContent = E.hours;
  renderEstimate();
}

function pickLoad(load) {
  E.load = load;
  document.querySelectorAll('#loadSeg button').forEach((b) => b.classList.toggle('active', b.dataset.load === load));
  renderEstimate();
}

function currentJob() {
  return { type: E.type, hours: E.hours, load: E.load, risky: E.risky, tools: E.tools, night: isNightTime(jobStart()) };
}

// When the job starts: now, or the "later" time picked
function jobStart() {
  const at = E.when === 'later' ? Date.parse(document.getElementById('laterInput').value) : NaN;
  return at ? new Date(at) : new Date();
}

function renderEstimate() {
  const job = currentJob();
  document.getElementById('estimateBox').innerHTML = wageBoxHTML(estimateWage(job));
  const items = (GEAR[E.type] || []).map((key) => `✔ ${t(key)}`).join(' · ');
  document.getElementById('gearBox').innerHTML = items ? `<b>🦺 ${t('gearTitle')}</b>${items}` : '';
  document.getElementById('bookBtn').textContent = E.team > 1 ? tf('bookTeam', E.team, agreedWage(job) * E.team)
    : E.preferred ? `${tf('requestThis', E.preferred.name)} · ₹${agreedWage(job)}` : tf('bookNow', agreedWage(job));
}

// ---------- The exact work site ----------
// The employer can pick a locality from the list, type any street / building / landmark
// (looked up on OpenStreetMap), use GPS, or tap the map. A 📌 pin shows the exact spot
// and can be dragged. The street name for GPS and map taps comes from OpenStreetMap too.
const GEO = 'https://nominatim.openstreetmap.org';

function nearestAreaName(p) {
  const near = Object.entries(AREAS)
    .map(([name, a]) => ({ name, km: distanceKm(p, { lat: a[0], lng: a[1] }) }))
    .sort((a, b) => a.km - b.km)[0];
  return near && near.km < 3 ? near.name : null;
}

function setSite(p, label) {
  E.site = { lat: p.lat, lng: p.lng };
  // The site moved to another area: load the workers near it
  if (!E.workersAt || (kmBetween(E.workersAt, E.site) ?? 0) > 10) loadWorkers();
  if (label) {
    document.getElementById('areaInput').value = label.slice(0, 80);
    E.siteText = label.slice(0, 80);
  }
  if (!E.map) return;
  if (!E.siteMarker) {
    E.siteMarker = L.marker([p.lat, p.lng], { icon: pin('📌', 'pin-site'), draggable: true, zIndexOffset: 400 }).addTo(E.map);
    E.siteMarker.on('dragend', () => pinMoved(E.siteMarker.getLatLng()));
  }
  E.siteMarker.setLatLng([p.lat, p.lng]);
  E.map.setView([p.lat, p.lng], Math.max(E.map.getZoom(), 16));
}

// "12, Gandhi Road, Velachery" from a map spot
async function streetName(p) {
  try {
    const r = await fetch(`${GEO}/reverse?format=jsonv2&zoom=18&lat=${p.lat}&lon=${p.lng}&accept-language=en`);
    const a = (await r.json()).address || {};
    const parts = [a.house_number, a.road || a.pedestrian || a.footway,
      a.neighbourhood || a.quarter || a.suburb || a.village, a.city_district || a.town || a.city]
      .filter(Boolean).filter((x, i, all) => all.indexOf(x) === i);
    return parts.length ? parts.slice(0, 3).join(', ') : null;
  } catch (e) {
    return null;
  }
}

async function pinMoved(p) {
  setSite(p, nearestAreaName(p) || `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`);
  const name = navigator.onLine ? await streetName(p) : null;
  if (name && E.site && E.site.lat === p.lat) {
    document.getElementById('areaInput').value = name.slice(0, 80);
    E.siteText = name.slice(0, 80);
  }
}

// Typed text → the spot on the map (list first, then OpenStreetMap)
async function findSite(text) {
  const spot = AREAS[text];
  if (spot) return { lat: spot[0], lng: spot[1] };
  if (!navigator.onLine) return null;
  // A long address is tried whole, then without its first part ("No. 4, 2nd Street, Adyar" → "2nd Street, Adyar" → "Adyar")
  const parts = text.split(',').map((x) => x.trim()).filter(Boolean);
  try {
    for (let i = 0; i < Math.min(parts.length, 3); i++) {
      const rest = parts.slice(i).join(', ');
      if (AREAS[rest]) return { lat: AREAS[rest][0], lng: AREAS[rest][1] };
      const q = /chennai|tamil nadu|india/i.test(rest) ? rest : rest + ', Chennai';
      let r = await (await fetch(`${GEO}/search?format=jsonv2&limit=1&countrycodes=in&q=${encodeURIComponent(q)}`)).json();
      if (!r.length && i === 0) r = await (await fetch(`${GEO}/search?format=jsonv2&limit=1&countrycodes=in&q=${encodeURIComponent(rest)}`)).json();
      if (r.length) return { lat: +r[0].lat, lng: +r[0].lon };
    }
  } catch (e) { /* offline or busy: the map tap still works */ }
  return null;
}

async function areaTyped() {
  const text = document.getElementById('areaInput').value.trim();
  if (!text || text === E.siteText) return;
  E.siteText = text;
  const p = await findSite(text);
  if (p && document.getElementById('areaInput').value.trim() === text) setSite(p);
  else if (!p && navigator.onLine) showToast(t('siteNotFound'));
}

function useMyPlace() {
  locate(async (ok) => {
    if (!ok) return showToast(t('noLocation'));
    await pinMoved({ ...App.here });
  });
}

async function placeFor(area) {
  if (E.site && area === E.siteText) return E.site;
  const p = await findSite(area);
  return p || E.site || App.here;
}

async function bookWorker() {
  const online = navigator.onLine;
  if (online && await owesShowup()) {
    showToast(t('showupBlock'));
    return show('bookings');
  }
  const area = document.getElementById('areaInput').value.trim();
  if (!area) {
    document.getElementById('areaInput').focus();
    return showToast(t('area') + '?');
  }
  let scheduled = null;
  if (E.when === 'later') {
    const at = Date.parse(document.getElementById('laterInput').value);
    if (!at || at - Date.now() < LATER_MIN_MINUTES * 60000 - 60000) return showToast(t('laterTooSoon'));
    scheduled = new Date(at).toISOString();
  } else if (online && E.preferred && !E.preferred.online) {
    return showToast(tf('preferredOffline', E.preferred.name));
  }
  if (isNightTime(scheduled ? new Date(scheduled) : new Date()) && !E.me.gstin) {
    showToast(t('nightNeedsGst'));
    return show('bookings');
  }
  const job = currentJob();
  const wage = estimateWage(job);
  const place = await placeFor(area);
  const row = {
    employer_id: E.me.id,
    type: job.type,
    area: area === '📍' ? t('youAreHere') : area,
    lat: place.lat,
    lng: place.lng,
    hours: job.hours,
    load: job.load,
    risky: job.risky,
    wage_min: wage.min,
    wage_max: wage.max,
    agreed_wage: agreedWage(job),
    scheduled_for: scheduled,
    preferred_worker_id: E.preferred ? E.preferred.id : null,
    bring_tools: E.tools,
    perks: E.perks,
    priority_ids: !E.preferred && Fav.ids.length && document.getElementById('favFirstInput').checked ? Fav.ids : null
  };
  // Repeat every week: the template is saved first so each booking points to it
  let repeat = null;
  if (scheduled && document.getElementById('repeatInput').checked) {
    const at = new Date(scheduled);
    const template = { ...row, group_size: E.team };
    ['employer_id', 'scheduled_for', 'preferred_worker_id', 'priority_ids'].forEach((k) => delete template[k]);
    repeat = { employer_id: E.me.id, template, weekday: at.getDay(),
      at_time: `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}` };
  }
  let rows = [row];
  if (E.team > 1) {
    // Team booking: one booking per worker, linked by group_id; each rings separately
    const group = crypto.randomUUID();
    rows = Array.from({ length: E.team }, () => ({
      ...row, group_id: group, group_size: E.team
    }));
  }
  const post = { rows, repeat, savedAt: Date.now() };
  if (!online) {
    // No internet: keep the job on this phone and post it when the internet comes back
    Store.set('post_queue', [...(Store.get('post_queue', []) || []), post]);
    showToast(t('postSavedOffline'));
    E.preferred = null;
    pickWhen('now');
    syncForm();
    return show('bookings');
  }
  const btn = document.getElementById('bookBtn');
  btn.disabled = true;
  const made = await sendPost(post);
  btn.disabled = false;
  if (!made) return trustError(E.postError) || showToast(t('saveError'));
  showPosted(made);
}

// Show-up pay still owed blocks new posts
async function owesShowup() {
  const { data: owe } = await db.from('bookings').select('id').eq('employer_id', E.me.id)
    .gt('showup_pay', 0).is('showup_paid_at', null).limit(1);
  return !!(owe && owe.length);
}

// Insert one post (its weekly template first, if any). Returns the new bookings or null.
async function sendPost(post) {
  const rows = post.rows.map((r) => ({ ...r }));
  if (post.repeat) {
    const { data: rep } = await db.from('repeat_jobs').insert(post.repeat).select().single();
    if (rep) rows.forEach((r) => { r.repeat_id = rep.id; });
  }
  const { data: made, error } = await db.from('bookings').insert(rows).select();
  E.postError = error || null;
  return error || !made || !made.length ? null : made;
}

// Jobs saved while offline: post them once the internet is back
async function flushPosts() {
  const queue = Store.get('post_queue', []) || [];
  if (!queue.length || !navigator.onLine || !E.me) return;
  Store.set('post_queue', []);
  if (await owesShowup()) {
    showToast(t('showupBlock'));
    return show('bookings');
  }
  let last = null;
  const keep = [];   // refused by a safety check (sign in first, too many posts): try again later
  for (const post of queue) {
    const now = !post.rows[0].scheduled_for;
    // A "now" job saved more than an hour ago is out of date: do not ring workers for it
    if (now && Date.now() - post.savedAt > 60 * 60000) { showToast(t('postTooOld')); continue; }
    if (!now && Date.parse(post.rows[0].scheduled_for) < Date.now()) { showToast(t('postTooOld')); continue; }
    const made = await sendPost(post);
    if (made) last = made;
    else if (E.postError && ['verify_first', 'suspended', 'slow_down'].includes(E.postError.message)) {
      if (!keep.length) trustError(E.postError);
      keep.push(post);
    }
  }
  if (keep.length) Store.set('post_queue', [...keep, ...(Store.get('post_queue', []) || [])]);
  if (!last) return;
  showToast(t('postSentNow'));
  if (!E.booking && !E.crew.length) showPosted(last);
  else if (document.getElementById('bookings').classList.contains('active')) renderBookings();
}

// After posting: show the live booking (or the team view, or the later list)
async function showPosted(made) {
  const data = made[0];
  E.preferred = null;
  E.offers = [];
  if (isLater(data)) {
    // Booked for later: the booking waits in "My bookings"; this screen is free again
    showToast(tf('scheduledBooked', whenText(data)));
    pickWhen('now');
    syncForm();
    return show('bookings');
  }
  if (made.length > 1) {
    E.crew = made.slice().sort((x, y) => (x.id < y.id ? -1 : 1)); // same order as refreshCrew
    E.crewWorkers = {};
    E.team = 1;
    return renderBooking();
  }
  E.booking = data;
  E.worker = null;
  E.tip = 0;
  await loadMessages(data.id);
  renderBooking();
}

// ---------- The booking in progress ----------
function renderBooking() {
  const form = document.getElementById('bookForm');
  const live = document.getElementById('bookingLive');
  const radar = document.getElementById('radar');
  clearInterval(E.searchTimer);
  clearInterval(E.workTimer);
  if (E.crew.length) return renderCrew();
  const b = E.booking;
  if (b && Mat.bookingId !== b.id) {
    Mat.bookingId = b.id;
    Mat.list = [];
    loadMaterials(b.id).then(() => renderBooking());
  }
  form.hidden = !!b;
  radar.hidden = !(b && b.status === 'searching');
  if (!b) {
    live.innerHTML = '';
    return;
  }

  if (b.status === 'searching') {
    const ends = b.scheduled_for ? Date.parse(b.scheduled_for) : Date.parse(b.created_at) + SEARCH_SECONDS * 1000;
    const preferred = b.preferred_worker_id && E.workers.find((w) => w.id === b.preferred_worker_id);
    live.innerHTML = `
      <div class="searching">
        <div class="job-icon">${WORK_TYPES[b.type].icon}</div>
        <h2>${tf('searchingFor', t(b.type))}</h2>
        ${b.cancel_reason === 'worker_cancelled' ? `<p class="dispute-note">${t('prevWorkerCancelled')}${b.cancel_note ? `<br><small>${esc(cancelLine(b))}</small>` : ''}</p>` : ''}
        <p class="muted">${b.preferred_worker_id ? `🎯 ${tf('requestingOnly', esc(preferred ? preferred.name : t('worker')))}` : tf('requestSentTo', onlineOfType())}</p>
        ${b.scheduled_for ? `<p><b>${tf('scheduledFor', whenText(b))}</b><br><span class="muted small">${t('waitingAccept')}</span></p>`
          : '<div class="big-timer"><b id="searchClock">10:00</b></div>'}
        <p class="small">📍 ${esc(b.area)} · ⏱️ ${b.hours} ${t('hoursUnit')} · <b>₹${b.agreed_wage}</b></p>
        <p class="paid-ok small">${t('jobPosted')}</p>
        ${reservedFor(b) ? `<p class="small">${t('favReserved')}</p>` : ''}
        <button class="btn btn-whatsapp btn-block btn-big" onclick="shareJob(E.booking, E.me.name)">${t('shareJobWa')}</button>
        <div class="offers">${offersHTML()}</div>
        <button class="btn btn-light btn-block" onclick="employerCancel()">${t('cancelBooking')}</button>
      </div>`;
    const tick = () => {
      const left = (ends - Date.now()) / 1000;
      const el = document.getElementById('searchClock');
      if (el) el.textContent = clock(left);
      if (left <= 0) expireBooking();
    };
    tick();
    E.searchTimer = setInterval(tick, 1000);
    if (E.map && b.lat != null) E.map.setView([b.lat, b.lng], 14);
    return;
  }

  if (b.status === 'expired' || b.status === 'cancelled') {
    live.innerHTML = `
      <div class="searching">
        <div class="job-icon">😕</div>
        <h2>${b.status === 'expired' ? t('noWorkerFound') : statusLabel(b.status)}</h2>
        ${b.cancel_reason === 'closed_by_worker' ? `<p class="muted">${t('workerClosedNote')}</p>` : ''}
        ${b.cancelled_by === 'worker' && b.cancel_note ? `<p class="dispute-note">${esc(cancelLine(b))}</p>` : ''}
        ${b.preferred_worker_id ? `<button class="btn btn-primary btn-block btn-big" onclick="retryBooking(true)">${t('sendToAllBtn')}</button>`
          : `<button class="btn btn-primary btn-block btn-big" onclick="retryBooking()">${t('tryAgain')}</button>`}
        <button class="btn btn-light btn-block" onclick="newBooking()">${t('bookAgain')}</button>
      </div>`;
    return;
  }

  // assigned / started / completed / paid
  const w = E.worker || { name: '—' };
  const amount = amountOf(b);
  let action = '';
  if (b.status === 'assigned') {
    action = `${b.scheduled_for ? `<p><b>${tf('scheduledFor', whenText(b))}</b></p>` : ''}
      <p id="etaLine" class="eta"></p>
      <div class="otp-show"><small>${t('shareOtp')}</small><b>${otpOf(b).split('').join(' ')}</b>
        <button class="link-btn small otp-new" onclick="newOtp('${b.id}')">🔄 ${t('newOtp')}</button></div>
      <button class="btn btn-light btn-block" onclick="employerCancel()">${t('cancelJob')}</button>`;
  } else if (b.status === 'started') {
    action = `<div class="big-timer"><small>${t('workInProgress')}</small><b id="workClock">0:00</b></div>
      <p id="overtimeLine" class="overtime" hidden></p>
      ${App.isHot ? `<p class="heat-work">${t('heatEmployerNote')}</p>` : ''}
      <button class="btn btn-light btn-block" onclick="rainStop()">${t('rainStop')}</button>
      <button class="link-btn small close-unpaid" onclick="employerCancel()">${t('cancelJobBtn')}</button>`;
  } else if (b.status === 'completed') {
    action = `
      <div class="agreement">
        <div><span>${t('agreedWage')}</span><span>₹${b.agreed_wage}</span></div>
        ${b.overtime_hours ? `<div><span>${t('overtimeLabel')} (${b.overtime_hours} h)</span><span>+₹${otRate(b) * b.overtime_hours}</span></div>` : ''}
        <div><span>${t('workedTime')}</span><span>${fmtDuration(workedMinutes(b))}</span></div>
        ${b.travel_pay ? `<div><span>${t('travelPay')}</span><span>+₹${b.travel_pay}</span></div>` : ''}
        ${b.rain_off ? `<div><span>${t('rainLabel')}</span><span>🌧️</span></div>` : ''}
        ${approvedMaterials() ? `<div><span>${t('materialsLabel')}</span><span>+₹${approvedMaterials()}</span></div>` : ''}
        ${E.tip ? `<div><span>${t('tipLabel')}</span><span>+₹${E.tip}</span></div>` : ''}
        <div><span><b>${t('totalPaid')}</b></span><span><b>₹${amount + E.tip + approvedMaterials()}</b></span></div>
      </div>
      <div class="tip-box"><b>🙏 ${t('addTip')}</b>
        <div class="chips">${TIPS.map((n) => `<button type="button" class="chip ${E.tip === n ? 'active' : ''}" onclick="setTip(${n})">${n ? '₹' + n : t('noTip')}</button>`).join('')}</div>
      </div>
      ${b.effort_status === 'pending' ? `<p class="dispute-note">${t('effortPayFirst')}</p>` : `
      ${upiPayHTML(b, E.worker, amount + E.tip + approvedMaterials())}
      <button class="btn btn-accept btn-block btn-big" onclick="payWorker()">${tf('payNow', amount + E.tip + approvedMaterials())}</button>`}
      <button class="link-btn small close-unpaid" onclick="employerCancel()">${t('cancelJobBtn')}</button>`;
  } else if (b.status === 'paid' && b.worker_confirmed_at) {
    action = `<p class="paid-ok">✅ ${t('slipConfirmed')}${b.tip ? ` · 🙏 ${t('tipLabel')} ₹${b.tip}` : ''}</p>
      <button class="btn btn-dark btn-block" onclick="openSlip(E.booking, E.me, E.worker)">${t('viewSlip')}</button>`;
  } else if (b.status === 'paid' && b.disputed) {
    action = `<p class="dispute-note">⚠️ ${t('workerDisputed')}</p>`;
  } else if (b.status === 'paid') {
    action = `<p class="wait-pay"><span class="pulse-dot"></span>${t('waitingWorkerConfirm')}</p>`;
  }
  const rate = (b.status === 'completed' || b.status === 'paid') && !b.rating_by_employer
    ? `<button class="btn btn-primary btn-block" onclick="rateWorker()">⭐ ${t('rateWorkerShort')}</button>` : '';
  const again = b.status === 'paid'
    ? `<button class="btn btn-light btn-block" onclick="newBooking()">${t('bookAgain')}</button>` : '';

  live.innerHTML = `
    <div class="card job-live">
      ${stepperHTML(b.status)}
      ${b.status === 'assigned' ? `<p class="on-way">🛵 ${tf('workerOnTheWay', esc(w.name))}</p>` : ''}
      <div class="person">
        <div class="avatar">${esc((w.name || '?').slice(0, 1).toUpperCase())}</div>
        <div><b>${esc(w.name)}</b> ${trustedBadge(w)}<div class="muted small">${WORK_TYPES[b.type].icon} ${t(b.type)} · ${workerStars(w)} · ${tf('jobsCount', w.jobs_done || 0)}</div>${skillBadgesHTML(E.worker)}</div>
        ${w.phone ? `<a class="icon-btn" href="tel:${w.phone}" aria-label="${t('call')}">📞</a>
        <a class="icon-btn wa" target="_blank" rel="noopener" href="https://wa.me/91${w.phone}" aria-label="${t('whatsapp')}">💬</a>` : ''}
      </div>
      <div class="request-main">
        <div><b>${t(b.type)}</b><p class="muted">📍 ${esc(b.area)} · ⏱️ ${b.hours} ${t('hoursUnit')}</p></div>
        <div class="pay-chip">₹${amount}</div>
      </div>
      ${effortHTML('employer', b)}
      ${action}
      ${['started', 'completed'].includes(b.status) ? materialsHTML('employer', b.status) : ''}
      ${rate}
      ${b.status !== 'paid' || !b.worker_confirmed_at ? messagesHTML('employer', w.name) : ''}
      ${again}
      <button class="btn btn-light btn-block" onclick="shareOnWhatsApp(agreementText(E.booking, E.me.name, (E.worker || {}).name || ''))">${t('shareAgreement')}</button>
      ${reportLinkHTML(b.id, 'employer')}
    </div>`;

  if (b.status === 'started' && b.started_at) {
    const tick = () => {
      const el = document.getElementById('workClock');
      if (el) el.textContent = clock((Date.now() - Date.parse(b.started_at)) / 1000);
      const extra = Math.max(0, Math.ceil(workedMinutes(b) / 60 - b.hours - 0.25));
      const ot = document.getElementById('overtimeLine');
      if (ot) {
        ot.hidden = !extra;
        ot.textContent = extra ? `⏰ ${tf('overtimeLive', extra)}` : '';
      }
    };
    tick();
    E.workTimer = setInterval(tick, 1000);
  }
  updateTracking(true);
}

// Live tracking (Rapido): the worker's pin moves on the map with the arrival time
// The booked worker's live spot (only the employer on that job gets it) and everyone else's rough spot
async function refreshWorkerSpots() {
  if (!navigator.onLine || document.hidden) return;
  const onTheWay = (b) => b && b.worker_id && ['assigned', 'started'].includes(b.status);
  if (onTheWay(E.booking) && E.worker && E.worker.id === E.booking.worker_id) {
    const w = (await peopleOn('worker', [E.booking]))[E.booking.worker_id];
    if (w && E.worker && E.worker.id === w.id) {
      E.worker = { ...E.worker, ...w };
      updateTracking(false);
    }
  }
  const crew = E.crew.filter(onTheWay);
  if (crew.length) {
    const fresh = await peopleOn('worker', crew);
    const changed = Object.keys(fresh).some((id) => JSON.stringify(fresh[id]) !== JSON.stringify(E.crewWorkers[id]));
    Object.assign(E.crewWorkers, fresh);
    if (changed) renderBooking(); // re-rendering resets the timers and anything being typed
  }
  loadWorkers();
}

function updateTracking(fit) {
  const b = E.booking;
  const w = E.worker;
  const visible = b && w && w.lat != null && b.lat != null && ['assigned', 'started'].includes(b.status);
  if (!visible) {
    if (E.workerMarker) { E.workerMarker.remove(); E.workerMarker = null; }
    if (E.trackLine) { E.trackLine.remove(); E.trackLine = null; }
    return;
  }
  if (E.map) {
    if (!E.workerMarker) E.workerMarker = L.marker([w.lat, w.lng], { icon: pin('👷', 'pin-me'), zIndexOffset: 500 }).addTo(E.map);
    E.workerMarker.setLatLng([w.lat, w.lng]);
    if (b.status === 'assigned') {
      if (!E.trackLine) E.trackLine = L.polyline([], { color: '#E4561B', weight: 4, dashArray: '6 8' }).addTo(E.map);
      E.trackLine.setLatLngs([[w.lat, w.lng], [b.lat, b.lng]]);
    } else if (E.trackLine) { E.trackLine.remove(); E.trackLine = null; }
    if (fit) E.map.fitBounds([[w.lat, w.lng], [b.lat, b.lng]], { padding: [40, 40], maxZoom: 15 });
  }
  const eta = document.getElementById('etaLine');
  if (eta) eta.textContent = `🛵 ${etaText(w, b)}`;
}

// ---------- Counter-offers from workers (inDrive) ----------
function offersHTML() {
  if (!E.offers.length) return `<p class="muted small">💬 ${t('offerHint')}</p>`;
  return `<b>${t('offersTitle')}</b>` + E.offers.map((o) => {
    const w = o.worker || {};
    return `
      <div class="mini-card offer-card">
        <div><b>${esc(w.name || '')}</b> ${trustedBadge(w)}<br>
          <span class="muted small">${workerStars(w)}${w.lat != null ? ' · ' + etaText(w, E.booking) : ''}</span></div>
        <button class="btn btn-accept btn-small" onclick="acceptOffer(${o.id})">${tf('acceptOffer', o.amount)}</button>
      </div>`;
  }).join('');
}

async function refreshOffers() {
  if (!E.booking || E.booking.status !== 'searching') return;
  E.offers = await loadOffers(E.booking.id);
  renderBooking();
}

async function acceptOffer(id) {
  const { data, error } = await db.rpc('accept_offer', { p_booking: E.booking.id, p_employer: E.me.id, p_offer: id });
  if (error && trustError(error)) return refreshOffers();
  if (error || !data || !data.id) {
    showToast(t('offerGone'));
    return refreshOffers();
  }
  E.offers = [];
  await onBookingChange({ new: data });
}

// ---------- Team booking (Porter-style): one card per worker ----------
function crewDone() {
  return E.crew.every((b) => ['expired', 'cancelled'].includes(b.status) ||
    (b.status === 'paid' && (b.worker_confirmed_at || b.disputed)));
}

async function loadCrewWorkers() {
  const need = E.crew.filter((b) => b.worker_id && !E.crewWorkers[b.worker_id]);
  if (!need.length) return;
  Object.assign(E.crewWorkers, await peopleOn('worker', need));
}

function crewSlotHTML(b, i) {
  const w = E.crewWorkers[b.worker_id];
  let body;
  if (b.status === 'searching') body = `<span class="muted"><span class="pulse-dot"></span>${t('slotFinding')}</span>`;
  else if (!b.worker_id) body = `<span class="muted">${t('slotEmpty')}</span>`;
  else {
    let action = '';
    if (b.status === 'assigned') {
      action = `<span class="otp-mini">OTP <b>${otpOf(b)}</b></span>${w && w.lat != null ? ` <small class="muted">🛵 ${etaText(w, b)}</small>` : ''}`;
    } else if (b.status === 'started') {
      action = `<span class="badge badge-accepted">${statusLabel('started')}</span>`;
    } else if (b.status === 'completed') {
      action = `<button class="btn btn-accept btn-small" onclick="openCrewPay('${b.id}')">${tf('payOne', amountOf(b))}</button>`;
    } else if (b.status === 'paid') {
      action = b.worker_confirmed_at ? `<span class="badge badge-open">✅ ${t('paySlip')}</span>`
        : b.disputed ? `<span class="badge badge-disputed">⚠️ ${t('statusDisputed')}</span>`
          : `<span class="badge badge-accepted">${t('awaitingConfirm')}</span>`;
    }
    if (b.effort_status === 'pending') action += ` <span class="badge badge-accepted">😓 +₹${b.effort_extra}</span>`;
    const chat = ['assigned', 'started', 'completed'].includes(b.status)
      ? `<button class="icon-btn" onclick="openCrewChat('${b.id}')" aria-label="${attr(t('quickMessages'))}">💬</button>` : '';
    body = `<div class="crew-main"><b>${esc(w ? w.name : '…')}</b> <small>${w ? workerStars(w) : ''}</small><br>${action}</div>
      ${chat}${w && w.phone ? `<a class="icon-btn" href="tel:${w.phone}" aria-label="${t('call')}">📞</a>` : ''}`;
  }
  return `<div class="crew-slot"><span class="crew-num">${i + 1}</span>${body}</div>`;
}

function renderCrew() {
  const crew = E.crew;
  const first = crew[0];
  const searching = crew.filter((b) => b.status === 'searching');
  const filled = crew.filter((b) => b.worker_id).length;
  const total = crew.filter((b) => b.worker_id).reduce((s, b) => s + amountOf(b), 0);
  document.getElementById('bookForm').hidden = true;
  document.getElementById('radar').hidden = !searching.length;
  document.getElementById('bookingLive').innerHTML = `
    <div class="card job-live">
      <h2>👥 ${tf('teamOf', crew.length, t(first.type))}</h2>
      <p class="muted">📍 ${esc(first.area)} · ⏱️ ${first.hours} ${t('hoursUnit')} · ${tf('teamFilled', filled, crew.length)}</p>
      ${searching.length && !first.scheduled_for ? `<div class="big-timer"><small>${t('slotFinding')}</small><b id="searchClock">10:00</b></div>` : ''}
      <div class="crew">${crew.map(crewSlotHTML).join('')}</div>
      <div class="agreement"><div><span><b>${t('teamTotal')}</b></span><span><b>₹${total}</b></span></div></div>
      ${searching.length ? `<button class="btn btn-whatsapp btn-block" onclick="shareJob(E.crew.find((x) => x.status === 'searching'), E.me.name)">${t('shareJobWa')}</button>
        <button class="btn btn-light btn-block" onclick="stopCrewSearch()">${t('cancelUnfilled')}</button>` : ''}
      ${crewDone() ? `<button class="btn btn-primary btn-block btn-big" onclick="newBooking()">${t('bookAgain')}</button>` : ''}
    </div>`;
  if (searching.length && !first.scheduled_for) {
    const ends = Math.max(...searching.map((b) => Date.parse(b.created_at))) + SEARCH_SECONDS * 1000;
    const tick = () => {
      const left = (ends - Date.now()) / 1000;
      const el = document.getElementById('searchClock');
      if (el) el.textContent = clock(left);
      if (left <= 0) stopCrewSearch('expired');
    };
    tick();
    E.searchTimer = setInterval(tick, 1000);
  }
}

async function refreshCrew() {
  if (!E.crew.length) return;
  const { data } = await db.from('bookings').select('*').eq('group_id', E.crew[0].group_id).order('id');
  if (data) E.crew = data;
  await loadCrewWorkers();
  renderBooking();
}

async function stopCrewSearch(reason) {
  clearInterval(E.searchTimer);
  for (const b of E.crew.filter((x) => x.status === 'searching')) {
    await db.rpc('cancel_booking', { p_booking: b.id, p_employer: E.me.id, p_reason: reason || 'cancelled' });
  }
  await refreshCrew();
}

// ---------- Team slots: quick messages, tip and UPI for each worker ----------
function crewModal() {
  let m = document.getElementById('crewModal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'crewModal';
    m.className = 'modal';
    m.innerHTML = `<div class="modal-box slip-box"><div id="crewModalBody"></div>
      <button class="btn btn-light btn-block" onclick="closeCrewModal()">${t('close')}</button></div>`;
    m.addEventListener('click', (e) => { if (e.target === m) closeCrewModal(); });
    document.body.appendChild(m);
  }
  return m;
}
function closeCrewModal() {
  E.crewChat = null;
  E.crewPay = null;
  Msg.bookingId = null;
  closeModal('crewModal');
}

async function openCrewChat(id) {
  E.crewPay = null;
  E.crewChat = id;
  await loadMessages(id);
  const m = crewModal();
  drawCrewChat();
  m.classList.add('open');
}
function drawCrewChat() {
  const b = E.crew.find((x) => x.id === E.crewChat);
  if (!b) return;
  const w = E.crewWorkers[b.worker_id] || {};
  document.getElementById('crewModalBody').innerHTML = `<h3>💬 ${esc(w.name || '')}</h3>${messagesHTML('employer', w.name)}`;
}

function openCrewPay(id) {
  E.crewChat = null;
  E.crewPay = { id, tip: 0 };
  const m = crewModal();
  drawCrewPay();
  m.classList.add('open');
}
function drawCrewPay() {
  const b = E.crewPay && E.crew.find((x) => x.id === E.crewPay.id);
  if (!b) return;
  const w = E.crewWorkers[b.worker_id] || {};
  const tip = E.crewPay.tip;
  const total = amountOf(b) + tip;
  document.getElementById('crewModalBody').innerHTML = `
    <h3>${esc(w.name || '')}</h3>
    ${effortHTML('employer', b)}
    <div class="agreement">
      <div><span>${t('agreedWage')}</span><span>₹${amountOf(b)}</span></div>
      ${tip ? `<div><span>${t('tipLabel')}</span><span>+₹${tip}</span></div>` : ''}
      <div><span><b>${t('totalPaid')}</b></span><span><b>₹${total}</b></span></div>
    </div>
    <div class="tip-box"><b>🙏 ${t('addTip')}</b>
      <div class="chips">${TIPS.map((n) => `<button type="button" class="chip ${tip === n ? 'active' : ''}" onclick="E.crewPay.tip = ${n}; drawCrewPay()">${n ? '₹' + n : t('noTip')}</button>`).join('')}</div>
    </div>
    ${b.effort_status === 'pending' ? `<p class="dispute-note">${t('effortPayFirst')}</p>` : `
    ${upiPayHTML(b, w, total)}
    <button class="btn btn-accept btn-block btn-big" onclick="payCrew('${b.id}')">${tf('payNow', total)}</button>`}`;
}

async function payCrew(id) {
  const tip = E.crewPay && E.crewPay.id === id ? E.crewPay.tip : 0;
  const r = await callAction('pay_booking', { p_booking: id, p_employer: E.me.id, p_tip: tip });
  if (r.error || (!r.queued && !r.data)) return showToast(t('saveError'));
  closeCrewModal();
  await loadMe();
  await refreshCrew();
  openStars(t('rateWorkerTitle'), async (stars, tags) => {
    await callAction('review_booking', { p_booking: id, p_by: 'employer', p_stars: stars, p_tags: tags });
  }, REVIEW_TAGS.worker);
}

// Rain-off pay: the worker is paid for the time worked, at least half the wage
async function rainStop() {
  if (!confirm(t('rainConfirm'))) return;
  const { data, error } = await db.rpc('rain_stop', { p_booking: E.booking.id, p_employer: E.me.id });
  if (error || !data) return showToast(t('saveError'));
  await refreshBooking();
}

function setTip(n) {
  E.tip = n;
  renderBooking();
}

// Cancel at any stage, with a reason. After the work started it counts as unpaid on the Fair Pay Score.
function employerCancel(b = E.booking, after = newBooking) {
  const started = ['started', 'completed'].includes(b.status);
  const warn = started ? t('empCancelAfter') : b.status === 'assigned' && !b.scheduled_for ? t('empCancelShowup') : '';
  askCancel('employer', started, warn, async (note) => {
    const { data, error } = await db.rpc('cancel_job', { p_booking: b.id, p_worker: null, p_employer: E.me.id, p_note: note });
    if (error || !['cancelled', 'showup', 'unpaid'].includes(data)) return showToast(t('saveError'));
    showToast(t('cancelDone'));
    if (data === 'unpaid') await loadMe();
    after();
  });
}

async function onBookingChange(payload) {
  const b = payload.new;
  if (!b || !b.id) return;
  const slot = E.crew.findIndex((x) => x.id === b.id);
  if (slot >= 0) {
    const was = E.crew[slot];
    E.crew[slot] = b;
    await loadCrewWorkers();
    if (was.status === 'searching' && b.status === 'assigned') ring();
    if (!was.worker_confirmed_at && b.worker_confirmed_at) ring();
    return renderBooking();
  }
  if (!E.booking || b.id !== E.booking.id) {
    // A booking for later was accepted
    if (b.status === 'assigned' && b.scheduled_for && !b.started_at && b.accepted_at &&
        Date.now() - Date.parse(b.accepted_at) < 30000) {
      const { data: w } = await db.from('workers_public').select('name').eq('id', b.worker_id).maybeSingle();
      showToast(tf('laterAccepted', w ? w.name : t('worker'), whenText(b)));
      ring();
      if (document.getElementById('bookings').classList.contains('active')) renderBookings();
    }
    return;
  }
  const was = E.booking;
  E.booking = b;
  if (!b.worker_id) E.worker = null;
  if (b.worker_id && (!E.worker || E.worker.id !== b.worker_id)) {
    E.worker = (await peopleOn('worker', [b]))[b.worker_id] || null;
  }
  if (was.status === 'assigned' && b.status === 'searching') {
    showToast(t('workerCantCome'));
    ring();
  }
  if (was.status === 'searching' && b.status === 'assigned') ring();
  if (!was.worker_confirmed_at && b.worker_confirmed_at) ring();
  renderBooking();
}

async function expireBooking() {
  clearInterval(E.searchTimer);
  await db.rpc('cancel_booking', { p_booking: E.booking.id, p_employer: E.me.id, p_reason: 'expired' });
  await refreshBooking();
}

async function refreshBooking() {
  if (!E.booking || !navigator.onLine) return;
  const { data } = await db.from('bookings').select('*').eq('id', E.booking.id).single();
  if (data) await onBookingChange({ new: data });
}

function retryBooking(toEveryone) {
  const b = E.booking;
  E.type = b.type; E.hours = b.hours; E.load = b.load; E.risky = b.risky;
  E.preferred = toEveryone ? null : E.workers.find((w) => w.id === b.preferred_worker_id) || null;
  document.getElementById('areaInput').value = b.area;
  if (b.lat != null) setSite(b, b.area);
  syncForm();
  E.booking = null;
  renderBooking();
  bookWorker();
}

function newBooking() {
  E.booking = null;
  E.worker = null;
  E.tip = 0;
  E.crew = [];
  E.crewWorkers = {};
  E.offers = [];
  Msg.bookingId = null;
  Msg.list = [];
  renderBooking();
  syncForm();
}

async function payWorker() {
  const r = await callAction('pay_booking', { p_booking: E.booking.id, p_employer: E.me.id, p_tip: E.tip });
  if (r.queued) {
    E.booking = { ...E.booking, status: 'paid', paid_at: new Date().toISOString(),
      tip: E.tip, paid_amount: amountOf(E.booking) + E.tip };
    return renderBooking();
  }
  if (r.error || !r.data) return showToast(t('saveError'));
  await loadMe();
  await refreshBooking();
  rateWorker();
}

function rateWorker() {
  if (E.booking.rating_by_employer) return;
  openStars(t('rateWorkerTitle'), async (stars, tags) => {
    await callAction('review_booking', { p_booking: E.booking.id, p_by: 'employer', p_stars: stars, p_tags: tags });
    E.booking.rating_by_employer = stars;
    await refreshBooking();
  }, REVIEW_TAGS.worker);
}

// Pick up a booking left open (page reloaded mid-booking)
async function loadOpenBooking() {
  const { data } = await db.from('bookings').select('*').eq('employer_id', E.me.id)
    .or('status.in.(searching,assigned,started,completed),and(status.eq.paid,worker_confirmed_at.is.null)')
    .order('created_at', { ascending: false }).limit(10);
  const b = (data || []).find((x) => !isLater(x));
  if (!b) return;
  if (b.group_id) {
    E.crew = [b];
    return refreshCrew();
  }
  E.booking = b;
  if (b.worker_id) E.worker = (await peopleOn('worker', [b]))[b.worker_id] || null;
  await loadMessages(b.id);
  if (b.status === 'searching') E.offers = await loadOffers(b.id);
}

// ---------- My bookings, with pay slips ----------
async function renderBookings() {
  if (navigator.onLine) {
    await loadMe();
    const { data } = await db.from('bookings').select('*').eq('employer_id', E.me.id)
      .order('created_at', { ascending: false }).limit(50);
    const list = data || [];
    const ws = await peopleOn('worker', list);
    list.forEach((b) => { b.worker = ws[b.worker_id] || null; });
    E.records = list;
    Store.set('e_records', list);
    Store.set('e_me', E.me);
  } else {
    E.records = Store.get('e_records', []);
  }

  const waiting = (Store.get('post_queue', []) || []).length;
  document.getElementById('pendingPosts').innerHTML = waiting
    ? `<p class="offline-wait">⏳ ${tf('postsWaiting', waiting)}</p>` : '';
  const s = fairPayScore(E.me);
  document.getElementById('myScore').innerHTML = `
    <small>${t('yourFairPay')}</small>
    <div>${s === null ? `<span class="score score-ok">${t('newEmployer')}</span>` : `<b class="score-big">${s}</b><span class="muted">/100</span>`}</div>
    <p class="muted small">${t('fairPayScore')}${E.me.disputes ? ` · ⚠️ ${t('disputedPayments')}: ${E.me.disputes}` : ''}${E.me.effort_refused ? ` · ${tf('effortRefusedCount', E.me.effort_refused)}` : ''}</p>
    <div id="myWelfare"></div>`;
  if (navigator.onLine) {
    reviewsOf('employer', E.me.id).then((counts) => {
      const box = document.getElementById('myWelfare');
      if (box) box.innerHTML = `<p class="small"><b>${t('yourWelfare')}</b></p><div class="tags">${tagChipsHTML(counts, 5)}</div>`;
    });
  }

  renderRestHost();
  renderGstCard();
  const box = document.getElementById('bookingList');
  // Bookings for later first, soonest at the top
  const upcomingAt = (b) => b.scheduled_for && ['searching', 'assigned'].includes(b.status) ? Date.parse(b.scheduled_for) : Infinity;
  E.records.sort((a, b) => upcomingAt(a) - upcomingAt(b) || Date.parse(b.created_at) - Date.parse(a.created_at));
  if (!E.records.length) {
    box.innerHTML = `<p class="muted">${t('noMyJobs')}</p>`;
    return;
  }
  box.innerHTML = E.records.map((b, i) => {
    let label = statusLabel(b.status);
    let cls = b.status === 'paid' ? 'open' : 'accepted';
    if (b.status === 'paid' && b.worker_confirmed_at) label = '✅ ' + t('paySlip');
    else if (b.status === 'paid' && b.disputed) { label = '⚠️ ' + t('statusDisputed'); cls = 'disputed'; }
    else if (b.status === 'paid') label = t('awaitingConfirm');
    const upcoming = b.scheduled_for && ['searching', 'assigned'].includes(b.status);
    if (upcoming && b.status === 'searching') label = t('waitingAccept');
    if (b.status === 'cancelled' && b.cancel_note) label += ` · ${esc(reasonText(b.cancel_note))}`;
    return `
    <div class="mini-card">
      <div>
        <b>${WORK_TYPES[b.type].icon} ${t(b.type)}</b> · ${esc(b.area)}${b.group_size > 1 ? ` · 👥 ${b.group_size}` : ''}<br>
        <span class="muted small">${b.worker ? '👷 ' + esc(b.worker.name) + ' · ' : ''}${timeAgo(b.created_at)}</span><br>
        ${b.scheduled_for ? `<b class="small">${tf('scheduledFor', whenText(b))}</b><br>` : ''}
        ${b.showup_pay ? `<span class="small">${b.showup_paid_at ? tf('showupPaid', b.showup_pay) : tf('showupOwed', b.showup_pay)}</span><br>` : ''}
        ${b.repeat_id ? `<span class="tag">${t('repeatTag')}</span>` : ''}
        <span class="badge badge-${cls}">${label}</span>
        ${b.rating_by_employer ? `<span class="stars-small">${'★'.repeat(b.rating_by_employer)}</span>` : ''}
      </div>
      <div class="actions">
        <b class="pay-chip">₹${amountOf(b)}</b>
        ${b.worker_confirmed_at ? `<button class="btn btn-light btn-small" onclick="openRecordSlip(${i})">🧾</button>` : ''}
        ${b.worker && b.status === 'paid' && !b.rating_by_employer ? `<button class="btn btn-primary btn-small" onclick="rateRecord(${i})">⭐ ${t('rateWorkerShort')}</button>` : ''}
        ${b.worker && b.status === 'paid' ? `<button class="btn btn-light btn-small" onclick="bookAgain(${i})">${t('bookAgainWorker')}</button>` : ''}
        ${upcoming && b.status === 'searching' ? `<button class="btn btn-whatsapp btn-small" onclick="shareJob(E.records[${i}], E.me.name)">📲</button>` : ''}
        ${upcoming ? `<button class="btn btn-light btn-small" onclick="cancelUpcoming(${i})">${t('cancelJob')}</button>` : ''}
        ${b.showup_pay && !b.showup_paid_at ? `<button class="btn btn-dark btn-small" onclick="payShowup(${i})">${tf('payShowup', b.showup_pay)}</button>` : ''}
        ${b.repeat_id && upcoming ? `<button class="btn btn-light btn-small" onclick="stopRepeat(${b.repeat_id})">${t('repeatStop')}</button>` : ''}
        ${b.disputed || b.worker_confirmed_at ? `<a class="btn btn-light btn-small" target="_blank" rel="noopener" href="${disputeLink(b)}">${t('evidence')}</a>` : ''}
      </div>
    </div>`;
  }).join('');
}

function openRecordSlip(i) {
  const b = E.records[i];
  openSlip(b, E.me, b.worker);
}

// ---------- Show-up pay ----------
async function payShowup(i) {
  const { data, error } = await db.rpc('pay_showup', { p_booking: E.records[i].id, p_employer: E.me.id });
  if (error || !data) return showToast(t('saveError'));
  renderBookings();
}

// ---------- GST verification (needed for night jobs) ----------
function renderGstCard() {
  const box = document.getElementById('gstCard');
  box.innerHTML = E.me.gstin
    ? `<b>${t('gstTitle')}</b><p class="paid-ok">${t('gstVerified')} · ${esc(E.me.gstin)}</p>`
    : `<b>${t('gstTitle')}</b><p class="muted small">${t('gstHint')}</p>
      <form class="row" onsubmit="saveGst(event)">
        <input name="gst" class="input" maxlength="15" placeholder="${attr(t('gstPh'))}" style="text-transform:uppercase">
        <button class="btn btn-dark btn-small" type="submit">${t('gstSave')}</button>
      </form>`;
}

async function saveGst(event) {
  event.preventDefault();
  const gst = event.target.gst.value.trim().toUpperCase();
  if (!GSTIN_RE.test(gst)) return showToast(t('gstBad'));
  const { error } = await db.from('employers').update({ gstin: gst }).eq('id', E.me.id);
  if (error) return showToast(t('saveError'));
  E.me = { ...E.me, gstin: gst };
  Store.set('e_me', E.me);
  showToast(t('gstSaved'));
  renderGstCard();
}

// ---------- Rest point for workers (Zomato-style rest points) ----------
async function renderRestHost() {
  const box = document.getElementById('restHost');
  const { data: mine } = navigator.onLine
    ? await db.from('rest_points').select('*').eq('employer_id', E.me.id).maybeSingle() : { data: null };
  if (mine) {
    box.innerHTML = `
      <b>${t('restHostTitle')}</b>
      <p class="paid-ok">✅ ${t('restPointLive')}</p>
      <p><b>${esc(mine.name)}</b> · ${amenityIcons(mine)}</p>
      <button class="btn btn-light btn-small" onclick="removeRestPoint()">${t('removeRestPoint')}</button>`;
    return;
  }
  const checks = ['water', 'shade', 'toilet', 'charging'].map((k) =>
    `<label class="check"><input type="checkbox" name="${k}"> ${t('give' + k[0].toUpperCase() + k.slice(1))}</label>`).join('');
  box.innerHTML = `
    <b>${t('restHostTitle')}</b>
    <p class="muted small">${t('restHostHint')}</p>
    <form id="restForm" class="form" onsubmit="saveRestPoint(event)">
      <label><span>${t('shopName')}</span><input name="name" required maxlength="60" value="${attr(E.me.name)}"></label>
      ${checks}
      <button class="btn btn-dark btn-block" type="submit">${t('saveRestPoint')}</button>
    </form>`;
}

async function saveRestPoint(event) {
  event.preventDefault();
  const f = event.target;
  const row = {
    employer_id: E.me.id, name: f.name.value.trim(),
    water: f.water.checked, shade: f.shade.checked, toilet: f.toilet.checked, charging: f.charging.checked
  };
  if (!(row.water || row.shade || row.toilet || row.charging)) return showToast(t('pickOneAmenity'));
  await new Promise((resolve) => locate(() => resolve()));
  const { error } = await db.from('rest_points').insert({ ...row, lat: App.here.lat, lng: App.here.lng });
  if (error) return showToast(t('saveError'));
  renderRestHost();
}

async function removeRestPoint() {
  await db.from('rest_points').delete().eq('employer_id', E.me.id);
  renderRestHost();
}

// Rate a past job (for example one paid by QR, which skips the in-app Pay step)
function rateRecord(i) {
  const b = E.records[i];
  openStars(t('rateWorkerTitle'), async (stars, tags) => {
    await callAction('review_booking', { p_booking: b.id, p_by: 'employer', p_stars: stars, p_tags: tags });
    renderBookings();
  }, REVIEW_TAGS.worker);
}

// Book the same worker again (Urban Company "rebook your professional")
function bookAgain(i) {
  const b = E.records[i];
  E.type = b.type; E.hours = b.hours; E.load = b.load; E.risky = b.risky;
  document.getElementById('areaInput').value = b.area;
  if (b.lat != null) setSite(b, b.area);
  E.preferred = E.workers.find((w) => w.id === b.worker.id) || b.worker;
  if (!E.preferred.online) pickWhen('later');
  show('book');
  syncForm();
}

function cancelUpcoming(i) {
  employerCancel(E.records[i], renderBookings);
}

// ---------- Start ----------
function syncForm() {
  renderTypes();
  document.getElementById('hoursValue').textContent = E.hours;
  document.getElementById('riskyInput').checked = E.risky;
  pickLoad(E.load);
  document.getElementById('teamValue').textContent = E.team;
  document.getElementById('toolsInput').checked = E.tools;
  document.getElementById('favFirstRow').hidden = !Fav.ids.length || !!E.preferred;
  renderPerks();
  renderOnlineCount();
  renderPickWorker();
  renderEstimate();
}

App.onLang = () => {
  applyLang();
  renderHeatBanners();
  renderOfflineBanner();
  if (!E.me) return;
  syncForm();
  drawWorkers();
  renderBooking();
  if (document.getElementById('bookings').classList.contains('active')) renderBookings();
};
App.onShow = (id) => {
  if (id === 'bookings' && E.me) renderBookings();
  if (id === 'book' && E.map) setTimeout(() => E.map.invalidateSize(), 50);
};
App.onHeat = () => { if (E.me) renderEstimate(); };
App.onMove = () => {};
App.onMessages = () => (E.crewChat ? drawCrewChat() : renderBooking());
App.onOtp = () => { if (!E.crewChat && !E.crewPay) renderBooking(); };
// A message from a team member whose chat is not open: still tell the employer
App.onOtherMessage = (m) => {
  const b = E.crew.find((x) => x.id === m.booking_id);
  if (!b || m.sender === 'employer') return;
  const w = E.crewWorkers[b.worker_id] || {};
  showToast(`💬 ${w.name || ''}: ${t('ph_' + m.phrase)}`);
  ring();
};
App.onMaterials = () => renderBooking();
App.onRepeat = () => renderBookings();
App.onFavorites = (id) => {
  const fav = document.getElementById('profileFav');
  if (fav) fav.textContent = Fav.ids.includes(id) ? t('favOn') : t('favAdd');
  syncForm();
};
App.onSynced = () => refreshBooking();

async function startApp() {
  show('book');
  if (!E.map) E.map = heroMap('heroMap');
  if (E.map && !E.map.wbSiteTap) {
    E.map.wbSiteTap = true;
    E.map.on('click', (ev) => { if (!E.booking) pinMoved({ lat: ev.latlng.lat, lng: ev.latlng.lng }); });
  }
  document.getElementById('areaInput').onchange = areaTyped;
  document.getElementById('areaList').innerHTML = Object.keys(AREAS).map((a) => `<option value="${a}">`).join('');
  document.querySelectorAll('#loadSeg button').forEach((b) => b.addEventListener('click', () => pickLoad(b.dataset.load)));
  document.querySelectorAll('#whenSeg button').forEach((b) => b.addEventListener('click', () => pickWhen(b.dataset.when)));
  pickWhen(E.when);
  syncForm();
  document.getElementById('laterInput').addEventListener('change', () => { renderFreeOnDay(); renderEstimate(); });
  if (!navigator.onLine) return;
  await loadFavorites();
  await loadWorkers();
  // If this phone already allows location, start from where the employer is (no permission prompt here)
  if (navigator.permissions && !E.site) {
    navigator.permissions.query({ name: 'geolocation' }).then((s) => {
      if (s.state === 'granted') locate((ok) => {
        if (!ok || E.site) return;
        if (E.map) E.map.setView([App.here.lat, App.here.lng], 14);
        loadWorkers();
      });
    }).catch(() => {});
  }
  await loadOpenBooking();
  syncForm();
  listenMaterials((row, kind) => {
    if (kind === 'INSERT') { showToast(`🧾 ${row.item} · ₹${row.amount}`); ring(); }
    renderBooking();
  });
  renderBooking();
  flushQueue();
  flushPosts();
  window.addEventListener('online', flushPosts);

  db.channel('employer-live')
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'bookings', filter: `employer_id=eq.${E.me.id}` }, onBookingChange)
    .subscribe();
  // Worker rows are no longer sent live (they hold phone numbers and GPS), so positions refresh every 15 seconds
  setInterval(refreshWorkerSpots, 15000);
  listenOffers((o) => {
    if (!E.booking || o.booking_id !== E.booking.id) return;
    if (o.status === 'open') ring();
    refreshOffers();
  });
  listenMessages((m) => {
    if (m.sender !== 'employer') {
      showToast(`💬 ${t('ph_' + m.phrase)}`);
      ring();
    }
    if (E.crewChat) drawCrewChat();
    else renderBooking();
  });
}

async function init() {
  initLangSelect();
  applyLang();
  await ensureConsent();
  registerOffline();
  document.getElementById('onboardForm').addEventListener('submit', saveProfile);
  document.querySelectorAll('.bottom-nav button').forEach((b) => b.addEventListener('click', () => show(b.dataset.go)));
  document.querySelectorAll('.modal').forEach((m) => m.addEventListener('click', (e) => {
    if (e.target === m) m.classList.remove('open');
  }));
  document.body.addEventListener('click', unlockSound, { once: true });
  loadHeat();
  let offline = !navigator.onLine;
  if (!offline) {
    try {
      await ensureSignedIn();
      await loadMe();
    } catch (e) {
      offline = true;
    }
  }
  initAccount(() => !!E.me, () => location.reload());
  if (offline) {
    E.me = Store.get('e_me', null);
    if (!E.me) {
      document.body.classList.add('onboarding');
      return show('onboard');
    }
    startApp(); // the booking form works offline; jobs are saved and posted later
    window.addEventListener('online', () => location.reload(), { once: true });
    return;
  }
  if (!E.me) {
    document.body.classList.add('onboarding');
    show('onboard');
    return;
  }
  Store.set('e_me', E.me);
  startApp();
}

// Road distance arrived: redraw the arrival line and the offers list
window.addEventListener('wb-eta', () => {
  if (E.booking && E.worker && E.booking.status === 'assigned') updateTracking(false);
  if (E.booking && E.booking.status === 'searching' && E.offers.length) renderBooking();
});

init();
