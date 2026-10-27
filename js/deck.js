// deck.js — the job flow from the pitch deck, shared by both apps:
//   Post job → Fair rate calculated → Shared on WhatsApp → Worker accepts →
//   Work + heat alerts → Pay slip + rating
// plus voice commands, skill badges, welfare rating, fair rate card and impact numbers.
// Load after more.js. Owner: Member 4 (lead)

// ---------- Shared on WhatsApp: every posted job has a link workers can tap ----------
function jobLink(b) {
  return new URL(`../worker/?job=${b.id}`, location.href).href;
}

function jobShareText(b, employerName) {
  return [
    `🧰 ${t('jobPostTitle')}: ${WORK_TYPES[b.type].icon} ${t(b.type)}`,
    `📍 ${b.area}`,
    `⏱️ ${b.hours} ${t('hoursUnit')} · 💰 ${money(b.agreed_wage, b.currency)} (${t('fairRange')} ${money(b.wage_min, b.currency)}–${money(b.wage_max, b.currency)})`,
    b.scheduled_for ? `📅 ${whenText(b)}` : '',
    b.group_size > 1 ? tf('teamJob', b.group_size) : '',
    b.bring_tools ? t('toolsTag') : '',
    b.perks && b.perks.length ? `✅ ${perksText(b.perks)}` : '',
    `🏢 ${employerName}`,
    `👉 ${t('tapToAccept')}: ${jobLink(b)}`
  ].filter(Boolean).join('\n');
}

function shareJob(b, employerName) {
  shareOnWhatsApp(jobShareText(b, employerName));
}

// ---------- Skill badges ----------
function skillBadges(w) {
  if (!w) return [];
  const out = [];
  if (isTrusted(w)) out.push(['✔', t('trusted')]);
  if (w.iti_cert) out.push(['🎓', t('itiBadge')]);
  if ((w.experience_years || 0) >= 5) out.push(['🏅', tf('expBadge', w.experience_years)]);
  if ((w.lessons || []).length >= 2) out.push(['🎓', t('safetyBadge')]);
  const streak = [25, 10, 5].find((n) => (w.clean_streak || 0) >= n);
  if (streak) out.push(['🔥', tf('streakBadge', streak)]);
  const milestone = [100, 25, 5].find((n) => (w.jobs_done || 0) >= n);
  if (milestone) out.push(['💼', tf('jobsBadge', milestone)]);
  return out;
}

function skillBadgesHTML(w) {
  const list = skillBadges(w);
  return list.length
    ? `<div class="badges">${list.map(([icon, label]) => `<span class="skill-badge">${icon} ${label}</span>`).join('')}</div>` : '';
}

// ---------- Welfare rating: what workers say about an employer's site ----------
function welfareHTML(counts) {
  return `<div class="welfare"><b>${t('welfareRating')}</b><div class="tags">${tagChipsHTML(counts, 5)}</div></div>`;
}

// ---------- Fair rate card (visible before any job is accepted) ----------
function openRateCard() {
  const ranges = Object.keys(WORK_TYPES).map((k) => [k, tradeRange(k)]);
  const rows = ranges.map(([k, r]) =>
    `<div><span>${WORK_TYPES[k].icon} ${t(k)}</span><span>${money(r.min)} – ${money(r.max)}</span></div>`).join('');
  const ruleKeys = ['ruleExtra', 'ruleHalf', 'ruleLoad', 'ruleRisky', 'ruleNight', 'ruleHeat', 'ruleNoCut'];
  const rules = [tf('ruleMin', minWageDay()), ...ruleKeys.map((k) => t(k))].map((r) => `<li>${r}</li>`).join('');
  document.getElementById('slipBody').innerHTML = `
    <div class="slip" id="slipPrint">
      <div class="slip-head"><b>🤝 Worker Buddy</b><span>${t('rateCardTitle')}</span></div>
      <div class="agreement">${rows}</div>
      <ul class="rules">${rules}</ul>
    </div>`;
  slipShareText = [`📋 Worker Buddy · ${t('rateCardTitle')}`,
    ...ranges.map(([k, r]) => `${t(k)}: ${money(r.min)}–${money(r.max)}`),
    '• ' + tf('ruleMin', minWageDay()), ...ruleKeys.map((k) => '• ' + t(k))].join('\n');
  document.getElementById('slipModal').classList.add('open');
}

