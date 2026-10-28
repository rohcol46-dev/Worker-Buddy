// buddy.js — four worker tools for work found outside the app (ideas from Apna Safety and
// day-labourer wage-theft apps):
//   1. Scam warning card   2. "Is my pay fair?"   3. Check this employer (supabase/032)
//   4. My own jobs log: work found outside the app, what was promised and paid, kept on this phone
// Load after grow.js. Owner: Member 3

// ---------- 1. Scam warning card ----------
function scamCardHTML() {
  const lines = ['scam1', 'scam2', 'scam3', 'scam4', 'scam5'].map((k) => `<li>${t(k)}</li>`).join('');
  const speech = [t('scamTitle'), ...['scam1', 'scam2', 'scam3', 'scam4', 'scam5'].map((k) => t(k))].join('. ');
  return `
    <b>🚩 ${t('scamTitle')}</b> ${speakButton(speech)}
    <ul class="scam-list">${lines}</ul>
    <p class="small">${myCountry().code === 'IN' ? t('scamHelpIN') : t('scamHelp')}</p>`;
}

// ---------- 2. Is my pay fair? ----------
// The legal least for the job: the trade's legal day rate, by the hour for short jobs, plus overtime
function legalFloorFor(job) {
  const day = tradeRange(job.type).floor;
  const hours = Number(job.hours) || 8;
  if (hours < 8) return ceilMoney(day * Math.max(hours / 8, payRule('short_min')));
  return day + ceilMoney(((hours - 8) * day * payRule('overtime')) / 8);
}

function payVerdict(job, amount) {
  const w = estimateWage(job);
  const floor = legalFloorFor(job);
  if (amount < floor) return { kind: 'illegal', text: tf('payIllegal', amount, floor, w.min, w.max), w };
  if (amount < w.min) return { kind: 'low', text: tf('payLow', amount, w.min, w.max), w };
  if (amount > w.max) return { kind: 'good', text: tf('payGood', amount, w.min, w.max), w };
  return { kind: 'fair', text: tf('payFair', amount, w.min, w.max), w };
}

function payCheckHTML() {
  const loads = ['light', 'medium', 'heavy'].map((l) => `<option value="${l}">${t('load_' + l)}</option>`).join('');
  return `
    <b>⚖️ ${t('payCheckTitle')}</b>
    <p class="muted small">${t('payCheckHint')}</p>
    <form id="payCheckForm" class="form" onsubmit="event.preventDefault(); checkMyPay(this)">
      <label><span>${t('payCheckWork')}</span><select name="type" id="payCheckType"></select></label>
      <div class="row">
        <label><span>${t('payCheckHours')}</span><input name="hours" type="number" inputmode="numeric" min="1" max="14" value="8" required></label>
        <label><span>${t('payCheckLoad')}</span><select name="load">${loads}</select></label>
      </div>
      <label class="check"><input type="checkbox" name="risky"> <span>${t('payCheckRisky')}</span></label>
      <label class="check"><input type="checkbox" name="night"> <span>${t('payCheckNight')}</span></label>
      <label><span>${t('payCheckOffered')}</span><input name="amount" type="number" inputmode="numeric" min="1" max="1000000" required placeholder="${attr(moneySign())}"></label>
      <button class="btn btn-dark btn-block" type="submit">${t('payCheckBtn')}</button>
    </form>
    <div id="payCheckAnswer"></div>`;
}

function checkMyPay(form) {
  const job = {
    type: form.type.value,
    hours: Math.min(14, Math.max(1, parseInt(form.hours.value, 10) || 8)),
    load: form.load.value,
    risky: form.risky.checked,
    night: form.night.checked
  };
  const amount = Number(form.amount.value);
  if (!(amount > 0)) return;
  const v = payVerdict(job, amount);
  document.getElementById('payCheckAnswer').innerHTML = `
    <div class="helper-answer verdict-${v.kind}">
      <p>${esc(v.text)} ${speakButton(v.text)}</p>
      <details><summary class="small">${t('payCheckWhy')}</summary>${wageBoxHTML(v.w)}</details>
    </div>`;
  speak(v.text);
}

