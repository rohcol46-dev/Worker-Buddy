// extras.js — features borrowed from Rapido, Urban Company and job apps, shared by both apps:
//   live tracking with arrival time (Rapido), worker can't come -> find another (Rapido),
//   schedule for later (Urban Company), worker profiles with review tags (Urban Company),
//   choose or rebook a worker (Urban Company), tips (Rapido / Urban Company),
//   share job with family (Rapido "share ride")
// Load after lang-hi.js. Owner: Member 2, with Member 1

// Quick review tags. Workers also review the work site, so the next worker
// sees "💧 Gave water ×3" before accepting.
const REVIEW_TAGS = {
  worker: ['onTime', 'skilled', 'hardWorking', 'polite', 'cleanWork'],
  employer: ['paidOnTime', 'gaveWater', 'gaveShade', 'respectful', 'safeSite']
};
const TAG_ICONS = {
  onTime: '⏰', skilled: '🛠️', hardWorking: '💪', polite: '🙏', cleanWork: '✨',
  paidOnTime: '💰', gaveWater: '💧', gaveShade: '⛱️', respectful: '🤝', safeSite: '🦺'
};
const TIPS = [0, 20, 50, 100];
const SPEED_KMH = 15;          // mix of walking, bus and two-wheeler in the city
const LATER_MIN_MINUTES = 60;  // "later" bookings are at least an hour ahead

// ---------- Arrival time and directions (Rapido) ----------
// Arrival time: road distance from the free OSRM router (no key), at city speed.
// Until the road answer arrives (or if it fails), the straight-line distance is used.
const Road = { cache: {}, asking: {} };
function roadKey(from, to) {
  return [from.lat, from.lng, to.lat, to.lng].map((x) => Number(x).toFixed(3)).join(',');
}
function askRoad(from, to, key) {
  if (Road.asking[key] || !navigator.onLine) return;
  Road.asking[key] = true;
  fetch(`https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=false`,
    { signal: AbortSignal.timeout(8000) })
    .then((r) => r.json())
    .then((j) => {
      const m = j.routes && j.routes[0] && j.routes[0].distance;
      if (m) {
        Road.cache[key] = { km: m / 1000, at: Date.now() };
        window.dispatchEvent(new Event('wb-eta')); // apps redraw their arrival line
      }
    })
    .catch(() => {})
    .finally(() => setTimeout(() => { delete Road.asking[key]; }, 60000)); // ask again at most once a minute
}
function etaText(from, to) {
  const line = kmBetween(from, to);
  if (line === null) return '';
  const key = roadKey(from, to);
  const hit = Road.cache[key];
  if (!hit || Date.now() - hit.at > 120000) askRoad(from, to, key);
  const km = hit ? hit.km : line;
  const min = Math.max(2, Math.round((km / SPEED_KMH) * 60 + 2));
  return tf('etaLine', km.toFixed(1), min) + (hit ? ` · ${t('byRoad')}` : '');
}
Object.assign(T.en, { byRoad: 'by road' });
Object.assign(T.ta, { byRoad: 'சாலை வழி' });
Object.assign(T.hi, { byRoad: 'सड़क से' });

function directionsUrl(b) {
  return mapsDirections(b, false);
}

// Worker phone sends its position every 10 seconds while going to the job
const Track = { watch: null, last: 0 };
function startTracking(onMove) {
  if (Track.watch !== null || !navigator.geolocation) return;
  Track.watch = navigator.geolocation.watchPosition((pos) => {
    App.here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    if (Date.now() - Track.last < 10000) return;
    Track.last = Date.now();
    onMove();
  }, () => {}, { enableHighAccuracy: true, maximumAge: 5000 });
}
function stopTracking() {
  if (Track.watch !== null) navigator.geolocation.clearWatch(Track.watch);
  Track.watch = null;
}