// ---------- Impact numbers from the deck (earnings, idle days, deductions) ----------
function impactHTML(slips) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const days = new Set(slips.filter((b) => Date.parse(b.worker_confirmed_at) >= monthStart)
    .map((b) => new Date(b.started_at || b.worker_confirmed_at).toDateString()));
  return `
    <div class="stats stats-3">
      <div><small>${t('daysWorked')}</small><b>${days.size}</b></div>
      <div><small>${t('idleDays')}</small><b>${Math.max(0, now.getDate() - days.size)}</b></div>
      <div><small>${t('deductions')}</small><b>${money(0)}</b></div>
    </div>`;
}

// ---------- Heat at work ----------
async function reportHeat(bookingId) {
  speak(t('heatFirstAid'));
  document.querySelectorAll('.heat-help').forEach((help) => {
    help.innerHTML = `<p class="dispute-note">${t('heatFirstAid')}</p>
      ${ambulanceLink()}`;
  });
  if (typeof W === 'undefined' || !W.me) return;
  const row = { worker_id: W.me.id, booking_id: bookingId || null, feels_like: App.simulateHot ? 40 : App.temp, lat: App.here.lat, lng: App.here.lng };
  if (!navigator.onLine) return showToast(t('heatSaved'));
  const { error } = await db.from('heat_reports').insert(row);
  showToast(error ? t('saveError') : t('heatSaved'));
}

// ---------- Voice commands (worker app) ----------
// Each command lists words in English, Hindi and Tamil. Order matters: first match wins.
const VOICE_WORDS = [
  ['offline', ['offline', 'go offline', 'ऑफ़लाइन', 'ऑफलाइन', 'ஆஃப்லைன்']],
  ['online', ['online', 'go online', 'ऑनलाइन', 'काम चाहिए', 'ஆன்லைன்', 'வேலை வேண்டும்']],
  ['accept', ['accept', 'yes', 'okay', 'ok', 'स्वीकार', 'हाँ', 'हां', 'ठीक', 'ஏற்கிறேன்', 'ஏற்க', 'சரி', 'ஆமா']],
  ['decline', ['decline', 'reject', 'no', 'नहीं', 'मना', 'வேண்டாம்', 'இல்லை']],
  ['complete', ['complete', 'done', 'finished', 'finish', 'पूरा', 'हो गया', 'முடிந்தது', 'முடிச்சாச்சு']],
  ['received', ['received', 'got it', 'मिल गया', 'मिला', 'கிடைத்தது', 'வந்தது']],
  ['read', ['read', 'repeat', 'what', 'बताओ', 'सुनाओ', 'पढ़ो', 'படி', 'சொல்லு']]
];

function voiceCommand(text) {
  const said = text.toLowerCase();
  for (const [cmd, words] of VOICE_WORDS) {
    const hit = words.some((w) => (/^[a-z ]+$/.test(w) ? new RegExp(`\\b${w}\\b`).test(said) : said.includes(w)));
    if (hit) return cmd;
  }
  return null;
}

let recognizer = null;
function listenVoice(onText) {
  const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Rec) return showToast(t('noVoiceInput'));
  if (recognizer) recognizer.abort();
  recognizer = new Rec();
  recognizer.lang = speechTag();
  recognizer.interimResults = false;
  recognizer.maxAlternatives = 1;
  const btn = document.getElementById('micBtn');
  if (btn) btn.classList.add('listening');
  showToast(t('listening'));
  recognizer.onresult = (e) => (typeof onText === 'function' ? onText : handleVoice)(e.results[0][0].transcript);
  recognizer.onerror = () => showToast(t('voiceHelp'));
  recognizer.onend = () => { if (btn) btn.classList.remove('listening'); };
  recognizer.start();
}

// What the app does with what the worker said (each app sets App.onVoice)
function handleVoice(text) {
  showToast(tf('voiceHeard', text));
  const digits = text.replace(/[^0-9०-९௦-௯]/g, '')
    .replace(/[०-९]/g, (d) => '०१२३४५६७८९'.indexOf(d))
    .replace(/[௦-௯]/g, (d) => '௦௧௨௩௪௫௬௭௮௯'.indexOf(d));
  const done = App.onVoice ? App.onVoice(voiceCommand(text), digits) : false;
  if (!done) speak(t('voiceHelp'));
}

