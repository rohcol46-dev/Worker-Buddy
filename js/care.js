// care.js — rights, safety and help for migrant workers:
//   3. Rights helper (ask in your language, by voice or text)   11. 18+ only
//   12. Night jobs need a GST-verified employer   13. Site check-in   14. Dispute room
//   15. Moving city   16-18. Ration shop, stay and crèche finders
// Load after fair.js. Owner: Member 3

const MIN_AGE = 18;

// ---------- 11. 18+ only ----------
function ageOk(birthYear) {
  return !!birthYear && new Date().getFullYear() - birthYear >= MIN_AGE;
}

// ---------- 12. Night jobs (8 PM to 6 AM) ----------
function isNightTime(date) {
  const h = (date || new Date()).getHours();
  return h >= 20 || h < 6;
}
function isNightJob(b) {
  return isNightTime(b.scheduled_for ? new Date(b.scheduled_for) : new Date(b.created_at));
}
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

// ---------- 14. Dispute room: every piece of evidence for one job, shareable with an NGO ----------
function disputeLink(b) {
  return new URL(`../dispute/?b=${b.id}`, location.href).href;
}

// ---------- 3. Rights helper ----------
// Keyword matching in three languages; works offline. Can be upgraded to an AI model later.
const HELP_TOPICS = [
  { id: 'notPaid', words: ['not paid', 'no pay', 'didn', 'salary', 'money', 'wage not', 'பணம்', 'சம்பளம் வரல', 'கொடுக்கல', 'पैसे नहीं', 'पैसा नहीं', 'नहीं दिया', 'मज़दूरी'] },
  { id: 'injured', words: ['injur', 'hurt', 'accident', 'fell', 'cut', 'blood', 'காயம்', 'விபத்து', 'அடி', 'चोट', 'हादसा', 'गिर'] },
  { id: 'heat', words: ['heat', 'hot', 'sun', 'dizzy', 'வெயில்', 'வெப்ப', 'மயக்கம்', 'गर्मी', 'धूप', 'चक्कर'] },
  { id: 'overtime', words: ['overtime', 'extra hour', 'more hours', 'late', 'கூடுதல் நேரம்', 'ஓவர்டைம்', 'ओवरटाइम', 'ज़्यादा घंटे', 'देर तक'] },
  { id: 'abuse', words: ['abuse', 'beat', 'harass', 'shout', 'touch', 'threat', 'அடித்', 'திட்ட', 'தொல்லை', 'मार', 'गाली', 'परेशान', 'छेड़'] },
  { id: 'child', words: ['child', 'kid', 'boy', 'girl', 'under 18', 'குழந்தை', 'சிறுவன்', 'बच्चा', 'बच्चे', 'नाबालिग'] },
  { id: 'scheme', words: ['scheme', 'eshram', 'e-shram', 'pension', 'insurance', 'card', 'திட்டம்', 'ஓய்வூதியம்', 'காப்பீடு', 'योजना', 'पेंशन', 'बीमा', 'कार्ड'] },
  { id: 'cancel', words: ['cancel', 'came for nothing', 'sent back', 'ரத்து', 'திருப்பி அனுப்', 'रद्द', 'वापस भेज'] },
  { id: 'legal', words: ['lawyer', 'court', 'legal', 'police', 'complaint', 'வழக்கறிஞர்', 'புகார்', 'போலீஸ்', 'वकील', 'शिकायत', 'पुलिस'] }
];

// Work names a worker might say, for "is ₹400 fair for a painter?"
const WORK_WORDS = {
  coolie: ['coolie', 'loader', 'load', 'கூலி', 'சுமை', 'कुली', 'लोडर'],
  helper: ['helper', 'உதவி', 'हेल्पर', 'मददगार'],
  plumber: ['plumb', 'pipe', 'பிளம்பர்', 'குழாய்', 'प्लंबर', 'नल'],
  electrician: ['electric', 'wiring', 'எலக்ட்ரீஷியன்', 'மின்', 'इलेक्ट्रीशियन', 'बिजली'],
  mason: ['mason', 'brick', 'கொத்தனார்', 'செங்கல்', 'मिस्त्री', 'राजमिस्त्री', 'ईंट'],
  painter: ['paint', 'பெயிண்ட', 'வர்ண', 'पेंट', 'रंग']
};