// Redrawn on a language change: keeps what was typed, and the worker's own trade until they pick another
function renderPayCheck() {
  const box = document.getElementById('payCheck');
  if (!box) return;
  const old = document.getElementById('payCheckForm');
  const kept = old && old.dataset.touched ? {
    type: old.type.value, hours: old.hours.value, load: old.load.value,
    risky: old.risky.checked, night: old.night.checked, amount: old.amount.value
  } : null;
  const answered = !!(document.getElementById('payCheckAnswer') || {}).innerHTML;
  box.innerHTML = payCheckHTML();
  const form = document.getElementById('payCheckForm');
  form.addEventListener('change', () => { form.dataset.touched = '1'; });
  fillSelect(form.type, kept ? kept.type : (typeof W !== 'undefined' && W.me ? W.me.skill : 'coolie'));
  if (!kept) return;
  form.dataset.touched = '1';
  form.hours.value = kept.hours;
  form.load.value = kept.load;
  form.risky.checked = kept.risky;
  form.night.checked = kept.night;
  form.amount.value = kept.amount;
  if (answered && form.amount.value) checkMyPay(form);
}

// ---------- 3. Check this employer ----------
// Only the employer's record comes back: never their name, number or place (supabase/032)
const EmpCheck = { last: null, busy: false };

function employerCheckHTML() {
  return `
    <b>🔎 ${t('empCheckTitle')}</b>
    <p class="muted small">${t('empCheckHint')}</p>
    <form class="row" onsubmit="event.preventDefault(); checkEmployer(this.phone.value)">
      <input name="phone" class="input" type="tel" inputmode="tel" data-phone maxlength="20" required placeholder="${attr(myCountry().phone_example || '9876543210')}" autocomplete="off">
      <button class="btn btn-dark btn-small" type="submit">${t('empCheckBtn')}</button>
    </form>
    <div id="empCheckAnswer">${EmpCheck.last ? employerRecordHTML(EmpCheck.last) : ''}</div>`;
}

function employerRecordHTML(r) {
  if (!r.found) return `<div class="helper-answer"><p>${t('empNotFound')}</p></div>`;
  const e = { jobs: r.jobs, paid_on_time: r.paid_on_time, rating_sum: r.rating_sum, rating_count: r.rating_count };
  const stars = r.rating_count ? (r.rating_sum / r.rating_count).toFixed(1) : null;
  const tags = Object.entries(r.tags || {})
    .filter(([k]) => T.en['tag_' + k])
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `<span class="chip">${esc(t('tag_' + k))} ×${Number(n)}</span>`).join('');
  const warn = [];
  if (r.on_hold) warn.push(t('empOnHold'));
  if (r.not_paid) warn.push(tf('empNotPaid', r.not_paid));
  if (r.unpaid_cancels) warn.push(tf('empUnpaidCancels', r.unpaid_cancels));
  return `
    <div class="helper-answer emp-record">
      <p>${scoreBadge(e)} ${r.gst_verified ? `<span class="small">${t('gstVerified')}</span>` : ''}</p>
      <p class="small">${tf('empJobs', r.jobs, r.paid_on_time)}${stars ? ` · ★ ${stars} (${Number(r.rating_count)})` : ''}
        · ${tf('empSince', new Date(r.since).toLocaleDateString(localeTag(), { month: 'short', year: 'numeric' }))}</p>
      ${r.verified ? '' : `<p class="small">⚠️ ${t('empNotConfirmed')}</p>`}
      ${warn.length ? `<p class="emp-warn">⚠️ ${warn.map(esc).join(' · ')}</p>` : ''}
      ${tags ? `<div class="chips wrap">${tags}</div>` : ''}
      <p class="muted small">${t('empCheckNote')}</p>
    </div>`;
}