// ---------- Schedule for later (Urban Company) ----------
// A job counts as "later" while it is more than an hour away
function isLater(b) {
  return !!(b && b.scheduled_for) && Date.parse(b.scheduled_for) - Date.now() > LATER_MIN_MINUTES * 60000;
}

function whenText(b) {
  return b.scheduled_for ? fmtDateTime(b.scheduled_for) : t('now');
}

// Value for <input type="datetime-local">, in the phone's own time zone
function toLocalInput(d) {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
function tomorrowNine() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return toLocalInput(d);
}

// ---------- Profiles and reviews (Urban Company) ----------
function isTrusted(w) {
  return !!w && w.rating_count >= 3 && w.rating_sum / w.rating_count >= 4;
}
function trustedBadge(w) {
  return isTrusted(w) ? `<span class="trusted">✔ ${t('trusted')}</span>` : '';
}

function tagChipsHTML(counts, limit) {
  if (!counts.length) return `<span class="muted small">${t('noReviews')}</span>`;
  return counts.slice(0, limit || 5).map(([k, n]) =>
    `<span class="tag">${TAG_ICONS[k] || ''} ${t('tag_' + k)} ×${n}</span>`).join('');
}

// Counted by the database: other people's jobs are not readable from the app
async function reviewsOf(kind, id) {
  const { data } = await db.rpc('review_tags', { p_kind: kind, p_id: id });
  return (data || []).map((r) => [r.tag, r.n]);
}

function workerProfileHTML(w, counts, km) {
  return `
    <div class="profile-head">
      <div class="avatar avatar-big">${esc((w.name || '?').slice(0, 1).toUpperCase())}</div>
      <div>
        <h3>${esc(w.name)} ${trustedBadge(w)}</h3>
        <p class="muted">${WORK_TYPES[w.skill].icon} ${t(w.skill)} · ${tf('expYears', w.experience_years || 0)}</p>
        <p class="small">${w.online ? `<span class="pulse-dot"></span>${t('onlineNow')}` : `⚪ ${t('offlineNow')}`}</p>
      </div>
    </div>
    ${skillBadgesHTML(w)}
    ${(w.tools || []).length ? `<div class="tags">${toolsHTML(w.tools)}</div>` : ''}
    ${w.home_state ? `<p class="small">${tf('migrantFrom', esc(w.home_state))}</p>` : ''}
    <div class="stats stats-3">
      <div><small>${t('ratingLabel')}</small><b>${workerStars(w)}</b></div>
      <div><small>${t('jobsDone')}</small><b>${w.jobs_done || 0}</b></div>
      <div><small>${t('distanceLabel')}</small><b>${km !== null ? km.toFixed(1) + ' km' : '—'}</b></div>
    </div>
    <b>${t('whatEmployersSay')}</b>
    <div class="tags">${tagChipsHTML(counts)}</div>`;
}

// ---------- Share job with family (Rapido "share ride details") ----------
function shareWithFamily(b, employer, worker) {
  const lines = [
    `👷 ${worker ? worker.name : ''}: ${t('familyMsgTitle')}`,
    `${t('work')}: ${t(b.type)}, ${b.area}`,
    `${t('employer')}: ${employer ? employer.name : ''}${employer && employer.phone ? ' · ' + employer.phone : ''}`,
    b.started_at ? `${t('startedAt')}: ${fmtDateTime(b.started_at)}` : '',
    `⏱️ ${b.hours} ${t('hoursUnit')}`,
    b.lat != null ? `📍 https://maps.google.com/?q=${b.lat},${b.lng}` : ''
  ];
  shareOnWhatsApp(lines.filter(Boolean).join('\n'));
}