function answerQuestion(text) {
  const said = (text || '').toLowerCase();
  // A wage question: a number and a kind of work
  const amount = parseInt((said.match(/\d{2,5}/) || [])[0], 10);
  const work = Object.keys(WORK_WORDS).find((k) => WORK_WORDS[k].some((w) => said.includes(w)));
  if (amount && work) {
    const r = WORK_TYPES[work];
    const verdict = amount < r.min ? 'low' : amount > r.max ? 'high' : 'fair';
    return tf('helpWage_' + verdict, amount, t(work), r.min, r.max);
  }
  const topic = HELP_TOPICS.find((tp) => tp.words.some((w) => said.includes(w)));
  return topic ? t('help_' + topic.id) : t('help_unknown');
}

function helperHTML() {
  const chips = ['qNotPaid', 'qWage', 'qInjured', 'qOvertime', 'qAbuse'].map((k) =>
    `<button type="button" class="chip" onclick="askHelper(t('${k}'))">${t(k)}</button>`).join('');
  return `
    <b>❓ ${t('helperTitle')}</b>
    <p class="muted small">${t('helperHint')}</p>
    <form class="row" onsubmit="event.preventDefault(); askHelper(this.q.value)">
      <input name="q" class="input" maxlength="200" placeholder="${attr(t('helperPh'))}">
      <button type="button" class="btn btn-light btn-small" onclick="listenVoice(askHelper)" aria-label="${attr(t('voiceBtn'))}">🎤</button>
      <button class="btn btn-dark btn-small" type="submit">${t('ask')}</button>
    </form>
    <div class="chips wrap">${chips}</div>
    <div id="helperAnswer"></div>
    <p class="small">${t('helplines')}</p>`;
}

function askHelper(q) {
  if (!q || !q.trim()) return;
  const answer = answerQuestion(q);
  document.getElementById('helperAnswer').innerHTML = `
    <div class="helper-answer"><small>“${esc(q)}”</small><p>${esc(answer)}</p>${speakButton(answer)}</div>`;
  speak(answer);
}

function renderHelper() {
  const box = document.getElementById('rightsHelper');
  if (box) box.innerHTML = helperHTML();
}

// ---------- 16-18. Ration shop, place to stay, crèche / school (OpenStreetMap) ----------
const SERVICE_QUERIES = {
  ration: (a) => `nwr(around:4000,${a})[name~"ration|PDS|fair price|நியாய விலை|ரேஷன்|राशन",i];nwr(around:4000,${a})[shop=ration];`,
  stay: (a) => `nwr(around:4000,${a})[tourism~"^(hostel|guest_house|motel)$"];nwr(around:4000,${a})[amenity=social_facility];`,
  creche: (a) => `nwr(around:3000,${a})[amenity~"^(childcare|kindergarten|school)$"];`
};
const SERVICE_ICONS = { ration: '🍚', stay: '🛏️', creche: '🧒' };

async function findService(kind) {
  const box = document.getElementById('serviceList');
  const cached = Store.get('svc_' + kind, null);
  if (cached && kmBetween(cached.at, App.here) < 1) return renderServices(kind, cached.list);
  if (!navigator.onLine) return renderServices(kind, cached ? cached.list : []);
  box.innerHTML = `<p class="muted small">${t('searching')}</p>`;
  const a = `${App.here.lat},${App.here.lng}`;
  const q = `[out:json][timeout:25];(${SERVICE_QUERIES[kind](a)});out center 40;`;
  const list = await placesFromCache(kind, App.here, q,
    (tags, p) => ({ name: tags.name || tags['name:en'] || t('svc_' + kind), ...p }), 30000) || [];
  if (list.length) Store.set('svc_' + kind, { at: { ...App.here }, list });
  renderServices(kind, list); // empty: the official links below still help
}