async function checkEmployer(phone) {
  if (EmpCheck.busy || !phone || !phone.trim()) return;
  if (!navigator.onLine) return showToast(t('empCheckOffline'));
  EmpCheck.busy = true;
  try {
    const { data, error } = await db.rpc('check_employer', { p_phone: phone.trim() });
    if (error) {
      if (error.message === 'workers_only') return showToast(t('empCheckSignUp'));
      if (!trustError(error)) showToast(t('saveError'));
      return;
    }
    EmpCheck.last = data;
    document.getElementById('empCheckAnswer').innerHTML = employerRecordHTML(data);
  } finally {
    EmpCheck.busy = false;
  }
}

function renderEmployerCheck() {
  const box = document.getElementById('employerCheck');
  if (box) box.innerHTML = employerCheckHTML();
}

// ---------- 4. My own jobs log ----------
// Work found outside the app: the day, who, what was promised and what was paid.
// Saved only on this phone (not sent anywhere), so it also works with no internet.
const OWN_JOBS_MAX = 300;

function ownJobs() {
  const list = Store.get('own_jobs', []);
  return Array.isArray(list) ? list : [];
}

function ownJobsTotals(list) {
  return list.reduce((s, j) => {
    s.paid += j.paid;
    s.owed += Math.max(0, j.promised - j.paid);
    return s;
  }, { paid: 0, owed: 0 });
}

function ownJobsHTML() {
  const list = ownJobs();
  const totals = ownJobsTotals(list);
  const rows = list.map((j) => {
    const owed = Math.max(0, j.promised - j.paid);
    return `
    <div class="mini-card">
      <div>
        <b>${esc(j.who)}</b>${j.work ? ` · ${esc(t(j.work))}` : ''}<br>
        <span class="muted small">${esc(new Date(j.day + 'T12:00:00').toLocaleDateString(localeTag(), { day: 'numeric', month: 'short' }))}
          · ${tf('ownPromised', j.promised)} · ${tf('ownPaid', j.paid)}</span>
        ${owed ? `<br><span class="badge badge-disputed">${tf('ownOwedOne', owed)}</span>` : ''}
      </div>
      <div class="actions">
        ${owed ? `<button class="btn btn-light btn-small" type="button" aria-label="${attr(t('ownMarkPaid'))}" onclick="markOwnJobPaid('${attr(j.id)}')">✅</button>` : ''}
        <button class="btn btn-light btn-small" type="button" aria-label="${attr(t('ownDelete'))}" onclick="deleteOwnJob('${attr(j.id)}')">🗑️</button>
      </div>
    </div>`;
  }).join('');
  return `
    <b>📒 ${t('ownTitle')}</b>
    <p class="muted small">${t('ownHint')}</p>
    ${list.length ? `<div class="stats"><div><small>${t('ownTotalPaid')}</small><b>${money(totals.paid)}</b></div>
      <div><small>${t('ownTotalOwed')}</small><b>${money(totals.owed)}</b></div></div>` : ''}
    <details ${list.length ? '' : 'open'}><summary class="btn btn-light btn-block">➕ ${t('ownAdd')}</summary>
      <form class="form" onsubmit="event.preventDefault(); addOwnJob(this)">
        <label><span>${t('ownDay')}</span><input name="day" type="date" required value="${dayFromToday(0)}" max="${dayFromToday(0)}"></label>
        <label><span>${t('ownWho')}</span><input name="who" maxlength="60" required placeholder="${attr(t('ownWhoPh'))}"></label>
        <label><span>${t('payCheckWork')}</span><select name="work" id="ownWork"></select></label>
        <div class="row">
          <label><span>${t('ownPromisedLabel')}</span><input name="promised" type="number" inputmode="numeric" min="0" max="1000000" required></label>
          <label><span>${t('ownPaidLabel')}</span><input name="paid" type="number" inputmode="numeric" min="0" max="1000000" value="0" required></label>
        </div>
        <button class="btn btn-dark btn-block" type="submit">${t('ownSave')}</button>
      </form>
    </details>
    <div class="own-list">${rows}</div>
    ${list.length ? `<button class="btn btn-light btn-block" type="button" onclick="shareOwnJobs()">📲 ${t('ownShare')}</button>` : ''}`;
}