// ---------- Text ----------
Object.assign(T.en, {
  bookNow: (w) => `Post job · ${money(w)}`,
  bookTeam: (n, w) => `Post job for ${n} workers · ${money(w)} total`,
  shareJobWa: '📲 Share job on WhatsApp',
  jobPostTitle: 'Job on Worker Buddy',
  fairRange: 'fair range',
  tapToAccept: 'Tap to see and accept',
  jobPosted: '✅ Job posted. Nearby workers are being alerted. Share it on WhatsApp to reach more.',
  jobClosed: 'This job is already taken or closed.',
  jobOtherSkill: (type) => `This job needs: ${type}. It does not match your skill.`,
  finishCurrentFirst: 'Finish your current job first.',
  voiceBtn: 'Speak',
  listening: '🎤 Listening… say “accept”, “go online”, “done”',
  voiceHeard: (x) => `🎤 “${x}”`,
  voiceHelp: 'Say: go online, accept, decline, the 4-digit OTP, done, received, or read.',
  noVoiceInput: 'Voice commands need Chrome on an Android phone.',
  itiCert: 'ITI / skill certificate no. (optional)',
  itiBadge: 'ITI certified (to verify)',
  expBadge: (n) => `${n}+ yrs experience`,
  jobsBadge: (n) => `${n}+ jobs done`,
  welfareRating: '🛡️ Welfare rating from workers',
  yourWelfare: '🛡️ Your welfare rating (from workers)',
  heatAtWork: (temp) => `🥵 Hot now (feels like ${temp}°C). Take a water break every hour and rest in shade.`,
  heatEmployerNote: '🥵 It is hot. Give the worker water and a shaded break every hour.',
  breakNow: 'Time for a 10-minute water break in the shade.',
  reportHeat: '🤒 I feel unwell from the heat',
  heatFirstAid: 'Stop work. Move to shade, drink water slowly, wet your head and neck. If you feel dizzy or confused, call 108 now.',
  heatSaved: 'Heat report saved in your record.',
  rateCard: '📋 Fair rate card',
  rateCardTitle: 'Fair rate card (8-hour day)',
  ruleMin: (n) => `Never below the legal minimum wage: ${money(n)} for an 8-hour day (${wageRegion('Tamil Nadu')})`,
  ruleExtra: () => (payRule('overtime') === 2
    ? 'Each hour after 8 hours is paid double: twice the hourly rate (overtime is added automatically)'
    : `Each hour after 8 hours is paid at ${payRule('overtime')} times the hourly rate (overtime is added automatically)`),
  ruleHalf: () => (payRule('short_min') === 0.5
    ? 'Shorter jobs are paid by the hour, never below half a day'
    : `Shorter jobs are paid by the hour, never below ${pct('short_min')} of a day`),
  ruleLoad: () => `Heavier work: +${money(payRule('load_medium'))} (medium) or +${money(payRule('load_heavy'))} (heavy)`,
  ruleRisky: () => `Risky work (height, electric, sewer): +${money(payRule('risky'))}`,
  ruleHeat: () => `Hot day (feels like 36°C or more): +${pct('heat')}`,
  ruleNoCut: 'Worker Buddy takes no commission from the worker',
  daysWorked: 'Days worked (month)',
  idleDays: 'Days without work',
  deductions: 'Deductions'
});