function renderServices(kind, list) {
  const rows = list.map((p) => ({ ...p, km: distanceKm(App.here, p) })).sort((x, y) => x.km - y.km).slice(0, 10)
    .map((p) => `<div class="rest-item"><span>${SERVICE_ICONS[kind]} ${esc(p.name)}</span>
      <span class="muted small">${p.km.toFixed(1)} km · ${directionsLink(p, p.km < 2)}</span></div>`).join('');
  const extra = kind === 'ration'
    ? `<p class="small">${t('onorcNote')} <a target="_blank" rel="noopener" href="https://play.google.com/store/search?q=Mera%20Ration">Mera Ration</a></p>` : '';
  document.getElementById('serviceList').innerHTML = (rows || `<p class="muted small">${t('svcNone')}</p>`) + extra;
}

function servicesHTML() {
  return `
    <b>🏘️ ${t('servicesTitle')}</b>
    <p class="muted small">${t('servicesHint')}</p>
    <div class="chips wrap">
      ${Object.keys(SERVICE_QUERIES).map((k) => `<button type="button" class="chip" onclick="findService('${k}')">${SERVICE_ICONS[k]} ${t('svc_' + k)}</button>`).join('')}
    </div>
    <div id="serviceList"></div>`;
}

function renderServicesCard() {
  const box = document.getElementById('servicesCard');
  if (box) box.innerHTML = servicesHTML();
}

// ---------- Text ----------
Object.assign(T.en, {
  birthYear: 'Year of birth',
  under18: 'Worker Buddy is only for workers aged 18 or above.',
  homeState: 'Home state (if you moved for work)',
  cityLabel: 'City you work in now',
  movedCity: (c) => `Moved to ${c}. Your ratings and wage record came with you.`,
  migrantFrom: (s) => `🧳 From ${s}`,
  nightTag: '🌙 Night job',
  gstVerified: '✔ GST-verified employer',
  nightNeedsGst: 'Jobs between 8 PM and 6 AM need a GST-verified employer. Add your GST number in Bookings.',
  nightShare: '🌙 Night job: share the details with your family.',
  gstTitle: '🏢 Business verification (GST)',
  gstHint: 'Needed for night jobs (8 PM–6 AM). Workers see “GST-verified employer”.',
  gstPh: 'GST number, e.g. 33ABCDE1234F1Z5',
  gstSave: 'Save',
  gstBad: 'That does not look like a GST number (15 letters and numbers).',
  gstSaved: 'GST number saved ✅',
  tooFar: 'You need to be at the work site (within 1 km) to start. Check your location.',
  checkedIn: '📍 Checked in at the site',
  evidence: '⚖️ Evidence',
  helperTitle: 'Ask about your rights',
  helperHint: 'Type or speak in Tamil, Hindi or English. Answers are read aloud.',
  helperPh: 'e.g. Is ₹400 fair for a painter?',
  ask: 'Ask',
  qNotPaid: 'My employer did not pay me',
  qWage: 'Is ₹400 fair for a coolie?',
  qInjured: 'I got hurt at work',
  qOvertime: 'Do I get paid for extra hours?',
  qAbuse: 'The employer shouted and threatened me',
  helpWage_low: (n, w, a, b) => `${money(n)} is below the fair range for ${w} (${money(a)}–${money(b)} for 8 hours). You can ask for more, or decline.`,
  helpWage_fair: (n, w, a, b) => `${money(n)} is inside the fair range for ${w} (${money(a)}–${money(b)} for 8 hours).`,
  helpWage_high: (n, w, a, b) => `${money(n)} is above the usual range for ${w} (${money(a)}–${money(b)}). Good pay!`,
  help_notPaid: 'Tap “Not received” on the job. That records it and lowers the employer’s score. Open ⚖️ Evidence to share all proof with an NGO or the labour office. Free legal help: call 15100.',
  help_injured: 'Stop work and get first aid. Call 108 for an ambulance. If you have PMSBY accident insurance, keep the hospital papers. Tell the employer and save the job’s evidence.',
  help_heat: 'Stop, move to shade, drink water slowly and wet your head. Dizzy or confused? Call 108. On hot days, take a water break every hour; employers should give water and shade.',
  help_overtime: 'Yes. Every hour after the agreed hours is paid double (twice your hourly rate, as the law says), worked out automatically and shown on your pay slip.',
  help_abuse: 'You do not have to accept abuse. Leave if unsafe and call 112. Women can call 181. Rate the employer and use ⚖️ Evidence to report it.',
  help_child: 'Children under 14 must not work, and under 18 must not do dangerous work. Call 1098 (Childline).',
  help_scheme: 'Register on e-Shram for free (helpline 14434). See the Schemes tab for pension and insurance you may get.',
  help_cancel: 'If the employer cancels after you set off, you get ₹100 show-up pay. It shows in your Earnings.',
  help_legal: 'Free legal aid is available: call 15100 (NALSA). For danger, call 112.',
  help_unknown: 'I did not understand. Try: “not paid”, “hurt”, “overtime”, or “is ₹500 fair for a mason?”. Helplines are below.',
  helplines: '📞 Emergency 112 · Ambulance 108 · Women 181 · Child 1098 · e-Shram 14434 · Legal aid 15100',
  servicesTitle: 'Services near you',
  servicesHint: 'For workers who moved here: ration shops, places to stay and childcare.',
  svc_ration: 'Ration shop', svc_stay: 'Place to stay', svc_creche: 'Crèche / school',
  svcNone: 'None found on the map nearby. Ask locally, or try again later.',
  onorcNote: 'With One Nation One Ration Card you can use your ration card in any state. Check shops in the official app:',
  searching: 'Searching the map…'
});