// ---------- Text ----------
const TAG_TEXT = {
  en: {
    tag_onTime: 'On time', tag_skilled: 'Skilled', tag_hardWorking: 'Hard working', tag_polite: 'Polite', tag_cleanWork: 'Clean work',
    tag_paidOnTime: 'Paid on time', tag_gaveWater: 'Gave water', tag_gaveShade: 'Shade / rest given', tag_respectful: 'Respectful', tag_safeSite: 'Safe site'
  },
  ta: {
    tag_onTime: 'சரியான நேரம்', tag_skilled: 'திறமையானவர்', tag_hardWorking: 'கடின உழைப்பு', tag_polite: 'மரியாதையானவர்', tag_cleanWork: 'சுத்தமான வேலை',
    tag_paidOnTime: 'சரியான நேரத்தில் சம்பளம்', tag_gaveWater: 'தண்ணீர் கொடுத்தார்', tag_gaveShade: 'நிழல் / ஓய்வு கொடுத்தார்', tag_respectful: 'மரியாதையாக நடத்தினார்', tag_safeSite: 'பாதுகாப்பான இடம்'
  },
  hi: {
    tag_onTime: 'समय पर', tag_skilled: 'हुनरमंद', tag_hardWorking: 'मेहनती', tag_polite: 'विनम्र', tag_cleanWork: 'साफ़ काम',
    tag_paidOnTime: 'समय पर पैसे', tag_gaveWater: 'पानी दिया', tag_gaveShade: 'छाया / आराम दिया', tag_respectful: 'इज़्ज़त से बात', tag_safeSite: 'सुरक्षित जगह'
  }
};

Object.assign(T.en, TAG_TEXT.en, {
  etaLine: (km, min) => `${km} km away · about ${min} min`,
  directions: '🧭 Directions',
  cantCome: '❌ Can’t come',
  cantComeConfirm: 'Cancel this job? The employer will be sent another worker.',
  workerCantCome: 'The worker could not come. Finding another worker for you…',
  prevWorkerCancelled: 'The first worker could not come. Searching again.',
  cancelJob: 'Cancel job',
  cancelConfirm: 'Cancel this booking?',
  whenLabel: 'When',
  now: 'Now',
  later: 'Later',
  laterTooSoon: 'Pick a time at least 1 hour from now',
  scheduledBooked: (when) => `Booked for ${when}. We will tell you when a worker accepts.`,
  scheduledFor: (when) => `📅 For ${when}`,
  waitingAccept: 'Waiting for a worker to accept',
  laterAccepted: (name, when) => `${name} accepted your job for ${when}`,
  upcomingTitle: '📅 Upcoming',
  chooseWorker: 'Choose a worker (optional)',
  requestingOnly: (name) => `Only ${name} will get this request.`,
  sendToAll: 'Send to everyone instead',
  sendToAllBtn: 'Send to all nearby workers',
  requestThis: (name) => `Request ${name}`,
  preferredOffline: (name) => `${name} is offline now. Book for later, or send to everyone.`,
  expYears: (n) => `${n} yr experience`,
  experience: 'Years of experience',
  trusted: 'Trusted',
  ratingLabel: 'Rating',
  distanceLabel: 'Distance',
  onlineNow: 'Online now',
  offlineNow: 'Offline',
  whatEmployersSay: 'What employers say',
  whatWorkersSay: 'What workers say about this site',
  noReviews: 'No reviews yet',
  requestedYou: '🎯 Requested you by name',
  laterJobsTitle: '📅 Jobs for later',
  myUpcoming: '📅 My upcoming jobs',
  noLaterJobs: 'No jobs for later right now.',
  acceptLater: 'Accept',
  acceptedLater: (when) => `Job accepted for ${when}. Please be on time!`,
  newLaterJob: 'New job for later 📅',
  addTip: 'Add a tip (optional)',
  noTip: 'No tip',
  tipLabel: 'Tip',
  tipReceived: (n) => `🎉 Tip from the employer: ₹${n}`,
  shareFamily: '👪 Share with family',
  familyMsgTitle: 'I am at work. Job details:',
  startedAt: 'Started',
  bookAgainWorker: '🔁 Book again',
  reviewHint: 'What was good? (optional)'
});

