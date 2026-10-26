// pages.js — two public pages that need no sign-up:
//   5. Wage map (/wages/): what workers are actually paid, by area and kind of work
//   14. Dispute room (/dispute/?b=…): all the evidence for one job, to share with an NGO or labour office
// Owner: Member 3

// ---------- 5. Wage map ----------
const WM = { map: null, layer: null, rows: [], skill: 'all' };

// A job's wage as an 8-hour day, so short and long jobs can be compared
function dayRate(b) {
  return Math.round((b.agreed_wage * 8) / Math.max(b.hours, 4) / 10) * 10;
}

function nearestArea(p) {
  let best = null;
  Object.entries(AREAS).forEach(([name, a]) => {
    const km = distanceKm(p, { lat: a[0], lng: a[1] });
    if (!best || km < best.km) best = { name, km };
  });
  return best && best.km < 4 ? best.name : `${p.lat.toFixed(2)}, ${p.lng.toFixed(2)}`;
}

async function initWageMap() {
  initLangSelect();
  applyLang();
  App.onLang = () => { applyLang(); drawWageMap(); };
  WM.map = L.map('wageMap').setView([App.here.lat, App.here.lng], 12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(WM.map);
  WM.layer = L.layerGroup().addTo(WM.map);
  const { data } = await db.rpc('wage_map_rows'); // confirmed jobs, placed to about 1 km
  WM.rows = data || [];
  drawWageMap();
}

function pickWageSkill(k) {
  WM.skill = k;
  drawWageMap();
}

function drawWageMap() {
  document.getElementById('skillChips').innerHTML = ['all', ...Object.keys(WORK_TYPES)].map((k) =>
    `<button type="button" class="chip ${WM.skill === k ? 'active' : ''}" onclick="pickWageSkill('${k}')">${k === 'all' ? t('all') : WORK_TYPES[k].icon + ' ' + t(k)}</button>`).join('');
  const rows = WM.rows.filter((b) => WM.skill === 'all' || b.type === WM.skill);
  // Group into cells of about 2 km, per kind of work
  const cells = {};
  rows.forEach((b) => {
    const key = `${b.type}|${Math.round(b.lat * 50) / 50}|${Math.round(b.lng * 50) / 50}`;
    (cells[key] = cells[key] || []).push(b);
  });
  WM.layer.clearLayers();
  const list = Object.entries(cells).map(([key, jobs]) => {
    const [type, lat, lng] = key.split('|');
    const avg = Math.round(jobs.reduce((s, b) => s + dayRate(b), 0) / jobs.length / 10) * 10;
    const r = WORK_TYPES[type];
    const level = avg < r.min ? 'low' : avg > r.max ? 'high' : 'fair';
    return { type, lat: +lat, lng: +lng, avg, n: jobs.length, level, area: nearestArea({ lat: +lat, lng: +lng }) };
  }).sort((a, b) => b.n - a.n);
  const colors = { low: '#C62828', fair: '#1E8E4F', high: '#24408E' };
  list.forEach((c) => {
    L.circleMarker([c.lat, c.lng], { radius: 8 + Math.min(14, c.n * 2), color: colors[c.level], fillOpacity: 0.45 })
      .addTo(WM.layer)
      .bindPopup(`<b>${WORK_TYPES[c.type].icon} ${t(c.type)}</b><br>${esc(c.area)}<br>₹${c.avg} / ${t('dayUnit')} · ${c.n} ${t('reportJobs').toLowerCase()}<br>${t('fairRange')}: ₹${WORK_TYPES[c.type].min}–₹${WORK_TYPES[c.type].max}`);
  });
  document.getElementById('wageNote').textContent = tf('wageMapNote', rows.length);
  document.getElementById('wageList').innerHTML = list.slice(0, 20).map((c) => `
    <div class="rest-item"><span><i class="dot dot-${c.level}"></i> ${WORK_TYPES[c.type].icon} ${t(c.type)} · ${esc(c.area)}</span>
      <span><b>₹${c.avg}</b> <small class="muted">(${c.n})</small></span></div>`).join('') ||
    `<p class="muted">${t('wageMapEmpty')}</p>`;
}

// ---------- 14. Dispute room ----------
const EV = { b: null, employer: null, worker: null, msgs: [], mats: [] };

async function initEvidence() {
  initLangSelect();
  applyLang();
  App.onLang = () => { applyLang(); drawEvidence(); };
  const id = new URLSearchParams(location.search).get('b');
  if (!id) return (document.getElementById('evidence').innerHTML = `<p>${t('evidenceMissing')}</p>`);
  // Anyone with the link sees the evidence; phone numbers and exact places only the two people on the job
  const { data } = await db.rpc('dispute_evidence', { p_booking: id });
  if (!data) return (document.getElementById('evidence').innerHTML = `<p>${t('evidenceMissing')}</p>`);
  EV.b = data.booking;
  EV.employer = data.employer;
  EV.worker = data.worker;
  EV.msgs = data.messages || [];
  EV.mats = data.materials || [];
  drawEvidence();
}

function evidenceEvents(b) {
  const ev = [[b.created_at, t('ev_posted')]];
  if (b.accepted_at) ev.push([b.accepted_at, tf('ev_accepted', EV.worker ? EV.worker.name : t('worker'))]);
  if (b.started_at) {
    // Worked out by the database from the exact points (outsiders only get rounded ones)
    ev.push([b.started_at, b.start_m != null ? tf('ev_startedAt', b.start_m) : t('ev_started')]);
  }
  if (b.effort_status) {
    ev.push([b.effort_at, `😓 ${t('effortTitle')}: ${effortClaimText(b)} (+₹${b.effort_extra})`]);
    if (b.effort_status !== 'pending') ev.push([null, b.effort_status === 'accepted' ? tf('effortAccepted', b.effort_extra) : tf('effortRefused', b.effort_extra)]);
  }
  if (b.completed_at) ev.push([b.completed_at, b.rain_off ? t('ev_rain') : tf('ev_completed', fmtDuration(workedMinutes(b)), b.overtime_hours)]);
  if (b.paid_at) ev.push([b.paid_at, tf('ev_paid', amountOf(b))]);
  if (b.disputed) ev.push([b.paid_at, t('ev_disputed')]);
  if (b.worker_confirmed_at) ev.push([b.worker_confirmed_at, tf('ev_confirmed', b.receipt_no)]);
  if (['cancelled', 'expired'].includes(b.status)) ev.push([null, `${statusLabel(b.status)}${b.cancel_reason ? ' (' + b.cancel_reason + ')' : ''}`]);
  if (b.showup_pay) ev.push([b.showup_paid_at, b.showup_paid_at ? tf('showupPaid', b.showup_pay) : tf('showupOwed', b.showup_pay)]);
  return ev;
}

function drawEvidence() {
  const b = EV.b;
  if (!b) return;
  const e = EV.employer || {};
  const events = evidenceEvents(b).map(([at, text]) =>
    `<li><small>${at ? fmtDateTime(at) : '—'}</small><span>${esc(text)}</span></li>`).join('');
  const msgs = EV.msgs.map((m) => `<li><small>${fmtDateTime(m.created_at)} · ${m.sender === 'worker' ? t('worker') : t('employer')}</small><span>${esc(t('ph_' + m.phrase))}</span></li>`).join('');
  const mats = EV.mats.map((m) => `<li><span>${esc(m.item)} · ₹${m.amount}</span><span>${t('mat_' + m.status)}</span></li>`).join('');
  document.getElementById('evidence').innerHTML = `
    <div id="slipPrint">
      <div class="slip-head"><b>⚖️ Worker Buddy</b><span>${t('evidenceTitle')} · WB-${b.id.slice(0, 8).toUpperCase()}</span></div>
      ${b.disputed && !b.worker_confirmed_at ? `<p class="dispute-note">⚠️ ${t('ev_openDispute')}</p>` : ''}
      <div class="agreement">
        <div><span>${t('work')}</span><span>${WORK_TYPES[b.type].icon} ${t(b.type)}, ${esc(b.area)}</span></div>
        <div><span>${t('employer')}</span><span>${esc(e.name || '—')}${e.gstin ? ' · GST ' + esc(e.gstin) : ''} · ${scoreBadge(e)}</span></div>
        <div><span>${t('worker')}</span><span>${esc(EV.worker ? EV.worker.name : '—')}</span></div>
        <div><span>${t('hours')}</span><span>${b.hours} ${t('hoursUnit')}</span></div>
        <div><span>${t('agreedWage')}</span><span>₹${b.agreed_wage} (${t('fairRange')} ₹${b.wage_min}–₹${b.wage_max})</span></div>
        ${b.travel_pay ? `<div><span>${t('travelPay')}</span><span>+₹${b.travel_pay}</span></div>` : ''}
        <div><span><b>${t('totalPaid')}</b></span><span><b>₹${amountOf(b)}</b></span></div>
      </div>
      <h3>${t('ev_timeline')}</h3>
      <ul class="timeline">${events}</ul>
      ${msgs ? `<h3>💬 ${t('quickMessages')}</h3><ul class="timeline">${msgs}</ul>` : ''}
      ${mats ? `<h3>🧾 ${t('materialsTitle')}</h3><ul class="timeline">${mats}</ul>` : ''}
      <p class="muted small">${t('ev_note')}</p>
      <p class="muted small">${t('printedOn')}: ${fmtDateTime(new Date().toISOString())}</p>
    </div>`;
}

function shareEvidence() {
  const b = EV.b;
  if (!b) return;
  const lines = [`⚖️ Worker Buddy · ${t('evidenceTitle')} WB-${b.id.slice(0, 8).toUpperCase()}`,
    ...evidenceEvents(b).map(([at, text]) => `${at ? fmtDateTime(at) : '—'}: ${text}`), location.href];
  shareOnWhatsApp(lines.join('\n'));
}

// ---------- Text ----------
Object.assign(T.en, {
  wageMapTitle: 'Wage map',
  wageMapHint: 'What workers were actually paid near you, as an 8-hour day, from pay slips confirmed by both sides.',
  wageMapNote: (n) => `${n} confirmed paid job${n === 1 ? '' : 's'}. Circles are about 2 km wide; bigger means more jobs.`,
  wageMapEmpty: 'No confirmed payments here yet. The map fills in as people use Worker Buddy.',
  belowFair: 'Below fair range', withinFair: 'Within fair range', aboveFair: 'Above fair range',
  evidenceTitle: 'Job evidence',
  loading: 'Loading…',
  evidenceMissing: 'This job could not be found.',
  ev_timeline: 'What happened, with server times',
  ev_posted: 'Job posted with the fair rate shown',
  ev_accepted: (n) => `Accepted by ${n}`,
  ev_started: 'Work started with the employer’s OTP',
  ev_startedAt: (m) => `Work started with the employer’s OTP, ${m} m from the site`,
  ev_completed: (d, o) => `Work completed after ${d}${o ? ` (${o} h overtime)` : ''}`,
  ev_rain: 'Stopped by rain (paid for time worked, at least half)',
  ev_paid: (n) => `Employer marked ₹${n} as paid`,
  ev_disputed: 'Worker said the money was NOT received',
  ev_confirmed: (r) => `Worker confirmed receiving it (receipt ${r})`,
  ev_openDispute: 'Open dispute: the worker has not received this payment.',
  ev_note: 'Read-only record from Worker Buddy. Times come from the server, not from either phone.'
});

Object.assign(T.ta, {
  wageMapTitle: 'கூலி வரைபடம்',
  wageMapHint: 'அருகில் வேலையாட்களுக்கு உண்மையில் கொடுத்த கூலி, 8 மணி நேர நாளாக, இருவரும் உறுதி செய்த சம்பளச் சீட்டுகளிலிருந்து.',
  wageMapNote: (n) => `${n} உறுதியான கட்டண வேலைகள். வட்டங்கள் சுமார் 2 கி.மீ; பெரியது = அதிக வேலைகள்.`,
  wageMapEmpty: 'இங்கு இன்னும் உறுதியான கட்டணங்கள் இல்லை. மக்கள் பயன்படுத்தப் பயன்படுத்த வரைபடம் நிரம்பும்.',
  belowFair: 'நியாயத்துக்குக் கீழ்', withinFair: 'நியாய வரம்புக்குள்', aboveFair: 'நியாயத்துக்கு மேல்',
  evidenceTitle: 'வேலைச் சான்றுகள்',
  loading: 'ஏற்றுகிறது…',
  evidenceMissing: 'இந்த வேலையைக் கண்டுபிடிக்க முடியவில்லை.',
  ev_timeline: 'நடந்தது, சர்வர் நேரத்துடன்',
  ev_posted: 'நியாயமான கூலியுடன் வேலை பதிவிடப்பட்டது',
  ev_accepted: (n) => `${n} ஏற்றுக்கொண்டார்`,
  ev_started: 'முதலாளியின் OTP உடன் வேலை தொடங்கியது',
  ev_startedAt: (m) => `முதலாளியின் OTP உடன் வேலை தொடங்கியது, இடத்திலிருந்து ${m} மீ`,
  ev_completed: (d, o) => `${d} பின் வேலை முடிந்தது${o ? ` (${o} மணி கூடுதல்)` : ''}`,
  ev_rain: 'மழையால் நின்றது (செய்த நேரத்துக்கு, குறைந்தது பாதி)',
  ev_paid: (n) => `₹${n} கொடுத்ததாக முதலாளி குறித்தார்`,
  ev_disputed: 'பணம் கிடைக்கவில்லை என்று வேலையாள் சொன்னார்',
  ev_confirmed: (r) => `பெற்றதாக வேலையாள் உறுதி செய்தார் (ரசீது ${r})`,
  ev_openDispute: 'திறந்த புகார்: வேலையாளுக்கு இந்தப் பணம் கிடைக்கவில்லை.',
  ev_note: 'Worker Buddy இன் படிக்க மட்டுமான பதிவு. நேரங்கள் சர்வரிலிருந்து, எந்த போனிலிருந்தும் அல்ல.'
});

Object.assign(T.hi, {
  wageMapTitle: 'मज़दूरी नक्शा',
  wageMapHint: 'पास में मज़दूरों को असल में कितना मिला, 8 घंटे के दिन के हिसाब से, दोनों तरफ़ से पक्की पे स्लिप से।',
  wageMapNote: (n) => `${n} पक्के भुगतान वाले काम। गोले करीब 2 किमी के; बड़ा = ज़्यादा काम।`,
  wageMapEmpty: 'यहाँ अभी पक्के भुगतान नहीं। लोग इस्तेमाल करेंगे तो नक्शा भरेगा।',
  belowFair: 'सही से कम', withinFair: 'सही सीमा में', aboveFair: 'सही से ज़्यादा',
  evidenceTitle: 'काम के सबूत',
  loading: 'लोड हो रहा है…',
  evidenceMissing: 'यह काम नहीं मिला।',
  ev_timeline: 'क्या हुआ, सर्वर के समय के साथ',
  ev_posted: 'सही मज़दूरी दिखाकर काम पोस्ट हुआ',
  ev_accepted: (n) => `${n} ने माना`,
  ev_started: 'मालिक के OTP से काम शुरू हुआ',
  ev_startedAt: (m) => `मालिक के OTP से काम शुरू हुआ, जगह से ${m} मीटर पर`,
  ev_completed: (d, o) => `${d} बाद काम पूरा${o ? ` (${o} घंटे ओवरटाइम)` : ''}`,
  ev_rain: 'बारिश से रुका (किए गए समय का, कम से कम आधा)',
  ev_paid: (n) => `मालिक ने ₹${n} दिया लिखा`,
  ev_disputed: 'मज़दूर ने कहा पैसे नहीं मिले',
  ev_confirmed: (r) => `मज़दूर ने पैसे मिलना पक्का किया (रसीद ${r})`,
  ev_openDispute: 'खुली शिकायत: मज़दूर को यह भुगतान नहीं मिला।',
  ev_note: 'Worker Buddy का सिर्फ़ पढ़ने वाला रिकॉर्ड। समय सर्वर का है, किसी फ़ोन का नहीं।'
});