Object.assign(T.ta, {
  birthYear: 'பிறந்த ஆண்டு',
  under18: 'Worker Buddy 18 வயது அல்லது அதற்கு மேற்பட்டவர்களுக்கு மட்டுமே.',
  homeState: 'சொந்த மாநிலம் (வேலைக்காக இடம் மாறியிருந்தால்)',
  cityLabel: 'இப்போது வேலை செய்யும் நகரம்',
  movedCity: (c) => `${c}க்கு மாறினீர்கள். உங்கள் மதிப்பீடும் கூலி பதிவும் உங்களுடன் வந்தன.`,
  migrantFrom: (s) => `🧳 ${s} இலிருந்து`,
  nightTag: '🌙 இரவு வேலை',
  gstVerified: '✔ GST சரிபார்த்த முதலாளி',
  nightNeedsGst: 'இரவு 8 முதல் காலை 6 வரையிலான வேலைகளுக்கு GST சரிபார்த்த முதலாளி தேவை. புக்கிங்கில் GST எண்ணைச் சேருங்கள்.',
  nightShare: '🌙 இரவு வேலை: விவரங்களைக் குடும்பத்துடன் பகிருங்கள்.',
  gstTitle: '🏢 வணிகச் சரிபார்ப்பு (GST)',
  gstHint: 'இரவு வேலைகளுக்குத் தேவை (இரவு 8–காலை 6). வேலையாட்கள் “GST சரிபார்த்த முதலாளி” என்று பார்ப்பார்கள்.',
  gstPh: 'GST எண், எ.கா. 33ABCDE1234F1Z5',
  gstSave: 'சேமி',
  gstBad: 'இது GST எண் போல இல்லை (15 எழுத்துகள், எண்கள்).',
  gstSaved: 'GST எண் சேமிக்கப்பட்டது ✅',
  tooFar: 'தொடங்க நீங்கள் வேலை இடத்தில் (1 கி.மீக்குள்) இருக்க வேண்டும். உங்கள் இருப்பிடத்தைச் சரிபாருங்கள்.',
  checkedIn: '📍 இடத்தில் வருகை பதிவானது',
  evidence: '⚖️ சான்றுகள்',
  helperTitle: 'உங்கள் உரிமைகள் பற்றிக் கேளுங்கள்',
  helperHint: 'தமிழ், இந்தி அல்லது ஆங்கிலத்தில் டைப் செய்யுங்கள் அல்லது பேசுங்கள். பதில் சத்தமாகப் படிக்கப்படும்.',
  helperPh: 'எ.கா. பெயிண்டருக்கு ₹400 நியாயமா?',
  ask: 'கேள்',
  qNotPaid: 'முதலாளி சம்பளம் கொடுக்கல',
  qWage: 'கூலிக்கு ₹400 நியாயமா?',
  qInjured: 'வேலையில் எனக்கு காயம்',
  qOvertime: 'கூடுதல் நேரத்துக்குக் கூலி உண்டா?',
  qAbuse: 'முதலாளி திட்டி மிரட்டினார்',
  helpWage_low: (n, w, a, b) => `${w}க்கு ${money(n)} நியாயமான வரம்புக்குக் கீழே (8 மணிக்கு ${money(a)}–${money(b)}). கூடுதலாகக் கேட்கலாம் அல்லது மறுக்கலாம்.`,
  helpWage_fair: (n, w, a, b) => `${w}க்கு ${money(n)} நியாயமான வரம்புக்குள் (8 மணிக்கு ${money(a)}–${money(b)}).`,
  helpWage_high: (n, w, a, b) => `${w}க்கு ${money(n)} வழக்கத்தை விட அதிகம் (${money(a)}–${money(b)}). நல்ல கூலி!`,
  help_notPaid: 'வேலையில் “கிடைக்கவில்லை” என்று தட்டுங்கள். அது பதிவாகி முதலாளியின் மதிப்பெண் குறையும். ⚖️ சான்றுகள் மூலம் NGO அல்லது தொழிலாளர் அலுவலகத்துடன் பகிருங்கள். இலவச சட்ட உதவி: 15100.',
  help_injured: 'வேலையை நிறுத்தி முதலுதவி பெறுங்கள். ஆம்புலன்ஸுக்கு 108. PMSBY காப்பீடு இருந்தால் மருத்துவமனை ஆவணங்களை வைத்திருங்கள். முதலாளியிடம் சொல்லி சான்றுகளைச் சேமியுங்கள்.',
  help_heat: 'நிறுத்தி, நிழலுக்குச் சென்று மெதுவாக தண்ணீர் குடியுங்கள், தலையை நனையுங்கள். தலைசுற்றல்? 108. வெப்ப நாளில் ஒவ்வொரு மணி நேரமும் தண்ணீர் இடைவேளை; முதலாளி தண்ணீரும் நிழலும் தர வேண்டும்.',
  help_overtime: 'ஆம். ஒப்புக்கொண்ட நேரத்துக்கு மேல் ஒவ்வொரு மணிக்கும் இரட்டிப்பு கூலி (சட்டப்படி மணிக் கூலியின் இரண்டு மடங்கு), தானாகக் கணக்கிட்டு சம்பளச் சீட்டில் காட்டப்படும்.',
  help_abuse: 'திட்டுதலை நீங்கள் ஏற்க வேண்டியதில்லை. பாதுகாப்பில்லை என்றால் வெளியேறி 112 அழையுங்கள். பெண்கள் 181. முதலாளியை மதிப்பிட்டு ⚖️ சான்றுகள் மூலம் புகார் செய்யுங்கள்.',
  help_child: '14 வயதுக்குக் கீழ் குழந்தைகள் வேலை செய்யக்கூடாது; 18க்குக் கீழ் ஆபத்தான வேலை கூடாது. 1098 (சைல்ட்லைன்) அழையுங்கள்.',
  help_scheme: 'e-Shram இல் இலவசமாகப் பதிவு செய்யுங்கள் (உதவி எண் 14434). ஓய்வூதியம், காப்பீட்டுக்கு திட்டங்கள் தாவலைப் பாருங்கள்.',
  help_cancel: 'நீங்கள் கிளம்பிய பிறகு முதலாளி ரத்து செய்தால் ₹100 வருகைக் கூலி கிடைக்கும். உங்கள் வருமானத்தில் தெரியும்.',
  help_legal: 'இலவச சட்ட உதவி: 15100 (NALSA). ஆபத்து என்றால் 112.',
  help_unknown: 'புரியவில்லை. முயற்சி செய்யுங்கள்: “சம்பளம் கொடுக்கல”, “காயம்”, “கூடுதல் நேரம்”, அல்லது “கொத்தனாருக்கு ₹500 நியாயமா?”. உதவி எண்கள் கீழே.',
  helplines: '📞 அவசரம் 112 · ஆம்புலன்ஸ் 108 · பெண்கள் 181 · குழந்தை 1098 · e-Shram 14434 · சட்ட உதவி 15100',
  servicesTitle: 'அருகிலுள்ள சேவைகள்',
  servicesHint: 'இங்கு இடம் மாறி வந்தவர்களுக்கு: ரேஷன் கடை, தங்குமிடம், குழந்தை பராமரிப்பு.',
  svc_ration: 'ரேஷன் கடை', svc_stay: 'தங்குமிடம்', svc_creche: 'காப்பகம் / பள்ளி',
  svcNone: 'வரைபடத்தில் அருகில் எதுவும் இல்லை. உள்ளூரில் கேளுங்கள் அல்லது பிறகு முயற்சி செய்யுங்கள்.',
  onorcNote: 'ஒரே நாடு ஒரே ரேஷன் கார்டு மூலம் எந்த மாநிலத்திலும் ரேஷன் வாங்கலாம். அதிகாரப்பூர்வ செயலியில் கடைகளைப் பாருங்கள்:',
  searching: 'வரைபடத்தில் தேடுகிறது…'
});