function addOwnJob(form) {
  const promised = Math.max(0, Math.round(Number(form.promised.value) || 0));
  const paid = Math.max(0, Math.round(Number(form.paid.value) || 0));
  const who = form.who.value.trim().slice(0, 60);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(form.day.value) ? form.day.value : dayFromToday(0);
  if (!who) return;
  const list = ownJobs();
  if (list.length >= OWN_JOBS_MAX) return showToast(t('ownFull'));
  const work = WORK_TYPES[form.work.value] ? form.work.value : '';
  list.unshift({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), day, who, work, promised, paid });
  list.sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));
  Store.set('own_jobs', list);
  showToast(t('ownSaved'));
  renderOwnJobs();
}

function markOwnJobPaid(id) {
  const list = ownJobs();
  const j = list.find((x) => x.id === id);
  if (!j) return;
  j.paid = Math.max(j.paid, j.promised);
  Store.set('own_jobs', list);
  renderOwnJobs();
}

function deleteOwnJob(id) {
  if (!confirm(t('ownDeleteConfirm'))) return;
  Store.set('own_jobs', ownJobs().filter((x) => x.id !== id));
  renderOwnJobs();
}

// Sends what is still owed (or the whole list) as text, e.g. to a union or NGO helper
function shareOwnJobs() {
  const list = ownJobs();
  const totals = ownJobsTotals(list);
  const lines = list.slice(0, 40).map((j) => `• ${j.day} · ${j.who} · ${tf('ownPromised', j.promised)} · ${tf('ownPaid', j.paid)}`);
  shareOnWhatsApp([`📒 ${t('ownTitle')}${W.me ? ' · ' + W.me.name : ''}`, ...lines,
    `${t('ownTotalPaid')}: ${money(totals.paid)} · ${t('ownTotalOwed')}: ${money(totals.owed)}`].join('\n'));
}

function renderOwnJobs() {
  const box = document.getElementById('ownJobs');
  if (!box) return;
  box.innerHTML = ownJobsHTML();
  fillSelect(document.getElementById('ownWork'), typeof W !== 'undefined' && W.me ? W.me.skill : 'coolie');
}

// Everything on the worker's Safety and Earnings tabs that this file draws
function renderBuddyTools() {
  const scam = document.getElementById('scamCard');
  if (scam) scam.innerHTML = scamCardHTML();
  renderPayCheck();
  renderEmployerCheck();
  renderOwnJobs();
}

