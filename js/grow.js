// grow.js — growth for workers, tools for employers:
//   4. Contractor (mestri) crew book   19. Lessons with badges   20. Availability calendar
//   21. Streaks   22. Accident-cover interest   23. Favourite workers first
//   24. Monthly expense report   25. Repeat jobs   27. Shared phone mode
// (5. The wage map is its own page: /wages/)
// Load after care.js. Owner: Member 1 (worker side), Member 2 (employer side)

// ---------- 19. Short lessons (read aloud) with a one-question quiz ----------
const LESSONS = [
  { id: 'heat', icon: '🥵', q: 2, opts: 3 },
  { id: 'electric', icon: '⚡', q: 1, opts: 3 },
  { id: 'height', icon: '🪜', q: 3, opts: 3 },
  { id: 'rights', icon: '⚖️', q: 1, opts: 3 }
];

function lessonsHTML(done) {
  return `
    <h2>🎓 ${t('lessonsTitle')}</h2>
    <p class="muted">${t('lessonsHint')}</p>
    ${LESSONS.map((l) => `
      <button type="button" class="mini-card lesson-card" onclick="openLesson('${l.id}')">
        <span>${l.icon} <b>${t('lesson_' + l.id)}</b></span>
        <span>${done.includes(l.id) ? '✅' : '▶'}</span>
      </button>`).join('')}
    <p class="small">${t('moreCourses')} <a target="_blank" rel="noopener" href="https://www.skillindiadigital.gov.in">Skill India Digital</a></p>`;
}

function openLesson(id) {
  const l = LESSONS.find((x) => x.id === id);
  const body = t('lessonBody_' + id);
  const opts = [1, 2, 3].slice(0, l.opts).map((n) =>
    `<button type="button" class="btn btn-light btn-block" onclick="answerLesson('${id}', ${n})">${t('lessonOpt_' + id + '_' + n)}</button>`).join('');
  document.getElementById('slipBody').innerHTML = `
    <div class="slip" id="slipPrint">
      <h3>${l.icon} ${t('lesson_' + id)} ${speakButton(body)}</h3>
      <p>${body}</p>
      <p><b>${t('lessonQ_' + id)}</b></p>
      <div class="no-print">${opts}</div>
    </div>`;
  slipShareText = `${t('lesson_' + id)}\n${body}`;
  document.getElementById('slipModal').classList.add('open');
  speak(body);
}

async function answerLesson(id, n) {
  const l = LESSONS.find((x) => x.id === id);
  if (n !== l.q) return showToast(t('lessonWrong'));
  closeModal('slipModal');
  const done = [...new Set([...(W.me.lessons || []), id])];
  W.me.lessons = done;
  Store.set('w_me', W.me);
  if (navigator.onLine) await db.from('workers').update({ lessons: done }).eq('id', W.me.id);
  showToast(t('lessonDone'));
  renderLessons();
  renderHome();
}

function renderLessons() {
  const box = document.getElementById('lessons');
  if (box && W.me) box.innerHTML = lessonsHTML(W.me.lessons || []);
}

// ---------- 22. Accident cover (pilot idea) ----------
function coverHTML(on) {
  return `
    <b>🛡️ ${t('coverTitle')}</b>
    <p class="muted small">${t('coverHint')}</p>
    <label class="check"><input type="checkbox" ${on ? 'checked' : ''} onchange="setCover(this.checked)"> ${t('coverOptin')}</label>`;
}
async function setCover(on) {
  W.me.cover_optin = on;
  if (navigator.onLine) await db.from('workers').update({ cover_optin: on }).eq('id', W.me.id);
  showToast(on ? t('coverThanks') : t('coverOff'));
}
function renderCover() {
  const box = document.getElementById('coverCard');
  if (box && W.me) box.innerHTML = coverHTML(W.me.cover_optin);
}

// ---------- 20. Availability calendar: days I'm free in the next week ----------
// Dates as YYYY-MM-DD in the phone's own time zone (dayFromToday is in data.js)
function nextDays(n) {
  return Array.from({ length: n }, (_, i) => dayFromToday(i));
}
function dayLabel(iso) {
  return new Date(iso + 'T12:00:00').toLocaleDateString(localeTag(), { weekday: 'short', day: 'numeric' });
}
function availabilityHTML(days) {
  return `
    <b>📅 ${t('freeDaysTitle')}</b>
    <div class="chips wrap">${nextDays(7).map((d) =>
      `<button type="button" class="chip ${days.includes(d) ? 'active' : ''}" onclick="toggleFreeDay('${d}')">${dayLabel(d)}</button>`).join('')}</div>
    <p class="muted small">${t('freeDaysHint')}</p>`;
}
async function toggleFreeDay(d) {
  const today = dayFromToday(0);
  let days = (W.me.available_days || []).filter((x) => x >= today);
  days = days.includes(d) ? days.filter((x) => x !== d) : [...days, d].sort();
  W.me.available_days = days;
  renderAvailability();
  if (navigator.onLine) await db.from('workers').update({ available_days: days }).eq('id', W.me.id);
}
function renderAvailability() {
  const box = document.getElementById('freeDays');
  if (box && W.me) box.innerHTML = availabilityHTML(W.me.available_days || []);
}