Object.assign(T.ta, TAG_TEXT.ta, {
  etaLine: (km, min) => `${km} கி.மீ தூரம் · சுமார் ${min} நிமிடம்`,
  directions: '🧭 வழி',
  cantCome: '❌ வர முடியாது',
  cantComeConfirm: 'இந்த வேலையை ரத்து செய்யவா? முதலாளிக்கு வேறு வேலையாள் அனுப்பப்படுவார்.',
  workerCantCome: 'வேலையாளால் வர முடியவில்லை. உங்களுக்கு வேறு வேலையாளைத் தேடுகிறோம்…',
  prevWorkerCancelled: 'முதல் வேலையாளால் வர முடியவில்லை. மீண்டும் தேடுகிறோம்.',
  cancelJob: 'வேலையை ரத்து செய்',
  cancelConfirm: 'இந்த புக்கிங்கை ரத்து செய்யவா?',
  whenLabel: 'எப்போது',
  now: 'இப்போது',
  later: 'பின்னர்',
  laterTooSoon: 'இப்போதிலிருந்து குறைந்தது 1 மணி நேரம் கழித்த நேரத்தைத் தேர்வு செய்யுங்கள்',
  scheduledBooked: (when) => `${when}க்கு புக் ஆனது. வேலையாள் ஏற்றதும் சொல்வோம்.`,
  scheduledFor: (when) => `📅 ${when}க்கு`,
  waitingAccept: 'வேலையாள் ஏற்கக் காத்திருக்கிறோம்',
  laterAccepted: (name, when) => `${when} வேலையை ${name} ஏற்றுக்கொண்டார்`,
  upcomingTitle: '📅 வரவிருக்கும் வேலைகள்',
  chooseWorker: 'வேலையாளைத் தேர்வு செய்யுங்கள் (விருப்பம்)',
  requestingOnly: (name) => `${name}க்கு மட்டும் இந்த கோரிக்கை போகும்.`,
  sendToAll: 'அனைவருக்கும் அனுப்பு',
  sendToAllBtn: 'அருகிலுள்ள அனைவருக்கும் அனுப்பு',
  requestThis: (name) => `${name}ஐ கேள்`,
  preferredOffline: (name) => `${name} இப்போது ஆஃப்லைன். பின்னருக்கு புக் செய்யுங்கள் அல்லது அனைவருக்கும் அனுப்புங்கள்.`,
  expYears: (n) => `${n} ஆண்டு அனுபவம்`,
  experience: 'அனுபவம் (ஆண்டுகள்)',
  trusted: 'நம்பகமானவர்',
  ratingLabel: 'மதிப்பீடு',
  distanceLabel: 'தூரம்',
  onlineNow: 'இப்போது ஆன்லைன்',
  offlineNow: 'ஆஃப்லைன்',
  whatEmployersSay: 'முதலாளிகள் சொல்வது',
  whatWorkersSay: 'இந்த இடம் பற்றி வேலையாட்கள் சொல்வது',
  noReviews: 'இன்னும் கருத்துகள் இல்லை',
  requestedYou: '🎯 உங்களைப் பெயர் சொல்லிக் கேட்டார்',
  laterJobsTitle: '📅 பின்னர் செய்யும் வேலைகள்',
  myUpcoming: '📅 என் வரவிருக்கும் வேலைகள்',
  noLaterJobs: 'இப்போது பின்னர் செய்யும் வேலைகள் இல்லை.',
  acceptLater: 'ஏற்கவும்',
  acceptedLater: (when) => `${when} வேலை ஏற்கப்பட்டது. சரியான நேரத்தில் வாருங்கள்!`,
  newLaterJob: 'பின்னர் செய்ய புதிய வேலை 📅',
  addTip: 'டிப் சேர்க்கவும் (விருப்பம்)',
  noTip: 'டிப் வேண்டாம்',
  tipLabel: 'டிப்',
  tipReceived: (n) => `🎉 முதலாளியிடமிருந்து டிப்: ₹${n}`,
  shareFamily: '👪 குடும்பத்துடன் பகிர்',
  familyMsgTitle: 'நான் வேலையில் இருக்கிறேன். விவரம்:',
  startedAt: 'தொடங்கியது',
  bookAgainWorker: '🔁 மீண்டும் புக் செய்',
  reviewHint: 'எது நன்றாக இருந்தது? (விருப்பம்)'
});