// ---------- Text ----------
Object.assign(T.en, {
  scamTitle: 'Job scam warning',
  scam1: 'Never pay to get work: no registration fee, deposit, training fee, uniform or ID card charge.',
  scam2: 'You never type your UPI PIN or share an OTP to receive money. Anyone asking for it is stealing.',
  scam3: 'Don’t send your Aadhaar, bank card or passbook photo to someone you don’t know.',
  scam4: 'Pay far above the normal rate, or a job abroad “after a small fee”, is a trap.',
  scam5: 'Going somewhere new? Share the place and the employer’s number with your family first.',
  scamHelpIN: 'Someone asked you for money? Tap ⚠️ Report on the job, and call 1930 (cyber crime) if you lost money.',
  scamHelp: 'Someone asked you for money? Tap ⚠️ Report on the job and tell the police if you lost money.',
  payCheckTitle: 'Is my pay fair?',
  payCheckHint: 'For any job, even one found outside the app. Uses the same wage rules as the app.',
  payCheckWork: 'Work',
  payCheckHours: 'Hours',
  payCheckLoad: 'How hard',
  load_light: 'Light', load_medium: 'Medium', load_heavy: 'Heavy',
  payCheckRisky: 'Risky (height, electric, sewer)',
  payCheckNight: 'Night (8 PM – 6 AM)',
  payCheckOffered: 'Pay offered for the whole job',
  payCheckBtn: 'Check my pay',
  payCheckWhy: 'How this is worked out',
  payIllegal: (n, floor, a, b) => `${money(n)} is below the minimum wage for this job (${money(floor)}). That is against the law. Fair pay is ${money(a)}–${money(b)}. Free legal help: 15100.`,
  payLow: (n, a, b) => `${money(n)} is low. Fair pay for this job is ${money(a)}–${money(b)}. You can ask for more.`,
  payFair: (n, a, b) => `${money(n)} is fair. The fair range for this job is ${money(a)}–${money(b)}.`,
  payGood: (n, a, b) => `${money(n)} is good pay, above the usual ${money(a)}–${money(b)}.`,
  empCheckTitle: 'Check an employer',
  empCheckHint: 'Got work by phone or at the labour stand? Type the employer’s number to see their record on Worker Buddy.',
  empCheckBtn: 'Check',
  empNotFound: 'This number has no record on Worker Buddy yet. Ask them to book you in the app, so your pay is recorded and protected.',
  empJobs: (n, p) => `${n} jobs · ${p} paid on time`,
  empSince: (d) => `on Worker Buddy since ${d}`,
  empOnHold: 'This account is on hold after reports',
  empNotPaid: (n) => `${n} worker(s) said “not paid”`,
  empUnpaidCancels: (n) => `${n} job(s) closed without pay`,
  empCheckNote: 'Only the employer’s record is shown, never their name or address.',
  empNotConfirmed: 'This number was not confirmed by SMS, so this record may not be theirs. Ask to see the app on their phone.',
  empCheckOffline: 'Checking an employer needs the internet.',
  empCheckSignUp: 'Finish signing up as a worker to check employers.',
  ownTitle: 'My own jobs',
  ownHint: 'Write down work you found outside the app, so you know who still owes you. Saved only on this phone.',
  ownAdd: 'Add a job',
  ownDay: 'Day',
  ownWho: 'Employer or place',
  ownWhoPh: 'e.g. Ravi sir, Anna Nagar site',
  ownPromisedLabel: 'Promised',
  ownPaidLabel: 'Paid so far',
  ownSave: 'Save job',
  ownSaved: 'Saved on this phone ✅',
  ownPromised: (n) => `promised ${money(n)}`,
  ownPaid: (n) => `paid ${money(n)}`,
  ownOwedOne: (n) => `still owed ${money(n)}`,
  ownTotalPaid: 'Paid to me',
  ownTotalOwed: 'Still owed',
  ownDelete: 'Delete',
  ownMarkPaid: 'Paid in full',
  ownDeleteConfirm: 'Delete this job from your list?',
  ownFull: 'Your list is full. Delete old jobs first.',
  ownShare: 'Share my list on WhatsApp'
});

