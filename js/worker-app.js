// worker-app.js — the worker's app: go online, get job requests, OTP start, complete,
// confirm pay (proof of pay), wage record, quick messages, works offline,
// plus jobs for later, live location while going to the job, can't come, tips (see extras.js)
// Owner: Member 1 (Worker experience)

const W = {
  me: null,          // this worker's row in the database
  active: null,      // the booking this worker is doing now
  employer: null,    // the employer of the active booking
  request: null,     // the booking ringing on screen right now
  requestEmployer: null,
  declined: new Set(),
  countdown: null,
  workTimer: null,
  map: null,
  meMarker: null,
  jobMarker: null,
  records: [],       // my bookings with employer names (wage record)
  offers: {},        // booking id -> amount I asked for (counter-offers)
  later: [],         // open jobs for later that I can accept
  upcoming: []       // jobs for later I have accepted
};

// ---------- Saved copies for offline use ----------
function cacheState() {
  Store.set('w_me', W.me);
  Store.set('w_active', W.active);
  Store.set('w_employer', W.employer);
}

// ---------- Profile ----------
async function loadMe() {
  let { data, error } = await db.from('workers').select('*').eq('device_id', deviceId()).maybeSingle();
  if (error) throw error;
  const u = !data && (await db.auth.getSession()).data.session;
  if (u) {
    const mine = await db.from('workers').select('*').eq('auth_id', u.user.id).order('created_at', { ascending: false }).limit(1);
    data = (mine.data || [])[0] || null;
    if (data && data.device_id) Store.set('device', data.device_id);
  }
  W.me = data;
}

function editProfile() {
  const f = document.getElementById('onboardForm');
  f.name.value = W.me ? W.me.name : '';
  f.phone.value = W.me ? W.me.phone : '';
  f.skill.value = W.me ? W.me.skill : 'coolie';
  f.exp.value = W.me ? W.me.experience_years || 0 : 0;
  f.iti.value = W.me ? W.me.iti_cert || '' : '';
  f.upi.value = W.me ? W.me.upi_id || '' : '';
  f.birth.value = W.me && W.me.birth_year ? W.me.birth_year : '';
  f.state.value = W.me ? W.me.home_state || '' : '';
  f.city.value = W.me ? W.me.city || '' : '';
  f.mestri.checked = !!(W.me && W.me.is_mestri);
  renderToolChecks(W.me ? W.me.tools : []);
  enterOnboarding(true);
}

function enterOnboarding(on) {
  document.body.classList.toggle('onboarding', on);
  if (on) show('onboard');
}

async function saveProfile(event) {
  event.preventDefault();
  const f = event.target;
  const row = { name: f.name.value.trim(), phone: f.phone.value.replace(/\D/g, ''), skill: f.skill.value,
    experience_years: Math.min(60, Math.max(0, parseInt(f.exp.value, 10) || 0)),
    iti_cert: f.iti.value.trim().length >= 4 ? f.iti.value.trim() : null,
    upi_id: f.upi.value.trim() || null,
    birth_year: parseInt(f.birth.value, 10) || null,
    home_state: f.state.value.trim() || null,
    city: f.city.value.trim() || null,
    tools: [...document.querySelectorAll('#toolsChecks .chip.active')].map((c) => c.dataset.tool),
    is_mestri: f.mestri.checked };
  if (!/^[6-9]\d{9}$/.test(row.phone)) return showToast(t('badPhone'));
  if (!ageOk(row.birth_year)) return showToast(t('under18'));
  const movedTo = W.me && W.me.city && row.city && row.city !== W.me.city ? row.city : null;
  const query = W.me
    ? db.from('workers').update(row).eq('id', W.me.id).select().single()
    : db.from('workers').insert({ ...row, device_id: deviceId(), lat: App.here.lat, lng: App.here.lng }).select().single();
  const { data, error } = await query;
  if (error) return showToast(t('saveError'));
  W.me = data;
  cacheState();
  renderAccount();
  enterOnboarding(false);
  show('home');
  if (!W.map) W.map = heroMap('heroMap');
  renderHome();
  listen();
  openJobLink();
  rememberProfile();
  if (movedTo) showToast(tf('movedCity', movedTo));
}

// Tools the worker owns (shown on their profile)
function renderToolChecks(selected) {
  document.getElementById('toolsChecks').innerHTML = TOOL_LIST.map((k) =>
    `<button type="button" class="chip ${(selected || []).includes(k) ? 'active' : ''}" data-tool="${k}" onclick="this.classList.toggle('active')">${TOOL_ICONS[k]} ${t('tool_' + k)}</button>`).join('');
}

// ---------- Going online / offline ----------
async function toggleDuty() {
  unlockSound(); // a tap lets the phone play the request sound later
  if (!navigator.onLine) return showToast(t('offlineBanner'));
  const online = !W.me.online;
  const update = { online };
  if (online) {
    await new Promise((resolve) => locate(() => resolve()));
    update.lat = App.here.lat;
    update.lng = App.here.lng;
  }
  const { data, error } = await db.from('workers').update(update).eq('id', W.me.id).select().single();
  if (error) return showToast(t('saveError'));
  W.me = data;
  cacheState();
  renderHome();
  if (online) checkOpenRequests();
}