Object.assign(T.hi, TAG_TEXT.hi, {
  etaLine: (km, min) => `${km} किमी दूर · करीब ${min} मिनट`,
  directions: '🧭 रास्ता',
  cantCome: '❌ नहीं आ सकता',
  cantComeConfirm: 'यह काम रद्द करें? मालिक को दूसरा मज़दूर भेजा जाएगा।',
  workerCantCome: 'मज़दूर नहीं आ सका। आपके लिए दूसरा मज़दूर ढूँढ रहे हैं…',
  prevWorkerCancelled: 'पहला मज़दूर नहीं आ सका। फिर से ढूँढ रहे हैं।',
  cancelJob: 'काम रद्द करें',
  cancelConfirm: 'यह बुकिंग रद्द करें?',
  whenLabel: 'कब',
  now: 'अभी',
  later: 'बाद में',
  laterTooSoon: 'अभी से कम से कम 1 घंटे बाद का समय चुनें',
  scheduledBooked: (when) => `${when} के लिए बुक हो गया। मज़दूर के मानते ही बताएँगे।`,
  scheduledFor: (when) => `📅 ${when} के लिए`,
  waitingAccept: 'मज़दूर के मानने का इंतज़ार',
  laterAccepted: (name, when) => `${name} ने ${when} का काम मान लिया`,
  upcomingTitle: '📅 आने वाले काम',
  chooseWorker: 'मज़दूर चुनें (अपनी मर्ज़ी)',
  requestingOnly: (name) => `यह अनुरोध सिर्फ़ ${name} को जाएगा।`,
  sendToAll: 'सबको भेजें',
  sendToAllBtn: 'पास के सभी मज़दूरों को भेजें',
  requestThis: (name) => `${name} को बुलाएँ`,
  preferredOffline: (name) => `${name} अभी ऑफ़लाइन हैं। बाद के लिए बुक करें या सबको भेजें।`,
  expYears: (n) => `${n} साल का अनुभव`,
  experience: 'अनुभव (साल)',
  trusted: 'भरोसेमंद',
  ratingLabel: 'रेटिंग',
  distanceLabel: 'दूरी',
  onlineNow: 'अभी ऑनलाइन',
  offlineNow: 'ऑफ़लाइन',
  whatEmployersSay: 'मालिक क्या कहते हैं',
  whatWorkersSay: 'इस जगह के बारे में मज़दूर क्या कहते हैं',
  noReviews: 'अभी कोई राय नहीं',
  requestedYou: '🎯 आपको नाम से बुलाया है',
  laterJobsTitle: '📅 बाद के काम',
  myUpcoming: '📅 मेरे आने वाले काम',
  noLaterJobs: 'अभी बाद के लिए कोई काम नहीं।',
  acceptLater: 'मानें',
  acceptedLater: (when) => `${when} का काम मान लिया। समय पर पहुँचें!`,
  newLaterJob: 'बाद के लिए नया काम 📅',
  addTip: 'टिप दें (अपनी मर्ज़ी)',
  noTip: 'टिप नहीं',
  tipLabel: 'टिप',
  tipReceived: (n) => `🎉 मालिक से टिप: ₹${n}`,
  shareFamily: '👪 परिवार को भेजें',
  familyMsgTitle: 'मैं काम पर हूँ। काम की जानकारी:',
  startedAt: 'शुरू हुआ',
  bookAgainWorker: '🔁 फिर से बुक करें',
  reviewHint: 'क्या अच्छा लगा? (अपनी मर्ज़ी)'
});