Object.assign(T.hi, {
  birthYear: 'जन्म का साल',
  under18: 'Worker Buddy सिर्फ़ 18 साल या उससे बड़े मज़दूरों के लिए है।',
  homeState: 'अपना राज्य (अगर काम के लिए आए हैं)',
  cityLabel: 'अभी किस शहर में काम करते हैं',
  movedCity: (c) => `${c} आ गए। आपकी रेटिंग और मज़दूरी रिकॉर्ड साथ आए।`,
  migrantFrom: (s) => `🧳 ${s} से`,
  nightTag: '🌙 रात का काम',
  gstVerified: '✔ GST जाँचा मालिक',
  nightNeedsGst: 'रात 8 से सुबह 6 के काम के लिए GST जाँचा मालिक चाहिए। बुकिंग में अपना GST नंबर जोड़ें।',
  nightShare: '🌙 रात का काम: जानकारी परिवार को भेजें।',
  gstTitle: '🏢 कारोबार की जाँच (GST)',
  gstHint: 'रात के काम (8 PM–6 AM) के लिए ज़रूरी। मज़दूर “GST जाँचा मालिक” देखेंगे।',
  gstPh: 'GST नंबर, जैसे 33ABCDE1234F1Z5',
  gstSave: 'सेव करें',
  gstBad: 'यह GST नंबर नहीं लगता (15 अक्षर और अंक)।',
  gstSaved: 'GST नंबर सेव हो गया ✅',
  tooFar: 'शुरू करने के लिए आपको काम की जगह (1 किमी के अंदर) पर होना चाहिए। अपनी लोकेशन देखें।',
  checkedIn: '📍 जगह पर हाज़िरी लगी',
  evidence: '⚖️ सबूत',
  helperTitle: 'अपने हक़ के बारे में पूछें',
  helperHint: 'हिंदी, तमिल या अंग्रेज़ी में लिखें या बोलें। जवाब पढ़कर सुनाया जाएगा।',
  helperPh: 'जैसे, पेंटर के लिए ₹400 ठीक है?',
  ask: 'पूछें',
  qNotPaid: 'मालिक ने पैसे नहीं दिए',
  qWage: 'कुली के लिए ₹400 ठीक है?',
  qInjured: 'काम पर मुझे चोट लगी',
  qOvertime: 'ज़्यादा घंटों का पैसा मिलता है?',
  qAbuse: 'मालिक ने गाली दी और धमकाया',
  helpWage_low: (n, w, a, b) => `${w} के लिए ${money(n)} सही सीमा से कम है (8 घंटे के ${money(a)}–${money(b)})। आप ज़्यादा माँग सकते हैं या मना कर सकते हैं।`,
  helpWage_fair: (n, w, a, b) => `${w} के लिए ${money(n)} सही सीमा में है (8 घंटे के ${money(a)}–${money(b)})।`,
  helpWage_high: (n, w, a, b) => `${w} के लिए ${money(n)} आम से ज़्यादा है (${money(a)}–${money(b)})। अच्छी मज़दूरी!`,
  help_notPaid: 'काम पर “नहीं मिला” दबाएँ। यह दर्ज होगा और मालिक का स्कोर घटेगा। ⚖️ सबूत खोलकर NGO या श्रम दफ़्तर को भेजें। मुफ़्त कानूनी मदद: 15100।',
  help_injured: 'काम रोकें और प्राथमिक इलाज लें। एम्बुलेंस के लिए 108। PMSBY बीमा हो तो अस्पताल के कागज़ रखें। मालिक को बताएँ और सबूत सेव रखें।',
  help_heat: 'रुकें, छाया में जाएँ, धीरे-धीरे पानी पिएँ, सिर गीला करें। चक्कर? 108। गर्म दिन हर घंटे पानी का ब्रेक; मालिक को पानी और छाया देनी चाहिए।',
  help_overtime: 'हाँ। तय घंटों के बाद हर घंटे दोगुनी मज़दूरी (कानून के हिसाब से घंटे की दर का दो गुना), अपने आप जुड़ती है और पे स्लिप पर दिखती है।',
  help_abuse: 'गाली-गलौज सहना ज़रूरी नहीं। असुरक्षित लगे तो निकलें और 112 पर फ़ोन करें। महिलाएँ 181। मालिक को रेटिंग दें और ⚖️ सबूत से शिकायत करें।',
  help_child: '14 साल से कम बच्चे काम नहीं कर सकते, 18 से कम खतरनाक काम नहीं। 1098 (चाइल्डलाइन) पर फ़ोन करें।',
  help_scheme: 'e-Shram पर मुफ़्त पंजीकरण करें (हेल्पलाइन 14434)। पेंशन और बीमा के लिए योजनाएँ टैब देखें।',
  help_cancel: 'आपके निकलने के बाद मालिक रद्द करे तो ₹100 आने का पैसा मिलेगा। कमाई में दिखेगा।',
  help_legal: 'मुफ़्त कानूनी मदद: 15100 (NALSA)। खतरा हो तो 112।',
  help_unknown: 'समझ नहीं आया। ऐसे पूछें: “पैसे नहीं दिए”, “चोट”, “ओवरटाइम”, या “मिस्त्री के लिए ₹500 ठीक है?”। हेल्पलाइन नीचे हैं।',
  helplines: '📞 आपातकाल 112 · एम्बुलेंस 108 · महिला 181 · बच्चे 1098 · e-Shram 14434 · कानूनी मदद 15100',
  servicesTitle: 'पास की सेवाएँ',
  servicesHint: 'जो काम के लिए यहाँ आए हैं: राशन की दुकान, रहने की जगह, बच्चों की देखभाल।',
  svc_ration: 'राशन की दुकान', svc_stay: 'रहने की जगह', svc_creche: 'क्रेच / स्कूल',
  svcNone: 'नक्शे पर पास में कुछ नहीं मिला। आसपास पूछें या बाद में कोशिश करें।',
  onorcNote: 'वन नेशन वन राशन कार्ड से किसी भी राज्य में राशन ले सकते हैं। सरकारी ऐप में दुकानें देखें:',
  searching: 'नक्शे पर ढूँढ रहे हैं…'
});