function renderHome() {
  if (!W.me) return;
  document.getElementById('helloName').textContent = tf('hello', W.me.name);
  document.getElementById('meLine').innerHTML =
    `${WORK_TYPES[W.me.skill].icon} ${t(W.me.skill)} · ${workerStars(W.me)}${W.me.home_state ? ' · ' + tf('migrantFrom', esc(W.me.home_state)) : ''}${skillBadgesHTML(W.me)}`;
  document.getElementById('crewNav').hidden = !W.me.is_mestri;

  const btn = document.getElementById('dutyBtn');
  btn.textContent = W.me.online ? t('goOffline') : t('goOnline');
  btn.classList.toggle('is-online', W.me.online);
  document.getElementById('dutyText').innerHTML = W.me.online
    ? `<span class="pulse-dot"></span>${t('onlineWaiting')}`
    : t('offlineHint');
  document.getElementById('jobsDone').textContent = W.me.jobs_done;
  document.getElementById('dutyBlock').hidden = !!W.active;

  if (W.map) {
    if (!W.meMarker) W.meMarker = L.marker([App.here.lat, App.here.lng], { icon: pin('👷', 'pin-me') }).addTo(W.map);
    W.meMarker.setLatLng([App.here.lat, App.here.lng]);
  }
  renderActive();
  loadEarnings();
  loadLaterJobs();
  renderAvailability();
}

async function loadEarnings() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const slips = Store.get('w_slips', []);
  let total = slips.filter((b) => Date.parse(b.worker_confirmed_at) >= start.getTime()).reduce((s, b) => s + amountOf(b), 0);
  if (navigator.onLine) {
    const { data } = await db.from('bookings').select('agreed_wage,paid_amount,overtime_hours')
      .eq('worker_id', W.me.id).not('worker_confirmed_at', 'is', null).gte('worker_confirmed_at', start.toISOString());
    if (data) total = data.reduce((s, b) => s + amountOf(b), 0);
  }
  document.getElementById('todayEarnings').textContent = `₹${total}`;
}

// ---------- Live updates ----------
function listen() {
  if (W.listening) return;
  W.listening = true;
  listenMaterials((row) => {
    if (row.status === 'approved') showToast(`✅ ${row.item} · ₹${row.amount}`);
    renderActive();
  });
  db.channel('worker-bookings')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, (payload) => onBookingChange(payload))
    .subscribe();
  listenMessages((m) => {
    if (m.sender !== 'worker') {
      showToast(`💬 ${t('ph_' + m.phrase)}`);
      ring();
    }
    renderActive();
  });
}

function onBookingChange(payload) {
  const b = payload.new;
  if (!b || !b.id) return;

  // My active job changed (employer paid, etc.)
  if (W.active && b.id === W.active.id && b.status === 'cancelled') {
    // The employer cancelled before work started
    showToast(b.showup_pay ? t('showupForWorker') : `${statusLabel('cancelled')}: ${t(b.type)}, ${b.area}`);
    W.active = null;
    W.employer = null;
    cacheState();
    renderHome();
    return;
  }
  if (W.active && b.id === W.active.id) {
    const wasPaid = W.active.status === 'paid';
    W.active = b;
    cacheState();
    renderActive();
    if (!wasPaid && b.status === 'paid') ring();
  }

  // The request on my screen was taken by someone else or cancelled
  if (W.request && b.id === W.request.id && b.status !== 'searching') {
    closeRequest();
    if (b.worker_id !== W.me.id) showToast(b.status === 'assigned' ? t('takenByOther') : t('requestGone'));
    checkOpenRequests();
  }

  // The employer accepted my counter-offer
  if (W.offers[b.id] && b.status === 'assigned' && b.worker_id === W.me.id && !W.active) {
    delete W.offers[b.id];
    if (W.request) closeRequest();
    W.active = b;
    db.from('employers').select('*').eq('id', b.employer_id).maybeSingle().then(async ({ data }) => {
      W.employer = data;
      await loadMessages(b.id);
      cacheState();
      renderHome();
    });
    showToast(tf('offerAccepted', b.agreed_wage));
    ring();
    return;
  }

  // New job, or a job whose worker could not come (back to searching)
  if (canTake(b) && (payload.eventType === 'INSERT' || b.cancel_reason === 'worker_cancelled')) showRequest(b);
  // Reserved for the employer's favourites: try again when the minute is over
  else if (payload.eventType === 'INSERT' && reservedFor(b)) {
    setTimeout(() => { if (canTake(b)) showRequest(b); }, reservedFor(b) + 500);
  }

  // Jobs for later: refresh the list; tell me about new ones for my skill
  if (b.scheduled_for && W.me && b.type === W.me.skill) {
    if (payload.eventType === 'INSERT' && forMe(b)) {
      showToast(t('newLaterJob'));
      ring();
    }
    loadLaterJobs();
  }
}

function forMe(b) {
  return !b.preferred_worker_id || b.preferred_worker_id === W.me.id;
}

function canTake(b) {
  return W.me && W.me.online && !W.active && !W.request &&
    b.status === 'searching' && b.type === W.me.skill && !W.declined.has(b.id) &&
    !b.scheduled_for && forMe(b) &&
    (!reservedFor(b) || (b.priority_ids || []).includes(W.me.id)) &&
    Date.now() - Date.parse(b.created_at) < SEARCH_SECONDS * 1000;
}

// When going online, pick up requests made in the last 2 minutes
async function checkOpenRequests() {
  if (!W.me || !W.me.online || W.active || W.request || !navigator.onLine) return;
  const since = new Date(Date.now() - SEARCH_SECONDS * 1000).toISOString();
  const { data } = await db.from('bookings').select('*')
    .eq('status', 'searching').eq('type', W.me.skill).is('scheduled_for', null).gte('created_at', since)
    .order('created_at', { ascending: true }).limit(10);
  const next = (data || []).find(canTake);
  if (next) showRequest(next);
}