// ---------- 4. Contractor (mestri) crew book ----------
const Crew = { members: [], attendance: [] };

function weekStart() {
  return dayFromToday(-((new Date().getDay() + 6) % 7)); // this Monday
}
function todayIso() { return dayFromToday(0); }

async function loadCrew() {
  if (!navigator.onLine) {
    Crew.members = Store.get('crew_members', []);
    Crew.attendance = Store.get('crew_att', []);
    return;
  }
  const { data: members } = await db.from('crew_members').select('*').eq('leader_id', W.me.id).order('id');
  Crew.members = members || [];
  const ids = Crew.members.map((m) => m.id);
  const { data: att } = ids.length
    ? await db.from('crew_attendance').select('*').in('member_id', ids).gte('day', weekStart()) : { data: [] };
  Crew.attendance = att || [];
  Store.set('crew_members', Crew.members);
  Store.set('crew_att', Crew.attendance);
}

function crewWeek(m) {
  const days = Crew.attendance.filter((a) => a.member_id === m.id && a.present);
  const unpaid = days.filter((a) => !a.paid);
  return { days: days.length, owed: unpaid.length * m.daily_wage, unpaidDays: unpaid.map((a) => a.day) };
}

async function renderCrewBook() {
  const box = document.getElementById('crewBook');
  if (!box || !W.me) return;
  await loadCrew();
  const today = todayIso();
  const rows = Crew.members.map((m) => {
    const here = Crew.attendance.find((a) => a.member_id === m.id && a.day === today && a.present);
    const wk = crewWeek(m);
    return `
      <div class="mini-card crew-member">
        <div><b>${esc(m.name)}</b> · ${money(m.daily_wage)}/${t('dayUnit')}<br>
          <span class="muted small">${tf('crewWeekLine', wk.days, wk.owed)}</span></div>
        <div class="actions">
          <button class="btn ${here ? 'btn-accept' : 'btn-light'} btn-small" onclick="markPresent(${m.id}, ${!here})">${here ? '✅ ' + t('present') : t('markPresent')}</button>
          ${wk.owed ? `<button class="btn btn-dark btn-small" onclick="payCrewWeek(${m.id})">${tf('payWeek', wk.owed)}</button>` : ''}
          <button class="btn btn-light btn-small" onclick="removeMember(${m.id})" aria-label="${attr(t('removeRestPoint'))}">🗑️</button>
        </div>
      </div>`;
  }).join('');
  const total = Crew.members.reduce((s, m) => s + crewWeek(m).owed, 0);
  box.innerHTML = `
    <h2>👥 ${t('crewTitle')}</h2>
    <p class="muted">${t('crewHint')}</p>
    <div class="card">
      <p><b>${tf('crewToday', Crew.attendance.filter((a) => a.day === today && a.present).length, Crew.members.length)}</b></p>
      <p class="small">${tf('crewOwed', total)}</p>
    </div>
    ${rows || `<p class="muted">${t('crewEmpty')}</p>`}
    <form class="card form" onsubmit="addMember(event)">
      <b>${t('addMember')}</b>
      <label><span>${t('memberName')}</span><input name="name" required maxlength="60"></label>
      <label><span>${t('memberPhone')}</span><input name="phone" type="tel" inputmode="tel" maxlength="20" placeholder="${attr(myCountry().phone_example)}"></label>
      <label><span>${t('dailyWage')}</span><input name="wage" type="number" inputmode="numeric" min="100" max="5000" required value="600"></label>
      <button class="btn btn-primary btn-block" type="submit">+ ${t('addMember')}</button>
    </form>`;
}

async function addMember(event) {
  event.preventDefault();
  const f = event.target;
  if (!navigator.onLine) return showToast(t('offlineBanner'));
  const row = { leader_id: W.me.id, name: f.name.value.trim(), phone: f.phone.value.trim() ? phoneIntl(f.phone.value) : null, daily_wage: parseInt(f.wage.value, 10) };
  if (f.phone.value.trim() && !row.phone) return showToast(t('badPhone'));
  const { error } = await db.from('crew_members').insert(row);
  if (error) return showToast(t('saveError'));
  renderCrewBook();
}

async function removeMember(id) {
  if (!confirm(t('removeMemberConfirm'))) return;
  const { error } = await db.from('crew_members').delete().eq('id', id);
  if (error) showToast(t('saveError'));
  renderCrewBook();
}

async function markPresent(id, present) {
  if (!navigator.onLine) return showToast(t('offlineBanner'));
  const day = todayIso();
  const { error } = present
    ? await db.from('crew_attendance').upsert({ member_id: id, day, present: true })
    : await db.from('crew_attendance').delete().eq('member_id', id).eq('day', day);
  if (error) showToast(t('saveError')); // the tick goes back, so the book never shows a day that wasn't saved
  renderCrewBook();
}