Object.assign(T.ta, {
  bookNow: (w) => `வேலையைப் பதிவிடு · ${money(w)}`,
  bookTeam: (n, w) => `${n} வேலையாட்களுக்கு பதிவிடு · மொத்தம் ${money(w)}`,
  shareJobWa: '📲 வாட்ஸ்அப்பில் வேலையைப் பகிர்',
  jobPostTitle: 'Worker Buddy வேலை',
  fairRange: 'நியாயமான வரம்பு',
  tapToAccept: 'பார்த்து ஏற்க தட்டவும்',
  jobPosted: '✅ வேலை பதிவிடப்பட்டது. அருகிலுள்ள வேலையாட்களுக்கு தெரிவிக்கப்படுகிறது. மேலும் பலருக்கு வாட்ஸ்அப்பில் பகிருங்கள்.',
  jobClosed: 'இந்த வேலை ஏற்கனவே எடுக்கப்பட்டது அல்லது மூடப்பட்டது.',
  jobOtherSkill: (type) => `இந்த வேலைக்கு தேவை: ${type}. உங்கள் திறனுக்கு பொருந்தவில்லை.`,
  finishCurrentFirst: 'முதலில் இப்போதைய வேலையை முடியுங்கள்.',
  voiceBtn: 'பேசு',
  listening: '🎤 கேட்கிறது… “ஏற்கிறேன்”, “ஆன்லைன்”, “முடிந்தது” என்று சொல்லுங்கள்',
  voiceHeard: (x) => `🎤 “${x}”`,
  voiceHelp: 'சொல்லுங்கள்: ஆன்லைன், ஏற்கிறேன், வேண்டாம், 4 இலக்க OTP, முடிந்தது, கிடைத்தது, அல்லது படி.',
  noVoiceInput: 'குரல் கட்டளைக்கு ஆண்ட்ராய்டு போனில் Chrome தேவை.',
  itiCert: 'ITI / திறன் சான்றிதழ் எண் (விருப்பம்)',
  itiBadge: 'ITI சான்றிதழ் (சரிபார்க்க வேண்டும்)',
  expBadge: (n) => `${n}+ ஆண்டு அனுபவம்`,
  jobsBadge: (n) => `${n}+ வேலைகள்`,
  welfareRating: '🛡️ வேலையாட்கள் தரும் நல மதிப்பீடு',
  yourWelfare: '🛡️ உங்கள் நல மதிப்பீடு (வேலையாட்களிடமிருந்து)',
  heatAtWork: (temp) => `🥵 இப்போது வெப்பம் (${temp}°C போல்). ஒவ்வொரு மணி நேரமும் தண்ணீர் இடைவேளை எடுத்து நிழலில் ஓய்வெடுங்கள்.`,
  heatEmployerNote: '🥵 வெப்பமாக உள்ளது. ஒவ்வொரு மணி நேரமும் வேலையாளுக்கு தண்ணீரும் நிழலில் இடைவேளையும் கொடுங்கள்.',
  breakNow: 'நிழலில் 10 நிமிட தண்ணீர் இடைவேளை நேரம்.',
  reportHeat: '🤒 வெப்பத்தால் உடல்நலம் சரியில்லை',
  heatFirstAid: 'வேலையை நிறுத்துங்கள். நிழலுக்குச் சென்று மெதுவாக தண்ணீர் குடியுங்கள், தலையும் கழுத்தும் நனையுங்கள். தலைசுற்றல் அல்லது குழப்பம் இருந்தால் உடனே 108 அழையுங்கள்.',
  heatSaved: 'வெப்ப அறிக்கை உங்கள் பதிவில் சேமிக்கப்பட்டது.',
  rateCard: '📋 நியாயமான கூலி அட்டை',
  rateCardTitle: 'நியாயமான கூலி அட்டை (8 மணி நேர நாள்)',
  ruleMin: (n) => `சட்டப்படி குறைந்தபட்ச கூலிக்குக் கீழே இல்லை: 8 மணி நேர நாளுக்கு ${money(n)} (${wageRegion('தமிழ்நாடு')})`,
  ruleExtra: () => (payRule('overtime') === 2
    ? '8 மணி நேரத்துக்கு மேல் ஒவ்வொரு மணிக்கும் இரட்டிப்பு கூலி: மணிக் கூலியின் இரண்டு மடங்கு (கூடுதல் நேரம் தானாகச் சேரும்)'
    : `8 மணி நேரத்துக்கு மேல் ஒவ்வொரு மணிக்கும் மணிக் கூலியின் ${payRule('overtime')} மடங்கு (கூடுதல் நேரம் தானாகச் சேரும்)`),
  ruleHalf: () => (payRule('short_min') === 0.5
    ? 'குறைந்த நேர வேலைக்கு மணிக்கணக்கில், அரை நாளுக்குக் குறையாமல்'
    : `குறைந்த நேர வேலைக்கு மணிக்கணக்கில், நாள் கூலியின் ${pct('short_min')}-க்குக் குறையாமல்`),
  ruleLoad: () => `கடினமான வேலை: +${money(payRule('load_medium'))} (நடுத்தரம்) அல்லது +${money(payRule('load_heavy'))} (கனமானது)`,
  ruleRisky: () => `ஆபத்தான வேலை (உயரம், மின்சாரம், சாக்கடை): +${money(payRule('risky'))}`,
  ruleHeat: () => `வெப்பமான நாள் (36°C அல்லது அதிகம்): +${pct('heat')}`,
  ruleNoCut: 'Worker Buddy வேலையாளிடம் கமிஷன் எடுப்பதில்லை',
  daysWorked: 'வேலை செய்த நாட்கள் (மாதம்)',
  idleDays: 'வேலை இல்லாத நாட்கள்',
  deductions: 'பிடித்தங்கள்'
});