// ---------- Incoming request popup ----------
function requestSpeech(b, employer) {
  return T[App.lang].speakJob(t(b.type), b, { min: b.wage_min, max: b.wage_max }) +
    (employer ? ` ${t('employer')}: ${employer.name}.` : '');
}

async function showRequest(b) {
  W.request = b;
  const { data: employer } = await db.from('employers').select('*').eq('id', b.employer_id).maybeSingle();
  if (!W.request || W.request.id !== b.id) return; // gone while loading
  W.requestEmployer = employer;
  const km = kmBetween(App.here, b);
  const tags = [
    `⏱️ ${b.hours} ${t('hoursUnit')}`,
    `📦 ${t(b.load)}`,
    b.risky ? `⚠️ ${t('riskyShort')}` : '',
    b.group_size > 1 ? tf('teamJob', b.group_size) : '',
    b.bring_tools ? t('toolsTag') : '',
    travelPayFor(km) ? tf('travelTag', travelPayFor(km)) : '',
    isNightJob(b) ? t('nightTag') : '',
    employer && employer.effort_refused ? tf('effortRefusedCount', employer.effort_refused) : '',
    km !== null ? `📍 ${km.toFixed(1)} km` : ''
  ].filter(Boolean).map((x) => `<span class="tag">${x}</span>`).join('');

  document.getElementById('requestBox').innerHTML = `
    <div class="request-head">
      <span class="badge badge-accepted">${t('newRequest')}</span>
      <svg class="ring" viewBox="0 0 44 44" aria-hidden="true">
        <circle cx="22" cy="22" r="19" class="ring-bg"/>
        <circle cx="22" cy="22" r="19" class="ring-fg" id="ringFg"/>
      </svg>
      <b id="ringText" class="ring-text">${ACCEPT_SECONDS}</b>
    </div>
    <div class="request-main">
      <div class="job-icon">${WORK_TYPES[b.type].icon}</div>
      <div>
        <h3 id="requestTitle">${t(b.type)}</h3>
        <p class="muted">📍 ${esc(b.area)}</p>
      </div>
      <button type="button" class="btn btn-light btn-small listen-btn" data-say="${attr(requestSpeech(b, employer))}">${t('listenJob')}</button>
    </div>
    <div class="request-pay">₹${b.agreed_wage}<small>₹${b.wage_min} – ₹${b.wage_max} ${t('estimate').toLowerCase()}</small></div>
    <div class="tags">${tags}</div>
    ${b.perks && b.perks.length ? `<div class="tags">${perksHTML(b.perks)}</div>` : ''}
    ${b.preferred_worker_id ? `<p class="preferred-note">${t('requestedYou')}</p>` : ''}
    <div class="employer-line">🏢 ${esc(employer ? employer.name : '—')} ${scoreBadge(employer)}${employer && employer.gstin ? ` <span class="trusted">${t('gstVerified')}</span>` : ''}</div>
    ${hostsRestPoint(b.employer_id) ? `<p class="host-note">${t('hostsRest')}</p>` : ''}
    <div id="siteTags"></div>
    ${b.group_size === 1 && offerChoices(b).length ? `
      <div class="offer-row"><span class="muted small">${t('askMore')}</span>
        ${offerChoices(b).map((n) => `<button type="button" class="chip" onclick="makeOffer(${n})">₹${n}</button>`).join('')}
      </div>` : ''}
    <div class="row">
      <button class="btn btn-light btn-big" onclick="declineRequest()">${t('decline')}</button>
      <button class="btn btn-accept btn-big" onclick="acceptRequest()">${t('acceptJob')}</button>
    </div>`;
  document.getElementById('requestModal').classList.add('open');
  ring();
  reviewsOf('employer', b.employer_id).then((counts) => {
    const box = document.getElementById('siteTags');
    if (box && counts.length && W.request && W.request.id === b.id) box.innerHTML = welfareHTML(counts);
  });

  const ends = Date.now() + ACCEPT_SECONDS * 1000;
  const full = 2 * Math.PI * 19;
  clearInterval(W.countdown);
  W.countdown = setInterval(() => {
    const left = Math.max(0, (ends - Date.now()) / 1000);
    const fg = document.getElementById('ringFg');
    if (fg) fg.style.strokeDashoffset = String(full * (1 - left / ACCEPT_SECONDS));
    const txt = document.getElementById('ringText');
    if (txt) txt.textContent = Math.ceil(left);
    if (left <= 0) declineRequest();
  }, 250);
}

// Counter-offer (inDrive): ask for more within the fair range; the employer decides
async function makeOffer(amount) {
  if (!W.request) return;
  const b = W.request;
  const { data, error } = await db.rpc('make_offer', { p_booking: b.id, p_worker: W.me.id, p_amount: amount });
  if (error || !data || !data.id) return showToast(t('requestGone'));
  W.offers[b.id] = amount;
  W.declined.add(b.id); // don't ring again for this job
  closeRequest();
  showToast(tf('offerSent', amount));
  setTimeout(checkOpenRequests, 800);
}

function closeRequest() {
  clearInterval(W.countdown);
  W.request = null;
  closeModal('requestModal');
}

function declineRequest() {
  if (W.request) W.declined.add(W.request.id);
  closeRequest();
  setTimeout(checkOpenRequests, 800);
}