// Pay the week: marks the days paid and opens a pay slip the mestri can share
async function payCrewWeek(id) {
  const m = Crew.members.find((x) => x.id === id);
  const wk = crewWeek(m);
  if (!wk.owed) return;
  if (!navigator.onLine) return showToast(t('offlineBanner'));
  // Only show a "paid" slip once the days are really marked paid; otherwise they'd be paid twice
  const { error } = await db.from('crew_attendance').update({ paid: true }).eq('member_id', id).in('day', wk.unpaidDays);
  if (error) return showToast(t('saveError'));
  const lines = [
    `🧾 Worker Buddy · ${t('crewSlip')}`,
    `${t('worker')}: ${m.name}`,
    `${t('crewLeader')}: ${W.me.name} · ${W.me.phone}`,
    `${t('daysPaid')}: ${wk.unpaidDays.length} (${wk.unpaidDays.map(dayLabel).join(', ')})`,
    `${t('dailyWage')}: ${money(m.daily_wage)}`,
    `${t('totalPaid')}: ${money(wk.owed)}`,
    `${t('paidOn')}: ${fmtDateTime(new Date().toISOString())}`
  ];
  slipShareText = lines.join('\n');
  document.getElementById('slipBody').innerHTML = `
    <div class="slip" id="slipPrint">
      <div class="slip-head"><b>🤝 Worker Buddy</b><span>${t('crewSlip')}</span></div>
      <div class="slip-amount">${money(wk.owed)}</div>
      <div class="agreement">${lines.slice(1).map((l) => { const [k, ...v] = l.split(': '); return `<div><span>${esc(k)}</span><span>${esc(v.join(': '))}</span></div>`; }).join('')}</div>
    </div>`;
  const sms = document.getElementById('slipSms');
  if (sms) sms.href = smsLink(m.phone, slipShareText);
  document.getElementById('slipModal').classList.add('open');
  renderCrewBook();
}

// ---------- 23. Favourite workers ----------
const Fav = { ids: [] };
async function loadFavorites() {
  if (!navigator.onLine || !E.me) return;
  const { data } = await db.from('favorites').select('worker_id').eq('employer_id', E.me.id);
  Fav.ids = (data || []).map((r) => r.worker_id);
}
async function toggleFavorite(workerId) {
  if (Fav.ids.includes(workerId)) {
    const { error } = await db.from('favorites').delete().eq('employer_id', E.me.id).eq('worker_id', workerId);
    if (error) return showToast(t('saveError'));
    Fav.ids = Fav.ids.filter((x) => x !== workerId);
    showToast(t('favRemoved'));
  } else {
    const { error } = await db.from('favorites').insert({ employer_id: E.me.id, worker_id: workerId });
    if (error) return showToast(t('saveError'));
    Fav.ids.push(workerId);
    showToast(t('favAdded'));
  }
  if (App.onFavorites) App.onFavorites(workerId);
}

// Is this booking still reserved for the employer's favourites (first 60 seconds)?
function reservedFor(b) {
  if (!b.priority_ids || !b.priority_ids.length) return 0;
  return Math.max(0, Date.parse(b.created_at) + 60000 - Date.now());
}