Object.assign(T.ta, {
  scamTitle: 'வேலை மோசடி எச்சரிக்கை',
  scam1: 'வேலைக்காக ஒருபோதும் பணம் கொடுக்காதீர்கள்: பதிவுக் கட்டணம், டெபாசிட், பயிற்சிக் கட்டணம், சீருடை அல்லது ID கார்டு கட்டணம் எதுவும் வேண்டாம்.',
  scam2: 'பணம் பெற UPI PIN டைப் செய்ய வேண்டியதில்லை, OTP சொல்ல வேண்டியதில்லை. கேட்பவர் திருடுகிறார்.',
  scam3: 'தெரியாதவருக்கு ஆதார், வங்கி அட்டை அல்லது பாஸ்புக் படம் அனுப்பாதீர்கள்.',
  scam4: 'வழக்கத்தை விட மிக அதிக கூலி, அல்லது “சிறிய கட்டணம் கட்டினால்” வெளிநாட்டு வேலை என்றால் அது வலை.',
  scam5: 'புதிய இடத்துக்குப் போகிறீர்களா? இடத்தையும் முதலாளியின் எண்ணையும் முதலில் குடும்பத்துடன் பகிருங்கள்.',
  scamHelpIN: 'யாராவது பணம் கேட்டார்களா? வேலையில் ⚠️ புகார் தட்டுங்கள். பணம் இழந்தால் 1930 (சைபர் குற்றம்) அழையுங்கள்.',
  scamHelp: 'யாராவது பணம் கேட்டார்களா? வேலையில் ⚠️ புகார் தட்டுங்கள். பணம் இழந்தால் காவல்துறையிடம் சொல்லுங்கள்.',
  payCheckTitle: 'என் கூலி நியாயமா?',
  payCheckHint: 'எந்த வேலைக்கும், ஆப்புக்கு வெளியே கிடைத்த வேலைக்கும். ஆப்பின் அதே கூலி விதிகள்.',
  payCheckWork: 'வேலை',
  payCheckHours: 'மணி நேரம்',
  payCheckLoad: 'எவ்வளவு கடினம்',
  load_light: 'லேசானது', load_medium: 'நடுத்தரம்', load_heavy: 'கடினம்',
  payCheckRisky: 'ஆபத்தானது (உயரம், மின்சாரம், சாக்கடை)',
  payCheckNight: 'இரவு (இரவு 8 – காலை 6)',
  payCheckOffered: 'முழு வேலைக்கும் சொன்ன கூலி',
  payCheckBtn: 'என் கூலியைச் சரிபார்',
  payCheckWhy: 'இது எப்படிக் கணக்கிடப்படுகிறது',
  payIllegal: (n, floor, a, b) => `${money(n)} இந்த வேலைக்கான குறைந்தபட்ச கூலிக்கு (${money(floor)}) கீழே. இது சட்டத்துக்கு எதிரானது. நியாயமான கூலி ${money(a)}–${money(b)}. இலவச சட்ட உதவி: 15100.`,
  payLow: (n, a, b) => `${money(n)} குறைவு. இந்த வேலைக்கு நியாயமான கூலி ${money(a)}–${money(b)}. கூடுதலாகக் கேட்கலாம்.`,
  payFair: (n, a, b) => `${money(n)} நியாயமானது. இந்த வேலைக்கு நியாயமான வரம்பு ${money(a)}–${money(b)}.`,
  payGood: (n, a, b) => `${money(n)} நல்ல கூலி, வழக்கமான ${money(a)}–${money(b)}க்கு மேல்.`,
  empCheckTitle: 'முதலாளியைச் சரிபாருங்கள்',
  empCheckHint: 'போனில் அல்லது கூலி நிறுத்தத்தில் வேலை கிடைத்ததா? முதலாளியின் எண்ணை டைப் செய்து Worker Buddy-ல் அவரது பதிவைப் பாருங்கள்.',
  empCheckBtn: 'சரிபார்',
  empNotFound: 'இந்த எண்ணுக்கு Worker Buddy-ல் இன்னும் பதிவு இல்லை. உங்கள் கூலி பதிவாகிப் பாதுகாக்கப்பட, ஆப்பில் புக் செய்யச் சொல்லுங்கள்.',
  empJobs: (n, p) => `${n} வேலைகள் · ${p} சரியான நேரத்தில் சம்பளம்`,
  empSince: (d) => `${d} முதல் Worker Buddy-ல்`,
  empOnHold: 'புகார்களுக்குப் பிறகு இந்தக் கணக்கு நிறுத்தி வைக்கப்பட்டுள்ளது',
  empNotPaid: (n) => `${n} வேலையாள்(கள்) “சம்பளம் கிடைக்கவில்லை” என்றனர்`,
  empUnpaidCancels: (n) => `${n} வேலை(கள்) சம்பளம் இல்லாமல் மூடப்பட்டன`,
  empCheckNote: 'முதலாளியின் பதிவு மட்டுமே காட்டப்படும், பெயர் அல்லது முகவரி அல்ல.',
  empNotConfirmed: 'இந்த எண் SMS மூலம் உறுதிசெய்யப்படவில்லை, எனவே இந்தப் பதிவு அவருடையதாக இல்லாமல் இருக்கலாம். அவரது போனில் ஆப்பைக் காட்டச் சொல்லுங்கள்.',
  empCheckOffline: 'முதலாளியைச் சரிபார்க்க இணையம் தேவை.',
  empCheckSignUp: 'முதலாளிகளைச் சரிபார்க்க வேலையாளாகப் பதிவை முடியுங்கள்.',
  ownTitle: 'என் சொந்த வேலைகள்',
  ownHint: 'ஆப்புக்கு வெளியே கிடைத்த வேலைகளை எழுதுங்கள், யார் இன்னும் பாக்கி வைத்திருக்கிறார்கள் என்று தெரியும். இந்த போனில் மட்டுமே சேமிக்கப்படும்.',
  ownAdd: 'வேலையைச் சேர்',
  ownDay: 'நாள்',
  ownWho: 'முதலாளி அல்லது இடம்',
  ownWhoPh: 'எ.கா. ரவி சார், அண்ணா நகர் சைட்',
  ownPromisedLabel: 'சொன்ன கூலி',
  ownPaidLabel: 'இதுவரை கொடுத்தது',
  ownSave: 'வேலையைச் சேமி',
  ownSaved: 'இந்த போனில் சேமிக்கப்பட்டது ✅',
  ownPromised: (n) => `சொன்னது ${money(n)}`,
  ownPaid: (n) => `கொடுத்தது ${money(n)}`,
  ownOwedOne: (n) => `பாக்கி ${money(n)}`,
  ownTotalPaid: 'எனக்குக் கிடைத்தது',
  ownTotalOwed: 'இன்னும் பாக்கி',
  ownDelete: 'நீக்கு',
  ownMarkPaid: 'முழுதும் கிடைத்தது',
  ownDeleteConfirm: 'இந்த வேலையைப் பட்டியலிலிருந்து நீக்கவா?',
  ownFull: 'பட்டியல் நிரம்பிவிட்டது. பழைய வேலைகளை முதலில் நீக்குங்கள்.',
  ownShare: 'என் பட்டியலை WhatsApp-ல் பகிர்'
});