async function acceptRequest() {
  if (!W.request) return;
  const b = W.request;
  const employer = W.requestEmployer;
  const { data, error } = await db.rpc('accept_booking', { p_booking: b.id, p_worker: W.me.id });
  closeRequest();
  if (error || !data || !data.id) {
    showToast(t('takenByOther'));
    return checkOpenRequests();
  }
  if (isLater(data)) {
    // Accepted from a WhatsApp link for a later date: it waits under "My upcoming jobs"
    showToast(tf('acceptedLater', whenText(data)));
    return loadLaterJobs();
  }
  W.active = data;
  W.employer = employer;
  if (isNightJob(data)) showToast(t('nightShare'));
  await loadMessages(W.active.id);
  cacheState();
  renderHome();
}

// ---------- The job I'm doing ----------
async function loadActive() {
  // Open jobs, plus a paid job I have not confirmed yet (proof of pay waits for me)
  const { data } = await db.from('bookings').select('*')
    .eq('worker_id', W.me.id)
    .or('status.in.(assigned,started,completed),and(status.eq.paid,worker_confirmed_at.is.null)')
    .order('accepted_at', { ascending: false }).limit(10);
  W.active = (data || []).find((b) => !(b.status === 'assigned' && isLater(b))) || null;
  W.employer = null;
  if (W.active) {
    const { data: e } = await db.from('employers').select('*').eq('id', W.active.employer_id).maybeSingle();
    W.employer = e;
  }
  await loadMessages(W.active ? W.active.id : null);
  cacheState();
}

function overtimeSoFar(b) {
  const mins = workedMinutes(b);
  return Math.max(0, Math.ceil(mins / 60 - b.hours - 0.25));
}

function renderActive() {
  const box = document.getElementById('activeJob');
  clearInterval(W.workTimer);
  document.getElementById('dutyBlock').hidden = !!W.active;
  // Share my location with the employer while I am on the way (Rapido-style tracking)
  if (W.active && W.active.status === 'assigned' && navigator.onLine) startTracking(sendMyLocation);
  else stopTracking();
  if (!W.active) {
    box.innerHTML = '';
    if (W.jobMarker) { W.jobMarker.remove(); W.jobMarker = null; }
    return;
  }
  const b = W.active;
  const e = W.employer || { name: '—', phone: '' };
  if (Mat.bookingId !== b.id) {
    Mat.bookingId = b.id;
    Mat.list = [];
    loadMaterials(b.id).then(() => renderActive());
  }
  if (W.map && b.lat != null) {
    if (!W.jobMarker) W.jobMarker = L.marker([b.lat, b.lng], { icon: pin(WORK_TYPES[b.type].icon, 'pin-job') }).addTo(W.map);
    W.map.fitBounds([[App.here.lat, App.here.lng], [b.lat, b.lng]], { padding: [40, 40], maxZoom: 15 });
  }
  const amount = amountOf(b);
  let action = '';
  let speech = '';
  if (b.status === 'assigned') {
    speech = t('enterOtp');
    action = `
      ${b.scheduled_for ? `<p><b>${tf('scheduledFor', whenText(b))}</b></p>` : ''}
      <p class="eta">🛵 ${etaText(App.here, b)}</p>
      <div class="row">
        <a class="btn btn-dark" target="_blank" rel="noopener" href="${directionsUrl(b)}">${t('directions')}</a>
        <button class="btn btn-light" onclick="cantCome()">${t('cantCome')}</button>
      </div>
      <label class="otp-label" for="otpInput">${t('enterOtp')} ${speakButton(t('enterOtp'))}</label>
      <input id="otpInput" class="otp-input" inputmode="numeric" maxlength="4" pattern="[0-9]{4}" autocomplete="one-time-code" placeholder="••••">
      <button class="btn btn-accept btn-block btn-big" onclick="startWork()">${t('startWork')}</button>`;
  } else if (b.status === 'started') {
    action = `
      <div class="big-timer"><small>${t('timeWorked')}</small><b id="workClock">0:00</b></div>
      <p id="overtimeLine" class="overtime" hidden></p>
      ${App.isHot ? `<p class="heat-work">${tf('heatAtWork', App.simulateHot ? 40 : App.temp)}</p>
        <button class="btn btn-light btn-block" onclick="reportHeat(W.active.id)">${t('reportHeat')}</button>
        <div class="heat-help"></div>` : ''}
      <button class="btn btn-primary btn-block btn-big" onclick="completeWork()">${t('completeJob')}</button>`;
  } else if (b.status === 'completed') {
    speech = tf('waitingPayment', amount + approvedMaterials());
    action = `<p class="wait-pay"><span class="pulse-dot"></span>${tf('waitingPayment', amount + approvedMaterials())} ${speakButton(speech)}</p>
      ${b.overtime_hours ? `<p class="overtime">${t('overtimeLabel')}: ${b.overtime_hours} h · +₹${80 * b.overtime_hours}</p>` : ''}
      ${b.travel_pay ? `<p class="small">${tf('travelTag', b.travel_pay)}</p>` : ''}
      ${b.rain_off ? `<p class="overtime">${tf('rainNote', amount)}</p>` : ''}
      ${W.me.upi_id ? `<button class="btn btn-upi btn-block btn-big" onclick="showUpiQR(W.active, W.me, amountOf(W.active) + approvedMaterials())">${tf('myUpiQrBtn', amount + approvedMaterials())}</button>`
        : `<p class="muted small">${t('noUpiYet')}</p>`}
      <button class="btn btn-dark btn-block" onclick="scanQR()">${t('qrScanBtn')}</button>`;
  } else if (b.status === 'paid' && !b.worker_confirmed_at) {
    // Proof of pay: the worker has the final word
    speech = tf('employerSaysPaid', amount);
    action = `
      <div class="confirm-pay">
        <p><b>${tf('employerSaysPaid', amount)}</b> ${speakButton(speech)}</p>
        ${b.tip ? `<p class="tip-note">${tf('tipReceived', b.tip)}</p>` : ''}
        ${b.disputed ? `<p class="dispute-note">⚠️ ${t('disputedNote')}</p>
          <a class="btn btn-light btn-block" target="_blank" rel="noopener" href="${disputeLink(b)}">${t('evidence')}</a>` : ''}
        <div class="row">
          <button class="btn btn-accept btn-big" onclick="confirmPay(true)">${t('yesReceived')}</button>
          ${b.disputed ? '' : `<button class="btn btn-light btn-big" onclick="confirmPay(false)">${t('notReceived')}</button>`}
        </div>
      </div>`;
  } else if (b.status === 'paid') {
    action = `<p class="paid-ok">✅ ${tf('paymentReceived', amount)}</p>
      ${b.tip ? `<p class="tip-note">${tf('tipReceived', b.tip)}</p>` : ''}
      <button class="btn btn-dark btn-block" onclick="openSlip(W.active, W.employer, W.me)">${t('viewSlip')}</button>
      <button class="btn btn-light btn-block" onclick="finishJob()">${t('backHome')}</button>`;
  }
  const rate = (b.status === 'completed' || b.status === 'paid') && !b.rating_by_worker
    ? `<button class="btn btn-primary btn-block" onclick="rateEmployer()">⭐ ${t('rateEmployerShort')}</button>` : '';

  box.innerHTML = `
    <div class="card job-live">
      ${stepperHTML(b.status)}
      <div class="request-main">
        <div class="job-icon">${WORK_TYPES[b.type].icon}</div>
        <div><h3>${t(b.type)}</h3><p class="muted">📍 ${esc(b.area)} · ⏱️ ${b.hours} ${t('hoursUnit')}</p></div>
        <div class="pay-chip">₹${amount}</div>
      </div>
      <div class="person">
        <div class="avatar">${esc((e.name || '?').slice(0, 1).toUpperCase())}</div>
        <div><b>${esc(e.name)}</b><div>${scoreBadge(e)}</div></div>
        ${e.phone ? `<a class="icon-btn" href="tel:${e.phone}" aria-label="${t('call')}">📞</a>
        <a class="icon-btn wa" target="_blank" rel="noopener" href="https://wa.me/91${e.phone}" aria-label="${t('whatsapp')}">💬</a>` : ''}
      </div>
      ${action}
      ${effortHTML('worker', b)}
      ${['started', 'completed'].includes(b.status) ? materialsHTML('worker', b.status) : ''}
      ${rate}
      ${b.status !== 'paid' || !b.worker_confirmed_at ? messagesHTML('worker', e.name) : ''}
      <div class="row">
        <button class="btn btn-light" onclick="show('safety')">${t('nearbyBtn')}</button>
        <button class="btn btn-light" onclick="shareOnWhatsApp(agreementText(W.active, (W.employer || {}).name || '', W.me.name))">${t('shareAgreement')}</button>
      </div>
      ${['assigned', 'started'].includes(b.status) ? `<button class="btn btn-whatsapp btn-block" onclick="shareWithFamily(W.active, W.employer, W.me)">${t('shareFamily')}</button>` : ''}
    </div>`;

  if (b.status === 'started' && b.started_at) {
    const tick = () => {
      const el = document.getElementById('workClock');
      if (el) el.textContent = clock((Date.now() - Date.parse(b.started_at)) / 1000);
      const ot = document.getElementById('overtimeLine');
      const extra = overtimeSoFar(b);
      // Heat alert: on a hot day, a water break reminder every hour of work
      const hour = Math.floor(workedMinutes(b) / 60);
      if (App.isHot && hour >= 1 && W.breakHour !== hour) {
        W.breakHour = hour;
        showToast(t('breakNow'));
        speak(t('breakNow'));
        ring();
      }
      if (ot) {
        ot.hidden = !extra;
        ot.textContent = extra ? `⏰ ${tf('overtimeLive', extra)}` : '';
      }
    };
    tick();
    W.workTimer = setInterval(tick, 1000);
  }
}