// ---------- 24. Monthly expense report ----------
function openMonthlyReport(records, me) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const paid = records.filter((b) => b.status === 'paid' && Date.parse(b.paid_at) >= start);
  const showups = records.filter((b) => b.showup_paid_at && Date.parse(b.showup_paid_at) >= start);
  const total = paid.reduce((s, b) => s + amountOf(b), 0) + showups.reduce((s, b) => s + b.showup_pay, 0);
  const rows = paid.map((b) => `<tr><td>${fmtDateTime(b.paid_at)}</td><td>${t(b.type)}${b.worker ? ' · ' + esc(b.worker.name) : ''}</td>
    <td>${esc(b.receipt_no || '—')}</td><td class="num">${money(amountOf(b), b.currency)}</td></tr>`).join('') +
    showups.map((b) => `<tr><td>${fmtDateTime(b.showup_paid_at)}</td><td>${t('showupLabel')}</td><td>—</td><td class="num">${money(b.showup_pay, b.currency)}</td></tr>`).join('');
  const month = now.toLocaleDateString(localeTag(), { month: 'long', year: 'numeric' });
  document.getElementById('slipBody').innerHTML = `
    <div class="slip" id="slipPrint">
      <div class="slip-head"><b>🤝 Worker Buddy</b><span>${t('reportTitle')} · ${month}</span></div>
      <p><b>${esc(me.name)}</b>${me.gstin ? ` · GST ${esc(me.gstin)}` : ''}</p>
      <table class="statement"><thead><tr><th>${t('paidOn')}</th><th>${t('work')}</th><th>${t('receiptNo')}</th><th class="num">${moneySign()}</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="4">${t('noSlips')}</td></tr>`}</tbody></table>
      <div class="agreement"><div><span><b>${t('reportTotal')}</b></span><span><b>${money(total)}</b></span></div>
        <div><span>${t('reportJobs')}</span><span>${paid.length}</span></div></div>
      <p class="muted small">${t('printedOn')}: ${fmtDateTime(new Date().toISOString())}</p>
    </div>`;
  slipShareText = `${t('reportTitle')} ${month}: ${money(total)} (${paid.length} ${t('reportJobs').toLowerCase()})`;
  document.getElementById('slipModal').classList.add('open');
}

// ---------- 25. Repeat jobs: every week, same day and time ----------
function nextOccurrence(weekday, atTime) {
  const [h, m] = atTime.split(':').map(Number);
  const d = new Date();
  d.setSeconds(0, 0);
  d.setHours(h, m);
  let add = (weekday - d.getDay() + 7) % 7;
  if (add === 0 && d.getTime() - Date.now() < LATER_MIN_MINUTES * 60000) add = 7;
  d.setDate(d.getDate() + add);
  return d;
}

// Repeat jobs are created by the server every 10 minutes (supabase/010_repeat_jobs_cron.sql)

async function stopRepeat(id) {
  await db.from('repeat_jobs').update({ active: false }).eq('id', id).eq('employer_id', E.me.id);
  showToast(t('repeatStopped'));
  if (App.onRepeat) App.onRepeat();
}

// ---------- 27. Shared phone mode: several workers on one family phone, each with a PIN ----------
async function pinHash(pin) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('wb-pin:' + pin));
  return Array.from(new Uint8Array(hash)).map((x) => x.toString(16).padStart(2, '0')).join('');
}

function phoneProfiles() {
  return Store.get('profiles', []);
}

async function addWorkerOnPhone() {
  const list = phoneProfiles();
  const me = list.find((p) => p.device === deviceId());
  if (!me) {
    const pin = prompt(t('setPin'));
    if (!/^\d{4}$/.test(pin || '')) return showToast(t('pinBad'));
    list.push({ device: deviceId(), name: W.me ? W.me.name : '?', pin: await pinHash(pin) });
  }
  const fresh = crypto.randomUUID();
  list.push({ device: fresh, name: '…', pin: null });
  Store.set('profiles', list);
  Store.set('device', fresh);
  clearWorkerCache();
  location.reload();
}

async function switchWorker(device) {
  const list = phoneProfiles();
  const p = list.find((x) => x.device === device);
  if (!p) return;
  if (p.pin) {
    const pin = prompt(tf('enterPinFor', p.name));
    if (!pin || (await pinHash(pin)) !== p.pin) return showToast(t('pinWrong'));
  }
  Store.set('device', device);
  clearWorkerCache();
  location.reload();
}

// The saved copies belong to the previous worker on this phone
function clearWorkerCache() {
  ['w_me', 'w_active', 'w_employer'].forEach((k) => Store.set(k, null));
  ['w_records', 'w_slips', 'queue', 'crew_members', 'crew_att'].forEach((k) => Store.set(k, []));
}

// Called when a new profile on a shared phone finishes signing up: set its PIN
async function rememberProfile() {
  const list = phoneProfiles();
  const p = list.find((x) => x.device === deviceId());
  if (!p || !W.me) return;
  p.name = W.me.name;
  if (!p.pin) {
    const pin = prompt(t('setPin'));
    if (/^\d{4}$/.test(pin || '')) p.pin = await pinHash(pin);
  }
  Store.set('profiles', list);
}

function sharedPhoneHTML() {
  const list = phoneProfiles().filter((p) => p.device !== deviceId());
  return `
    <b>📱 ${t('sharedPhoneTitle')}</b>
    <p class="muted small">${t('sharedPhoneHint')}</p>
    ${list.map((p) => `<button class="btn btn-light btn-block" onclick="switchWorker('${p.device}')">🔁 ${esc(p.name)}</button>`).join('')}
    <button class="btn btn-dark btn-block" onclick="addWorkerOnPhone()">+ ${t('addWorkerPhone')}</button>`;
}
function renderSharedPhone() {
  const box = document.getElementById('sharedPhone');
  if (box) box.innerHTML = sharedPhoneHTML();
}

// ---------- Text ----------
Object.assign(T.en, {
  lessonsTitle: 'Learn and earn badges',
  lessonsHint: 'Short lessons, read aloud. Answer one question to earn a badge employers can see.',
  moreCourses: 'More free courses:',
  lesson_heat: 'Staying safe in the heat', lesson_electric: 'Electrical safety', lesson_height: 'Working at height', lesson_rights: 'Your wage rights',
  lessonBody_heat: 'Drink water every 20 minutes, even if you are not thirsty. Rest in shade every hour on hot days. Wear a cap and light clothes. Dizziness, headache or confusion are danger signs: stop, cool down and call 108.',
  lessonBody_electric: 'Always switch off the main power before touching wires. Use insulated tools and rubber slippers. Never work on wires with wet hands. If someone gets a shock, switch off the power before touching them.',
  lessonBody_height: 'Use a safety harness above 2 metres. Check the ladder is steady and on flat ground. Keep three points of contact: two hands and a foot, or two feet and a hand. Never work at height when dizzy or in rain.',
  lessonBody_rights: 'Agree the wage before you start. After the agreed hours, overtime must be paid. You must get the money you agreed, and a pay slip proves it. If you are not paid, you can complain and get free legal help on 15100.',
  lessonQ_heat: 'On a hot day, how often should you rest in the shade?',
  lessonOpt_heat_1: 'Only at lunch', lessonOpt_heat_2: 'Every hour', lessonOpt_heat_3: 'Never',
  lessonQ_electric: 'What do you do first before touching wires?',
  lessonOpt_electric_1: 'Switch off the main power', lessonOpt_electric_2: 'Wet your hands', lessonOpt_electric_3: 'Work faster',
  lessonQ_height: 'Above what height should you use a harness?',
  lessonOpt_height_1: '10 metres', lessonOpt_height_2: 'Never', lessonOpt_height_3: '2 metres',
  lessonQ_rights: 'When should the wage be agreed?',
  lessonOpt_rights_1: 'Before starting work', lessonOpt_rights_2: 'At the end of the day', lessonOpt_rights_3: 'Next week',
  lessonWrong: 'Not quite. Listen again and try once more.',
  lessonDone: '🎓 Lesson done! Badge added to your profile.',
  safetyBadge: 'Safety trained',
  streakBadge: (n) => `${n} great jobs in a row`,
  coverTitle: '₹2 a day accident cover (pilot)',
  coverHint: 'Planned with an insurance partner: cover only on days you work, paid with the job. Not active yet. PMSBY (₹20 a year) is available now in Schemes.',
  coverOptin: 'I’m interested',
  coverThanks: 'Thanks! We’ll tell you when it starts.',
  coverOff: 'Removed your interest.',
  freeDaysTitle: 'Days I’m free this week',
  freeDaysHint: 'Employers booking for later see you on these days.',
  freeOnDay: (n) => `${n} worker${n === 1 ? '' : 's'} said they are free that day`,
  crewNav: 'Crew',
  crewTitle: 'My crew (mestri)',
  crewHint: 'Mark who came each day. Weekly pay is worked out, and each member gets a pay slip by SMS or WhatsApp.',
  crewToday: (a, n) => `Today: ${a} of ${n} present`,
  crewOwed: (n) => `To pay this week: ${money(n)}`,
  crewWeekLine: (d, o) => `${d} day${d === 1 ? '' : 's'} this week · to pay ${money(o)}`,
  crewEmpty: 'No crew members yet. Add them below.',
  addMember: 'Add crew member',
  dailyWage: 'Daily wage',
  dayUnit: 'day',
  present: 'Present',
  markPresent: 'Mark present',
  payWeek: (n) => `Pay ${money(n)}`,
  removeMemberConfirm: 'Remove this crew member?',
  crewSlip: 'Crew pay slip',
  memberName: 'Member’s name',
  memberPhone: 'Member’s phone (for the pay slip SMS)',
  daysPaid: 'Days paid for',
  crewLeader: 'Mestri',
  isMestri: 'I am a mestri / contractor with a crew',
  favAdd: '🤍 Save as favourite',
  favOn: '❤️ Favourite',
  favAdded: 'Saved to your favourites ❤️',
  favRemoved: 'Removed from favourites',
  favFirst: '❤️ Send to my favourite workers first (1 minute)',
  favReserved: '❤️ Your favourites see this job first',
  reportBtn: '📊 Monthly report',
  reportTitle: 'Labour expense report',
  reportTotal: 'Total paid',
  reportJobs: 'Jobs',
  repeatWeekly: '🔁 Repeat every week',
  repeatTag: '🔁 Weekly',
  repeatStop: 'Stop repeating',
  repeatStopped: 'This job will not repeat any more.',
  sharedPhoneTitle: 'Shared phone',
  sharedPhoneHint: 'Family or friends can use their own Worker Buddy on this phone, each with a 4-digit PIN.',
  addWorkerPhone: 'Add another worker on this phone',
  setPin: 'Set a 4-digit PIN for this worker',
  enterPinFor: (n) => `PIN for ${n}`,
  pinBad: 'The PIN must be 4 digits.',
  pinWrong: 'Wrong PIN.',
  wageMapLink: '🗺️ Wage map: what people are paid near you'
});

Object.assign(T.ta, {
  lessonsTitle: 'கற்று பேட்ஜ் பெறுங்கள்',
  lessonsHint: 'சிறு பாடங்கள், சத்தமாகப் படிக்கப்படும். ஒரு கேள்விக்கு பதில் சொன்னால் முதலாளிகள் பார்க்கும் பேட்ஜ் கிடைக்கும்.',
  moreCourses: 'மேலும் இலவச பயிற்சிகள்:',
  lesson_heat: 'வெயிலில் பாதுகாப்பு', lesson_electric: 'மின் பாதுகாப்பு', lesson_height: 'உயரத்தில் வேலை', lesson_rights: 'உங்கள் கூலி உரிமைகள்',
  lessonBody_heat: 'தாகம் இல்லாவிட்டாலும் 20 நிமிடத்துக்கு ஒருமுறை தண்ணீர் குடியுங்கள். வெப்ப நாளில் ஒவ்வொரு மணி நேரமும் நிழலில் ஓய்வெடுங்கள். தொப்பியும் லேசான உடையும் அணியுங்கள். தலைசுற்றல், தலைவலி, குழப்பம் ஆபத்தின் அறிகுறி: நிறுத்தி, குளிர்ந்து, 108 அழையுங்கள்.',
  lessonBody_electric: 'கம்பிகளைத் தொடும் முன் எப்போதும் மெயின் சுவிட்சை அணையுங்கள். காப்பிடப்பட்ட கருவிகள், ரப்பர் செருப்பு பயன்படுத்துங்கள். ஈரக் கையால் கம்பியில் வேலை செய்யாதீர்கள். யாருக்காவது ஷாக் அடித்தால், அவரைத் தொடும் முன் மின்சாரத்தை அணையுங்கள்.',
  lessonBody_height: '2 மீட்டருக்கு மேல் பாதுகாப்பு பெல்ட் அணியுங்கள். ஏணி சமமான தரையில் உறுதியாக உள்ளதா எனப் பாருங்கள். மூன்று பிடிப்புகள்: இரு கைகள் ஒரு கால், அல்லது இரு கால்கள் ஒரு கை. தலைசுற்றும்போதோ மழையிலோ உயரத்தில் வேலை செய்யாதீர்கள்.',
  lessonBody_rights: 'தொடங்கும் முன் கூலியை ஒப்புக்கொள்ளுங்கள். ஒப்புக்கொண்ட நேரத்துக்கு மேல் கூடுதல் கூலி தர வேண்டும். ஒப்புக்கொண்ட பணம் உங்களுக்குக் கிடைக்க வேண்டும்; சம்பளச் சீட்டு அதற்குச் சான்று. கொடுக்காவிட்டால் புகார் செய்து 15100 இல் இலவச சட்ட உதவி பெறலாம்.',
  lessonQ_heat: 'வெப்ப நாளில் எவ்வளவு நேரத்துக்கு ஒருமுறை நிழலில் ஓய்வெடுக்க வேண்டும்?',
  lessonOpt_heat_1: 'மதிய உணவின்போது மட்டும்', lessonOpt_heat_2: 'ஒவ்வொரு மணி நேரமும்', lessonOpt_heat_3: 'ஒருபோதும் இல்லை',
  lessonQ_electric: 'கம்பிகளைத் தொடும் முன் முதலில் என்ன செய்வீர்கள்?',
  lessonOpt_electric_1: 'மெயின் சுவிட்சை அணைப்பேன்', lessonOpt_electric_2: 'கையை நனைப்பேன்', lessonOpt_electric_3: 'வேகமாக வேலை செய்வேன்',
  lessonQ_height: 'எந்த உயரத்துக்கு மேல் பாதுகாப்பு பெல்ட் தேவை?',
  lessonOpt_height_1: '10 மீட்டர்', lessonOpt_height_2: 'தேவையில்லை', lessonOpt_height_3: '2 மீட்டர்',
  lessonQ_rights: 'கூலியை எப்போது ஒப்புக்கொள்ள வேண்டும்?',
  lessonOpt_rights_1: 'வேலை தொடங்கும் முன்', lessonOpt_rights_2: 'நாள் முடிவில்', lessonOpt_rights_3: 'அடுத்த வாரம்',
  lessonWrong: 'சரியில்லை. மீண்டும் கேட்டு முயற்சி செய்யுங்கள்.',
  lessonDone: '🎓 பாடம் முடிந்தது! பேட்ஜ் சேர்க்கப்பட்டது.',
  safetyBadge: 'பாதுகாப்புப் பயிற்சி',
  streakBadge: (n) => `தொடர்ந்து ${n} சிறந்த வேலைகள்`,
  coverTitle: 'நாளுக்கு ₹2 விபத்துக் காப்பீடு (சோதனை)',
  coverHint: 'காப்பீட்டு நிறுவனத்துடன் திட்டமிடப்பட்டது: வேலை செய்யும் நாட்களில் மட்டும், வேலையுடன் செலுத்தப்படும். இன்னும் தொடங்கவில்லை. PMSBY (ஆண்டுக்கு ₹20) இப்போதே திட்டங்களில் உள்ளது.',
  coverOptin: 'எனக்கு விருப்பம்',
  coverThanks: 'நன்றி! தொடங்கியதும் சொல்வோம்.',
  coverOff: 'உங்கள் விருப்பம் நீக்கப்பட்டது.',
  freeDaysTitle: 'இந்த வாரம் நான் காலியாக உள்ள நாட்கள்',
  freeDaysHint: 'பின்னருக்கு புக் செய்யும் முதலாளிகள் இந்த நாட்களில் உங்களைப் பார்ப்பார்கள்.',
  freeOnDay: (n) => `அன்று ${n} வேலையாட்கள் காலியாக உள்ளனர்`,
  crewNav: 'குழு',
  crewTitle: 'என் குழு (மேஸ்திரி)',
  crewHint: 'ஒவ்வொரு நாளும் யார் வந்தார் என்று குறியுங்கள். வாரக் கூலி கணக்கிடப்படும், ஒவ்வொருவருக்கும் SMS அல்லது வாட்ஸ்அப்பில் சம்பளச் சீட்டு.',
  crewToday: (a, n) => `இன்று: ${n} இல் ${a} பேர் வந்தனர்`,
  crewOwed: (n) => `இந்த வாரம் கொடுக்க வேண்டியது: ${money(n)}`,
  crewWeekLine: (d, o) => `இந்த வாரம் ${d} நாள் · கொடுக்க ${money(o)}`,
  crewEmpty: 'இன்னும் குழு உறுப்பினர்கள் இல்லை. கீழே சேருங்கள்.',
  addMember: 'குழு உறுப்பினரைச் சேர்',
  dailyWage: 'தினக் கூலி',
  dayUnit: 'நாள்',
  present: 'வந்தார்',
  markPresent: 'வருகை குறி',
  payWeek: (n) => `${money(n)} கொடு`,
  removeMemberConfirm: 'இந்த உறுப்பினரை நீக்கவா?',
  crewSlip: 'குழு சம்பளச் சீட்டு',
  memberName: 'உறுப்பினர் பெயர்',
  memberPhone: 'உறுப்பினர் போன் (சம்பளச் சீட்டு SMS க்கு)',
  daysPaid: 'கூலி கொடுத்த நாட்கள்',
  crewLeader: 'மேஸ்திரி',
  isMestri: 'நான் குழுவுடன் உள்ள மேஸ்திரி / ஒப்பந்ததாரர்',
  favAdd: '🤍 விருப்பமானவராகச் சேமி',
  favOn: '❤️ விருப்பமானவர்',
  favAdded: 'உங்கள் விருப்பப் பட்டியலில் சேர்ந்தது ❤️',
  favRemoved: 'விருப்பப் பட்டியலிலிருந்து நீக்கப்பட்டது',
  favFirst: '❤️ முதலில் என் விருப்ப வேலையாட்களுக்கு அனுப்பு (1 நிமிடம்)',
  favReserved: '❤️ உங்கள் விருப்பமானவர்கள் இந்த வேலையை முதலில் பார்ப்பார்கள்',
  reportBtn: '📊 மாத அறிக்கை',
  reportTitle: 'கூலிச் செலவு அறிக்கை',
  reportTotal: 'மொத்தம் கொடுத்தது',
  reportJobs: 'வேலைகள்',
  repeatWeekly: '🔁 ஒவ்வொரு வாரமும் மீண்டும்',
  repeatTag: '🔁 வாராந்திரம்',
  repeatStop: 'மீண்டும் செய்வதை நிறுத்து',
  repeatStopped: 'இந்த வேலை இனி மீண்டும் வராது.',
  sharedPhoneTitle: 'பகிர்ந்த போன்',
  sharedPhoneHint: 'குடும்பத்தினர் அல்லது நண்பர்கள் இந்த போனில் தங்கள் Worker Buddy ஐ 4 இலக்க PIN உடன் பயன்படுத்தலாம்.',
  addWorkerPhone: 'இந்த போனில் மற்றொரு வேலையாளைச் சேர்',
  setPin: 'இந்த வேலையாளுக்கு 4 இலக்க PIN அமையுங்கள்',
  enterPinFor: (n) => `${n} க்கான PIN`,
  pinBad: 'PIN 4 இலக்கமாக இருக்க வேண்டும்.',
  pinWrong: 'தவறான PIN.',
  wageMapLink: '🗺️ கூலி வரைபடம்: அருகில் எவ்வளவு கொடுக்கிறார்கள்'
});

Object.assign(T.hi, {
  lessonsTitle: 'सीखें और बैज पाएँ',
  lessonsHint: 'छोटे पाठ, पढ़कर सुनाए जाते हैं। एक सवाल का जवाब दें और मालिकों को दिखने वाला बैज पाएँ।',
  moreCourses: 'और मुफ़्त कोर्स:',
  lesson_heat: 'गर्मी में सुरक्षा', lesson_electric: 'बिजली की सुरक्षा', lesson_height: 'ऊँचाई पर काम', lesson_rights: 'आपके मज़दूरी के हक़',
  lessonBody_heat: 'प्यास न हो तब भी हर 20 मिनट पानी पिएँ। गर्म दिन हर घंटे छाया में आराम करें। टोपी और हल्के कपड़े पहनें। चक्कर, सिरदर्द या उलझन खतरे के संकेत हैं: रुकें, ठंडा करें और 108 पर फ़ोन करें।',
  lessonBody_electric: 'तार छूने से पहले हमेशा मेन स्विच बंद करें। इंसुलेटेड औज़ार और रबर की चप्पल इस्तेमाल करें। गीले हाथों से तार पर काम न करें। किसी को करंट लगे तो छूने से पहले बिजली बंद करें।',
  lessonBody_height: '2 मीटर से ऊपर सेफ़्टी बेल्ट लगाएँ। सीढ़ी समतल ज़मीन पर मज़बूत हो, देखें। तीन पकड़ रखें: दो हाथ एक पैर, या दो पैर एक हाथ। चक्कर या बारिश में ऊँचाई पर काम न करें।',
  lessonBody_rights: 'काम शुरू करने से पहले मज़दूरी तय करें। तय घंटों के बाद ओवरटाइम मिलना चाहिए। तय पैसा आपको मिलना चाहिए, और पे स्लिप उसका सबूत है। पैसे न मिलें तो शिकायत करें, 15100 पर मुफ़्त कानूनी मदद लें।',
  lessonQ_heat: 'गर्म दिन कितनी बार छाया में आराम करना चाहिए?',
  lessonOpt_heat_1: 'सिर्फ़ खाने के समय', lessonOpt_heat_2: 'हर घंटे', lessonOpt_heat_3: 'कभी नहीं',
  lessonQ_electric: 'तार छूने से पहले सबसे पहले क्या करें?',
  lessonOpt_electric_1: 'मेन स्विच बंद करें', lessonOpt_electric_2: 'हाथ गीले करें', lessonOpt_electric_3: 'जल्दी काम करें',
  lessonQ_height: 'कितनी ऊँचाई के ऊपर सेफ़्टी बेल्ट चाहिए?',
  lessonOpt_height_1: '10 मीटर', lessonOpt_height_2: 'कभी नहीं', lessonOpt_height_3: '2 मीटर',
  lessonQ_rights: 'मज़दूरी कब तय करनी चाहिए?',
  lessonOpt_rights_1: 'काम शुरू करने से पहले', lessonOpt_rights_2: 'दिन के अंत में', lessonOpt_rights_3: 'अगले हफ़्ते',
  lessonWrong: 'सही नहीं। फिर से सुनें और कोशिश करें।',
  lessonDone: '🎓 पाठ पूरा! बैज जुड़ गया।',
  safetyBadge: 'सुरक्षा प्रशिक्षित',
  streakBadge: (n) => `लगातार ${n} बढ़िया काम`,
  coverTitle: '₹2 रोज़ का दुर्घटना बीमा (पायलट)',
  coverHint: 'बीमा कंपनी के साथ योजना: सिर्फ़ काम के दिन, काम के साथ भुगतान। अभी शुरू नहीं हुआ। PMSBY (₹20 सालाना) अभी योजनाओं में है।',
  coverOptin: 'मुझे रुचि है',
  coverThanks: 'धन्यवाद! शुरू होने पर बताएँगे।',
  coverOff: 'आपकी रुचि हटा दी गई।',
  freeDaysTitle: 'इस हफ़्ते मैं किन दिनों खाली हूँ',
  freeDaysHint: 'बाद के लिए बुक करने वाले मालिक इन दिनों आपको देखेंगे।',
  freeOnDay: (n) => `उस दिन ${n} मज़दूर खाली हैं`,
  crewNav: 'टीम',
  crewTitle: 'मेरी टीम (मिस्त्री/ठेकेदार)',
  crewHint: 'हर दिन कौन आया, लगाएँ। हफ़्ते की मज़दूरी गिनी जाती है, और हर सदस्य को SMS या व्हाट्सऐप पर पे स्लिप।',
  crewToday: (a, n) => `आज: ${n} में से ${a} आए`,
  crewOwed: (n) => `इस हफ़्ते देना है: ${money(n)}`,
  crewWeekLine: (d, o) => `इस हफ़्ते ${d} दिन · देना ${money(o)}`,
  crewEmpty: 'अभी टीम में कोई नहीं। नीचे जोड़ें।',
  addMember: 'टीम सदस्य जोड़ें',
  dailyWage: 'रोज़ की मज़दूरी',
  dayUnit: 'दिन',
  present: 'आया',
  markPresent: 'हाज़िरी लगाएँ',
  payWeek: (n) => `${money(n)} दें`,
  removeMemberConfirm: 'इस सदस्य को हटाएँ?',
  crewSlip: 'टीम पे स्लिप',
  memberName: 'सदस्य का नाम',
  memberPhone: 'सदस्य का फ़ोन (पे स्लिप SMS के लिए)',
  daysPaid: 'जिन दिनों का पैसा दिया',
  crewLeader: 'मिस्त्री',
  isMestri: 'मैं टीम वाला मिस्त्री / ठेकेदार हूँ',
  favAdd: '🤍 पसंदीदा में सेव करें',
  favOn: '❤️ पसंदीदा',
  favAdded: 'पसंदीदा में जुड़ गया ❤️',
  favRemoved: 'पसंदीदा से हटाया',
  favFirst: '❤️ पहले मेरे पसंदीदा मज़दूरों को भेजें (1 मिनट)',
  favReserved: '❤️ आपके पसंदीदा यह काम पहले देखेंगे',
  reportBtn: '📊 महीने की रिपोर्ट',
  reportTitle: 'मज़दूरी खर्च रिपोर्ट',
  reportTotal: 'कुल दिया',
  reportJobs: 'काम',
  repeatWeekly: '🔁 हर हफ़्ते दोहराएँ',
  repeatTag: '🔁 हर हफ़्ते',
  repeatStop: 'दोहराना बंद करें',
  repeatStopped: 'यह काम अब नहीं दोहराया जाएगा।',
  sharedPhoneTitle: 'साझा फ़ोन',
  sharedPhoneHint: 'परिवार या दोस्त इसी फ़ोन पर अपना Worker Buddy 4 अंकों के PIN के साथ चला सकते हैं।',
  addWorkerPhone: 'इस फ़ोन पर दूसरा मज़दूर जोड़ें',
  setPin: 'इस मज़दूर के लिए 4 अंकों का PIN रखें',
  enterPinFor: (n) => `${n} का PIN`,
  pinBad: 'PIN 4 अंकों का होना चाहिए।',
  pinWrong: 'गलत PIN।',
  wageMapLink: '🗺️ मज़दूरी नक्शा: पास में कितना मिलता है'
});