Object.assign(T.hi, {
  bookNow: (w) => `काम पोस्ट करें · ${money(w)}`,
  bookTeam: (n, w) => `${n} मज़दूरों के लिए पोस्ट करें · कुल ${money(w)}`,
  shareJobWa: '📲 व्हाट्सऐप पर काम भेजें',
  jobPostTitle: 'Worker Buddy पर काम',
  fairRange: 'सही सीमा',
  tapToAccept: 'देखने और मानने के लिए टैप करें',
  jobPosted: '✅ काम पोस्ट हो गया। पास के मज़दूरों को बताया जा रहा है। ज़्यादा लोगों तक पहुँचने के लिए व्हाट्सऐप पर भेजें।',
  jobClosed: 'यह काम पहले ही ले लिया गया है या बंद है।',
  jobOtherSkill: (type) => `इस काम के लिए चाहिए: ${type}। यह आपके काम से मेल नहीं खाता।`,
  finishCurrentFirst: 'पहले अभी का काम पूरा करें।',
  voiceBtn: 'बोलें',
  listening: '🎤 सुन रहे हैं… “स्वीकार”, “ऑनलाइन”, “हो गया” बोलें',
  voiceHeard: (x) => `🎤 “${x}”`,
  voiceHelp: 'बोलें: ऑनलाइन, स्वीकार, नहीं, 4 अंकों का OTP, हो गया, मिल गया, या बताओ।',
  noVoiceInput: 'बोलकर चलाने के लिए Android फ़ोन पर Chrome चाहिए।',
  itiCert: 'ITI / हुनर सर्टिफ़िकेट नंबर (अपनी मर्ज़ी)',
  itiBadge: 'ITI सर्टिफ़िकेट (जाँच बाकी)',
  expBadge: (n) => `${n}+ साल अनुभव`,
  jobsBadge: (n) => `${n}+ काम`,
  welfareRating: '🛡️ मज़दूरों की दी हुई भलाई रेटिंग',
  yourWelfare: '🛡️ आपकी भलाई रेटिंग (मज़दूरों से)',
  heatAtWork: (temp) => `🥵 अभी गर्मी है (${temp}°C जैसा)। हर घंटे पानी का ब्रेक लें और छाया में आराम करें।`,
  heatEmployerNote: '🥵 गर्मी है। मज़दूर को हर घंटे पानी और छाया में ब्रेक दें।',
  breakNow: 'छाया में 10 मिनट पानी के ब्रेक का समय।',
  reportHeat: '🤒 गर्मी से तबीयत ठीक नहीं',
  heatFirstAid: 'काम रोकें। छाया में जाएँ, धीरे-धीरे पानी पिएँ, सिर और गर्दन गीली करें। चक्कर या उलझन हो तो तुरंत 108 पर फ़ोन करें।',
  heatSaved: 'गर्मी की रिपोर्ट आपके रिकॉर्ड में सेव हो गई।',
  rateCard: '📋 सही मज़दूरी कार्ड',
  rateCardTitle: 'सही मज़दूरी कार्ड (8 घंटे का दिन)',
  ruleMin: (n) => `कानूनी न्यूनतम मज़दूरी से कम कभी नहीं: 8 घंटे के दिन के ${money(n)} (${wageRegion('तमिलनाडु')})`,
  ruleExtra: () => (payRule('overtime') === 2
    ? '8 घंटे के बाद हर घंटे दोगुनी मज़दूरी: घंटे की दर का दो गुना (ओवरटाइम अपने आप जुड़ता है)'
    : `8 घंटे के बाद हर घंटे घंटे की दर का ${payRule('overtime')} गुना (ओवरटाइम अपने आप जुड़ता है)`),
  ruleHalf: () => (payRule('short_min') === 0.5
    ? 'छोटे काम घंटे के हिसाब से, आधे दिन से कम नहीं'
    : `छोटे काम घंटे के हिसाब से, दिन की मज़दूरी के ${pct('short_min')} से कम नहीं`),
  ruleLoad: () => `भारी काम: +${money(payRule('load_medium'))} (मध्यम) या +${money(payRule('load_heavy'))} (भारी)`,
  ruleRisky: () => `जोखिम वाला काम (ऊँचाई, बिजली, सीवर): +${money(payRule('risky'))}`,
  ruleHeat: () => `गर्म दिन (36°C या ज़्यादा): +${pct('heat')}`,
  ruleNoCut: 'Worker Buddy मज़दूर से कोई कमीशन नहीं लेता',
  daysWorked: 'काम के दिन (महीना)',
  idleDays: 'बिना काम के दिन',
  deductions: 'कटौती'
});