// Each action works offline: it is saved and sent when the internet is back
async function startWork() {
  const otp = document.getElementById('otpInput').value.trim();
  if (!/^\d{4}$/.test(otp)) return showToast(t('wrongOtp'));
  Store.set('otp_' + W.active.id, otp); // lets this phone check the employer's pay QR offline
  await new Promise((resolve) => locate(() => resolve()));
  const r = await callAction('start_at_site', {
    p_booking: W.active.id, p_worker: W.me.id, p_otp: otp, p_lat: App.here.lat, p_lng: App.here.lng
  });
  if (r.queued) return localUpdate({ status: 'started', started_at: new Date().toISOString() });
  if (r.error) return showToast(t('saveError'));
  if (r.data === 'too_far') return showToast(t('tooFar'));
  if (r.data === 'locked') return showToast(t('otpLocked'));
  if (r.data !== 'ok') return showToast(t('wrongOtp'));
  showToast(t('checkedIn'));
  await refreshActive();
}

async function completeWork() {
  const r = await callAction('complete_booking', { p_booking: W.active.id, p_worker: W.me.id });
  if (r.queued) {
    const extra = overtimeSoFar(W.active);
    return localUpdate({ status: 'completed', completed_at: new Date().toISOString(),
      overtime_hours: extra, paid_amount: W.active.agreed_wage + 80 * extra });
  }
  if (r.error || !r.data) return showToast(t('saveError'));
  await refreshActive();
}