Object.assign(T.hi, {
  scamTitle: 'नौकरी धोखाधड़ी से सावधान',
  scam1: 'काम पाने के लिए कभी पैसे न दें: रजिस्ट्रेशन फ़ीस, डिपॉज़िट, ट्रेनिंग फ़ीस, वर्दी या ID कार्ड का पैसा, कुछ नहीं।',
  scam2: 'पैसे लेने के लिए UPI PIN डालना या OTP बताना कभी नहीं पड़ता। जो माँगे, वह चोरी कर रहा है।',
  scam3: 'अनजान को अपने आधार, बैंक कार्ड या पासबुक की फ़ोटो न भेजें।',
  scam4: 'आम से बहुत ज़्यादा मज़दूरी, या “थोड़ी फ़ीस देकर” विदेश में नौकरी, यह जाल है।',
  scam5: 'नई जगह जा रहे हैं? पहले जगह और मालिक का नंबर परिवार को भेजें।',
  scamHelpIN: 'किसी ने पैसे माँगे? काम पर ⚠️ रिपोर्ट दबाएँ। पैसे गए हों तो 1930 (साइबर अपराध) पर फ़ोन करें।',
  scamHelp: 'किसी ने पैसे माँगे? काम पर ⚠️ रिपोर्ट दबाएँ। पैसे गए हों तो पुलिस को बताएँ।',
  payCheckTitle: 'क्या मेरी मज़दूरी सही है?',
  payCheckHint: 'किसी भी काम के लिए, ऐप के बाहर मिले काम के लिए भी। ऐप वाले ही मज़दूरी नियम।',
  payCheckWork: 'काम',
  payCheckHours: 'घंटे',
  payCheckLoad: 'कितना भारी',
  load_light: 'हल्का', load_medium: 'मध्यम', load_heavy: 'भारी',
  payCheckRisky: 'खतरनाक (ऊँचाई, बिजली, सीवर)',
  payCheckNight: 'रात (रात 8 – सुबह 6)',
  payCheckOffered: 'पूरे काम के लिए बताई मज़दूरी',
  payCheckBtn: 'मेरी मज़दूरी जाँचें',
  payCheckWhy: 'यह कैसे निकाला गया',
  payIllegal: (n, floor, a, b) => `${money(n)} इस काम की न्यूनतम मज़दूरी (${money(floor)}) से कम है। यह कानून के ख़िलाफ़ है। सही मज़दूरी ${money(a)}–${money(b)} है। मुफ़्त कानूनी मदद: 15100।`,
  payLow: (n, a, b) => `${money(n)} कम है। इस काम की सही मज़दूरी ${money(a)}–${money(b)} है। आप ज़्यादा माँग सकते हैं।`,
  payFair: (n, a, b) => `${money(n)} सही है। इस काम की सही सीमा ${money(a)}–${money(b)} है।`,
  payGood: (n, a, b) => `${money(n)} अच्छी मज़दूरी है, आम ${money(a)}–${money(b)} से ज़्यादा।`,
  empCheckTitle: 'मालिक की जाँच करें',
  empCheckHint: 'फ़ोन पर या लेबर चौक पर काम मिला? मालिक का नंबर डालें और Worker Buddy पर उनका रिकॉर्ड देखें।',
  empCheckBtn: 'जाँचें',
  empNotFound: 'इस नंबर का Worker Buddy पर अभी कोई रिकॉर्ड नहीं। उनसे ऐप में बुक करने को कहें, ताकि आपकी मज़दूरी दर्ज और सुरक्षित रहे।',
  empJobs: (n, p) => `${n} काम · ${p} में समय पर भुगतान`,
  empSince: (d) => `${d} से Worker Buddy पर`,
  empOnHold: 'शिकायतों के बाद यह खाता रोका गया है',
  empNotPaid: (n) => `${n} मज़दूर(ों) ने कहा “पैसे नहीं मिले”`,
  empUnpaidCancels: (n) => `${n} काम बिना भुगतान बंद किए गए`,
  empCheckNote: 'सिर्फ़ मालिक का रिकॉर्ड दिखता है, नाम या पता कभी नहीं।',
  empNotConfirmed: 'यह नंबर SMS से पक्का नहीं हुआ, इसलिए यह रिकॉर्ड शायद उनका न हो। उनसे अपने फ़ोन पर ऐप दिखाने को कहें।',
  empCheckOffline: 'मालिक की जाँच के लिए इंटरनेट चाहिए।',
  empCheckSignUp: 'मालिकों की जाँच के लिए मज़दूर के रूप में साइन-अप पूरा करें।',
  ownTitle: 'मेरे अपने काम',
  ownHint: 'ऐप के बाहर मिले काम लिखें, ताकि पता रहे कि किसके पैसे बाकी हैं। सिर्फ़ इसी फ़ोन में सेव होता है।',
  ownAdd: 'काम जोड़ें',
  ownDay: 'दिन',
  ownWho: 'मालिक या जगह',
  ownWhoPh: 'जैसे, रवि सर, अन्ना नगर साइट',
  ownPromisedLabel: 'तय मज़दूरी',
  ownPaidLabel: 'अब तक मिला',
  ownSave: 'काम सेव करें',
  ownSaved: 'इस फ़ोन में सेव हो गया ✅',
  ownPromised: (n) => `तय ${money(n)}`,
  ownPaid: (n) => `मिला ${money(n)}`,
  ownOwedOne: (n) => `बाकी ${money(n)}`,
  ownTotalPaid: 'मुझे मिला',
  ownTotalOwed: 'अभी बाकी',
  ownDelete: 'हटाएँ',
  ownMarkPaid: 'पूरा मिल गया',
  ownDeleteConfirm: 'यह काम सूची से हटाएँ?',
  ownFull: 'सूची भर गई है। पहले पुराने काम हटाएँ।',
  ownShare: 'अपनी सूची WhatsApp पर भेजें'
});