async function confirmPay(received) {
  const r = await callAction('confirm_payment', { p_booking: W.active.id, p_worker: W.me.id, p_received: received });
  if (r.queued) return localUpdate(received ? { worker_confirmed_at: new Date().toISOString() } : { disputed: true });
  if (r.error || !r.data || !r.data.id) return showToast(t('saveError'));
  W.active = r.data;
  cacheState();
  renderActive();
  loadEarnings();
  if (received) openSlip(W.active, W.employer, W.me);
}

function sendMyLocation() {
  if (!W.me || !navigator.onLine) return;
  db.from('workers').update({ lat: App.here.lat, lng: App.here.lng }).eq('id', W.me.id).then(() => {});
  if (W.meMarker) W.meMarker.setLatLng([App.here.lat, App.here.lng]);
  const eta = document.querySelector('#activeJob .eta');
  if (eta && W.active) eta.textContent = `🛵 ${etaText(App.here, W.active)}`;
}

// Can't come (Rapido captain cancel): the job goes back to other workers
async function cantCome(id) {
  if (!confirm(t('cantComeConfirm'))) return;
  const bookingId = id || W.active.id;
  const { data, error } = await db.rpc('worker_cancel', { p_booking: bookingId, p_worker: W.me.id });
  if (error || !data) return showToast(t('saveError'));
  W.declined.add(bookingId);
  if (W.active && W.active.id === bookingId) {
    W.active = null;
    W.employer = null;
    Msg.bookingId = null;
    Msg.list = [];
    cacheState();
  }
  renderHome();
}

// ---------- Jobs for later (Urban Company-style scheduled jobs) ----------
async function loadLaterJobs() {
  if (!W.me || !navigator.onLine) return renderLaterJobs();
  const nowIso = new Date().toISOString();
  const [open, mine] = await Promise.all([
    db.from('bookings').select('*').eq('status', 'searching').eq('type', W.me.skill)
      .gt('scheduled_for', nowIso).order('scheduled_for').limit(10),
    db.from('bookings').select('*').eq('status', 'assigned').eq('worker_id', W.me.id)
      .not('scheduled_for', 'is', null).order('scheduled_for').limit(10)
  ]);
  W.later = (open.data || []).filter(forMe);
  W.upcoming = (mine.data || []).filter(isLater);
  renderLaterJobs();
}

function laterCard(b, mine) {
  const km = kmBetween(App.here, b);
  return `
    <div class="mini-card">
      <div>
        <b>${WORK_TYPES[b.type].icon} ${t(b.type)}</b> · ${esc(b.area)}<br>
        <b class="small">${tf('scheduledFor', whenText(b))}</b><br>
        <span class="muted small">⏱️ ${b.hours} ${t('hoursUnit')}${km !== null ? ` · 📍 ${km.toFixed(1)} km` : ''}</span>
        ${b.preferred_worker_id ? `<br><span class="small">${t('requestedYou')}</span>` : ''}
      </div>
      <div class="actions">
        <b class="pay-chip">₹${b.agreed_wage}</b>
        ${mine ? `<button class="btn btn-light btn-small" onclick="cantCome('${b.id}')">${t('cantCome')}</button>`
          : `<button class="btn btn-accept btn-small" onclick="acceptLater('${b.id}')">${t('acceptLater')}</button>`}
      </div>
    </div>`;
}

function renderLaterJobs() {
  const box = document.getElementById('laterJobs');
  if (!box || !W.me) return;
  box.innerHTML = `
    ${W.upcoming.length ? `<h3>${t('myUpcoming')}</h3>${W.upcoming.map((b) => laterCard(b, true)).join('')}` : ''}
    <h3>${t('laterJobsTitle')}</h3>
    ${W.later.length ? W.later.map((b) => laterCard(b, false)).join('') : `<p class="muted small">${t('noLaterJobs')}</p>`}`;
}

async function acceptLater(id) {
  const { data, error } = await db.rpc('accept_booking', { p_booking: id, p_worker: W.me.id });
  if (error || !data || !data.id) {
    showToast(t('takenByOther'));
    return loadLaterJobs();
  }
  showToast(tf('acceptedLater', whenText(data)));
  loadLaterJobs();
}

// QR proof of pay: scan the employer's QR; checked on this phone with the OTP, so it works offline
function scanQR() {
  scanPayQR(async (text) => {
    closeQR();
    let p = null;
    try { p = JSON.parse(text); } catch (e) { /* not ours */ }
    if (/^upi:/i.test(text)) return showToast(t('qrIsUpi'));
    const b = W.active;
    if (!b || !p || p.wb !== 1 || !p.a || (p.b && p.b !== b.id)) return showToast(t('qrWrong'));
    const otp = Store.get('otp_' + b.id, null);
    if (otp && (await payCode(otp, p.a, b.id)) !== p.c) return showToast(t('qrWrong'));
    const r = await callAction('confirm_by_qr', { p_booking: b.id, p_worker: W.me.id, p_amount: p.a, p_code: p.c });
    if (r.queued) {
      const now = new Date().toISOString();
      localUpdate({ status: 'paid', paid_amount: p.a, paid_at: now, worker_confirmed_at: now,
        receipt_no: 'WB-' + b.id.replace(/-/g, '').slice(0, 8).toUpperCase() });
      showToast(t('qrSavedOffline'));
      return openSlip(W.active, W.employer, W.me);
    }
    if (r.error || !r.data || !r.data.id) return showToast(t('qrWrong'));
    W.active = r.data;
    cacheState();
    renderActive();
    loadEarnings();
    showToast(tf('qrOk', p.a));
    openSlip(W.active, W.employer, W.me);
  });
}

function localUpdate(changes) {
  W.active = { ...W.active, ...changes };
  cacheState();
  renderActive();
}

async function refreshActive() {
  if (!navigator.onLine || !W.active) return;
  const { data } = await db.from('bookings').select('*').eq('id', W.active.id).single();
  if (data) W.active = data;
  cacheState();
  renderActive();
}

function rateEmployer() {
  openStars(t('rateEmployerTitle'), async (stars, tags) => {
    await callAction('review_booking', { p_booking: W.active.id, p_by: 'worker', p_stars: stars, p_tags: tags });
    W.active.rating_by_worker = stars;
    await refreshActive();
  }, REVIEW_TAGS.employer);
}

async function finishJob() {
  W.active = null;
  W.employer = null;
  Msg.bookingId = null;
  Msg.list = [];
  try { await loadMe(); } catch (e) { /* offline: keep saved profile */ }
  cacheState();
  renderHome();
  checkOpenRequests();
}

// ---------- Wage record (Earnings) ----------
async function loadRecords() {
  if (!navigator.onLine) {
    W.records = Store.get('w_records', []);
    return;
  }
  const { data } = await db.from('bookings').select('*').eq('worker_id', W.me.id)
    .order('created_at', { ascending: false }).limit(100);
  const list = data || [];
  const ids = [...new Set(list.map((b) => b.employer_id))];
  const { data: emps } = ids.length ? await db.from('employers').select('id,name,phone').in('id', ids) : { data: [] };
  list.forEach((b) => {
    const e = (emps || []).find((x) => x.id === b.employer_id) || {};
    b.employer_name = e.name || '';
    b.employer_phone = e.phone || '';
  });
  W.records = list;
  Store.set('w_records', list);
  Store.set('w_slips', list.filter((b) => b.worker_confirmed_at));
}

function slips() {
  return W.records.filter((b) => b.worker_confirmed_at);
}

// Shows the saved copy at once (works offline), then refreshes from the database
async function renderEarnings() {
  if (!W.records.length) W.records = Store.get('w_records', []);
  drawEarnings();
  await loadRecords();
  drawEarnings();
}

function drawEarnings() {
  const confirmed = slips();
  const totals = periodTotals(confirmed);
  const disputed = W.records.filter((b) => b.disputed && !b.worker_confirmed_at);
  document.getElementById('earningsSummary').innerHTML = `
    <div class="stats stats-3">
      <div><small>${t('thisWeek')}</small><b>₹${totals.week}</b></div>
      <div><small>${t('thisMonth')}</small><b>₹${totals.month}</b></div>
      <div><small>${t('allTime')}</small><b>₹${totals.all}</b></div>
    </div>
    ${impactHTML(confirmed)}
    ${W.records.some((b) => b.showup_pay) ? `<p class="small">🚶 ${t('showupLabel')}: ₹${W.records.filter((b) => b.showup_paid_at).reduce((s, b) => s + b.showup_pay, 0)}${W.records.some((b) => b.showup_pay && !b.showup_paid_at) ? ' · ' + tf('showupOwed', W.records.filter((b) => b.showup_pay && !b.showup_paid_at).reduce((s, b) => s + b.showup_pay, 0)) : ''}</p>` : ''}
    <p class="muted small">✅ ${t('confirmedPayments')}: ${confirmed.length} · ⚠️ ${t('disputedPayments')}: ${disputed.length}</p>
    <div class="row">
      <button class="btn btn-dark" onclick="openStatement(W.me, slips())">${t('downloadStatement')}</button>
      <button class="btn btn-light" onclick="downloadCSV(W.me, slips())">${t('downloadCsv')}</button>
    </div>`;

  const box = document.getElementById('historyList');
  if (!W.records.length) {
    box.innerHTML = `<p class="muted">${t('noHistory')}</p>`;
    return;
  }
  box.innerHTML = W.records.map((b, i) => {
    let label = statusLabel(b.status);
    let cls = 'accepted';
    if (b.worker_confirmed_at) { label = '✅ ' + t('paySlip'); cls = 'open'; }
    else if (b.disputed) { label = '⚠️ ' + t('statusDisputed'); cls = 'disputed'; }
    return `
    <div class="mini-card">
      <div>
        <b>${WORK_TYPES[b.type].icon} ${t(b.type)}</b> · ${esc(b.area)}<br>
        <span class="muted small">🏢 ${esc(b.employer_name || '—')} · ${timeAgo(b.created_at)}</span><br>
        <span class="badge badge-${cls}">${label}</span>
        ${b.rating_by_worker ? `<span class="stars-small">${'★'.repeat(b.rating_by_worker)}</span>` : ''}
      </div>
      <div class="actions">
        <b class="pay-chip">₹${amountOf(b)}</b>
        ${b.worker_confirmed_at ? `<button class="btn btn-light btn-small" onclick="openRecordSlip(${i})">🧾</button>` : ''}
        ${b.disputed || b.worker_confirmed_at ? `<a class="btn btn-light btn-small" target="_blank" rel="noopener" href="${disputeLink(b)}">⚖️</a>` : ''}
      </div>
    </div>`;
  }).join('');
}

function openRecordSlip(i) {
  const b = W.records[i];
  openSlip(b, { name: b.employer_name, phone: b.employer_phone }, W.me);
}

// ---------- Start ----------
App.onLang = () => {
  applyLang();
  fillSelect(document.getElementById('skillSelect'), W.me ? W.me.skill : 'coolie');
  renderHeatBanners();
  renderRestList();
  renderPlacesNote();
  renderSchemes(Store.get('schemeAnswers', null));
  renderOfflineBanner();
  renderHelper();
  renderServicesCard();
  renderSharedPhone();
  renderToolChecks(W.me ? W.me.tools : []);
  if (W.me) { renderLessons(); renderCover(); }
  if (W.me) renderHome();
  if (document.getElementById('earnings').classList.contains('active')) renderEarnings();
};
App.onShow = (id) => {
  if (id === 'earnings' && W.me) renderEarnings();
  if (id === 'crew' && W.me) renderCrewBook();
  if (id === 'schemes' && W.me) { renderLessons(); renderCover(); }
  if (id === 'home' && W.map) setTimeout(() => W.map.invalidateSize(), 50);
};
App.onHeat = () => {};
App.onMove = () => { if (W.me && W.me.online && navigator.onLine) db.from('workers').update({ lat: App.here.lat, lng: App.here.lng }).eq('id', W.me.id); };
App.onMessages = () => renderActive();
App.onMaterials = () => renderActive();
App.onSynced = async () => {
  await refreshActive();
  if (W.me) renderHome();
};

// ---------- A job shared on WhatsApp: /worker/?job=<id> ----------
async function openJobLink() {
  const id = new URLSearchParams(location.search).get('job');
  if (!id || !W.me || !navigator.onLine) return;
  history.replaceState(null, '', location.pathname);
  let { data: b } = await db.from('bookings').select('*').eq('id', id).maybeSingle();
  // Team job: if this place is taken, offer another open place in the same team
  if (b && b.status !== 'searching' && b.group_id) {
    const { data: open } = await db.from('bookings').select('*').eq('group_id', b.group_id).eq('status', 'searching').limit(1);
    if (open && open[0]) b = open[0];
  }
  if (!b || b.status !== 'searching' || (b.preferred_worker_id && b.preferred_worker_id !== W.me.id)) return showToast(t('jobClosed'));
  if (b.type !== W.me.skill) return showToast(tf('jobOtherSkill', t(b.type)));
  if (W.active && !b.scheduled_for) return showToast(t('finishCurrentFirst'));
  if (!b.scheduled_for && !W.me.online) await toggleDuty(); // tapping a job link means "I'm available"
  if (W.request && W.request.id !== b.id) closeRequest();
  showRequest(b);
}

// ---------- Voice commands (deck: voice-first) ----------
// Returns true when the command did something; otherwise the app reads out the help
App.onVoice = (cmd, digits) => {
  if (!W.me) return false;
  const b = W.active;
  if (digits.length === 4 && b && b.status === 'assigned') {
    document.getElementById('otpInput').value = digits;
    startWork();
    return true;
  }
  if (cmd === 'accept' && W.request) { acceptRequest(); return true; }
  if (cmd === 'decline' && W.request) { declineRequest(); return true; }
  if (cmd === 'online' && !W.me.online) { toggleDuty(); return true; }
  if (cmd === 'offline' && W.me.online && !b) { toggleDuty(); return true; }
  if (cmd === 'complete' && b && b.status === 'started') { completeWork(); return true; }
  if (cmd === 'received' && b && b.status === 'paid' && !b.worker_confirmed_at) { confirmPay(true); return true; }
  if (cmd === 'read') {
    if (W.request) speak(requestSpeech(W.request, W.requestEmployer));
    else if (b) speak(`${t(b.type)}, ${b.area}. ${statusLabel(b.status)}. ₹${amountOf(b)}`);
    else speak(W.me.online ? t('onlineWaiting') : t('offlineHint'));
    return true;
  }
  return false;
};

async function init() {
  initLangSelect();
  applyLang();
  registerOffline();
  fillSelect(document.getElementById('skillSelect'), 'coolie');
  document.getElementById('onboardForm').addEventListener('submit', saveProfile);
  document.querySelectorAll('.bottom-nav button').forEach((b) => b.addEventListener('click', () => show(b.dataset.go)));
  document.querySelectorAll('.modal:not(.request-modal)').forEach((m) => m.addEventListener('click', (e) => {
    if (e.target === m) m.classList.remove('open');
  }));
  initSafety();
  renderHelper();
  renderServicesCard();
  renderSharedPhone();
  renderToolChecks([]);
  loadHostPoints();
  renderRestList();
  renderPlacesNote();
  renderSchemes(Store.get('schemeAnswers', null));
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
  initAccount(() => !!W.me, () => location.reload());
  if (offline) {
    // No internet: open with the saved copy so pay slips and the wage record still work
    W.me = Store.get('w_me', null);
    W.active = Store.get('w_active', null);
    W.employer = Store.get('w_employer', null);
    if (!W.me) return enterOnboarding(true);
    show('home');
    W.map = heroMap('heroMap');
    renderHome();
    window.addEventListener('online', () => location.reload(), { once: true });
    return;
  }
  if (!W.me) {
    enterOnboarding(true);
    return;
  }
  if (W.me.lat != null) App.here = { lat: W.me.lat, lng: W.me.lng };
  show('home');
  W.map = heroMap('heroMap');
  await loadActive();
  renderHome();
  listen();
  flushQueue();
  checkOpenRequests();
  openJobLink();
  loadRecords(); // keeps the offline copy of the wage record fresh
  setInterval(async () => {
    if (!W.active && W.upcoming.some((b) => !isLater(b))) {
      await loadActive();
      renderHome();
    }
  }, 60000);
}

// Road distance arrived: redraw the arrival line
window.addEventListener('wb-eta', () => {
  const eta = document.querySelector('#activeJob .eta');
  if (eta && W.active) eta.textContent = `🛵 ${etaText(App.here, W.active)}`;
});

init();
