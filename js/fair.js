// fair.js — fair-pay extras shared by both apps:
//   1. Show-up pay   2. QR proof of pay (works offline)   6. Travel allowance
//   7. Rain-off pay   8. Tool charge   9. Materials list   10. Meal / water tags   26. Pay slip by SMS
// Load after deck.js. Owner: Member 2

const SHOWUP_PAY = 100;
const TOOLS_EXTRA = 50;
const TOOL_LIST = ['drill', 'ladder', 'toolkit', 'sprayer', 'mixer', 'wrench'];
const TOOL_ICONS = { drill: '🪛', ladder: '🪜', toolkit: '🧰', sprayer: '🎨', mixer: '🌀', wrench: '🔧' };
const PERKS = ['meal', 'water', 'shade', 'toilet'];
const PERK_ICONS = { meal: '🍛', water: '💧', shade: '⛱️', toilet: '🚻' };

// ---------- 6. Travel allowance (same rule as the database) ----------
function travelPayFor(km) {
  if (km === null || km <= 5) return 0;
  return Math.min(150, 50 + 10 * Math.floor(km - 5));
}

// ---------- 10. Meal / water / shade / toilet provided ----------
function perksHTML(perks) {
  return (perks || []).map((p) => `<span class="tag perk">${PERK_ICONS[p]} ${t('perk_' + p)}</span>`).join('');
}
function perksText(perks) {
  return (perks || []).map((p) => `${PERK_ICONS[p]} ${t('perk_' + p)}`).join(' · ');
}

// ---------- 8. Tools ----------
function toolsHTML(tools) {
  return (tools || []).map((k) => `<span class="tag">${TOOL_ICONS[k]} ${t('tool_' + k)}</span>`).join('');
}

// ---------- 9. Materials the worker bought ----------
const Mat = { list: [], bookingId: null, listening: false };

async function loadMaterials(bookingId) {
  Mat.bookingId = bookingId;
  if (!bookingId || !navigator.onLine) { if (!bookingId) Mat.list = []; return; }
  const { data } = await db.from('materials').select('*').eq('booking_id', bookingId).order('id');
  Mat.list = data || [];
}

function listenMaterials(onChange) {
  if (Mat.listening) return;
  Mat.listening = true;
  db.channel('materials-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'materials' }, async (p) => {
      const row = p.new || {};
      if (row.booking_id !== Mat.bookingId) return;
      await loadMaterials(Mat.bookingId);
      if (onChange) onChange(row, p.eventType);
    })
    .subscribe();
}

function approvedMaterials() {
  return Mat.list.filter((m) => m.status === 'approved').reduce((s, m) => s + m.amount, 0);
}

// me = 'worker' (adds items) or 'employer' (approves them)
function materialsHTML(me, status) {
  const rows = Mat.list.map((m) => `
    <li><span>${esc(m.item)} · <b>${money(m.amount)}</b></span>
      ${m.status === 'pending' && me === 'employer'
        ? `<span><button class="btn btn-accept btn-small" onclick="decideMaterial(${m.id}, true)">✓</button>
           <button class="btn btn-light btn-small" onclick="decideMaterial(${m.id}, false)">✕</button></span>`
        : `<span class="badge badge-${m.status === 'approved' ? 'open' : m.status === 'rejected' ? 'disputed' : 'accepted'}">${t('mat_' + m.status)}</span>`}
    </li>`).join('');
  const canAdd = me === 'worker' && ['started', 'completed'].includes(status);
  if (!rows && !canAdd) return '';
  return `
    <div class="materials">
      <b>🧾 ${t('materialsTitle')}</b>
      ${rows ? `<ul class="mat-list">${rows}</ul>` : `<p class="muted small">${t('materialsHint')}</p>`}
      ${approvedMaterials() ? `<p class="small">${tf('materialsApproved', approvedMaterials())}</p>` : ''}
      ${canAdd ? `<form class="row mat-form" onsubmit="addMaterial(event)">
        <input name="item" class="input" maxlength="60" required placeholder="${attr(t('materialItemPh'))}">
        <input name="amount" class="input mat-amount" type="number" inputmode="numeric" min="1" max="20000" required placeholder="${moneySign()}">
        <button class="btn btn-dark btn-small" type="submit">+</button>
      </form>` : ''}
    </div>`;
}

async function addMaterial(event) {
  event.preventDefault();
  const f = event.target;
  if (!navigator.onLine) return showToast(t('offlineBanner'));
  const { error } = await db.from('materials').insert({ booking_id: Mat.bookingId, item: f.item.value.trim(), amount: parseInt(f.amount.value, 10) });
  if (error) return showToast(t('saveError'));
  await loadMaterials(Mat.bookingId);
  if (App.onMaterials) App.onMaterials();
}

async function decideMaterial(id, ok) {
  const { data, error } = await db.rpc('decide_material', { p_id: id, p_employer: E.me.id, p_ok: ok });
  if (error || !data) return showToast(t('saveError'));
  await loadMaterials(Mat.bookingId);
  if (App.onMaterials) App.onMaterials();
}

// ---------- Work harder than described ----------
// The worker says what the work really is; the extra uses the same rules as the wage engine
// (medium +₹50, heavy +₹100, risky +₹100). The employer accepts or refuses; pay waits for the answer.
const LOAD_EXTRA = { light: 0, medium: 50, heavy: 100 };

function effortExtraFor(b, load, risky) {
  return Math.max(0, LOAD_EXTRA[load] - LOAD_EXTRA[b.load]) + (risky && !b.risky ? 100 : 0);
}

function effortClaimText(b) {
  return [b.effort_load !== b.load ? tf('effortWas', t(b.effort_load), t(b.load)) : '',
    b.effort_risky && !b.risky ? `⚠️ ${t('riskyShort')}` : ''].filter(Boolean).join(' · ');
}

// me = 'worker' (claims) or 'employer' (answers)
function effortHTML(me, b) {
  if (!['started', 'completed', 'paid'].includes(b.status)) return '';
  if (b.effort_status === 'pending') {
    return me === 'employer'
      ? `<div class="effort effort-pending"><b>😓 ${t('effortTitle')}</b>
          <p>${effortClaimText(b)}</p><p class="small">${tf('effortFair', b.effort_extra)}</p>
          <div class="row">
            <button class="btn btn-accept" onclick="decideEffort(true, '${b.id}')">${tf('effortAccept', b.effort_extra)}</button>
            <button class="btn btn-light" onclick="decideEffort(false, '${b.id}')">${t('effortRefuse')}</button>
          </div></div>`
      : `<div class="effort effort-pending"><b>😓 ${t('effortTitle')}</b>
          <p>${effortClaimText(b)}</p><p class="wait-pay"><span class="pulse-dot"></span>${tf('effortWaiting', b.effort_extra)}</p></div>`;
  }
  if (b.effort_status === 'accepted') return `<p class="effort effort-ok">✅ ${tf('effortAccepted', b.effort_extra)}</p>`;
  if (b.effort_status === 'refused') return `<p class="effort effort-no">❌ ${tf('effortRefused', b.effort_extra)}</p>`;
  if (me !== 'worker' || b.status === 'paid') return '';
  const loads = ['medium', 'heavy'].filter((l) => LOAD_EXTRA[l] > LOAD_EXTRA[b.load]);
  if (!loads.length && b.risky) return '';
  return `<details class="effort"><summary>😓 ${t('effortClaimBtn')}</summary>
    <form onsubmit="claimEffort(event)">
      <p class="small muted">${tf('effortPosted', t(b.load), b.risky ? t('riskyShort') : '')}</p>
      ${loads.length ? `<div class="chips">${loads.map((l, i) => `<label class="chip"><input type="radio" name="load" value="${l}" ${i === loads.length - 1 ? 'checked' : ''}> ${t(l)}</label>`).join('')}</div>` : ''}
      ${b.risky ? '' : `<label class="check"><input type="checkbox" name="risky"> ⚠️ ${t('effortRiskyQ')}</label>`}
      <button class="btn btn-dark btn-block" type="submit">${t('effortSend')}</button>
    </form></details>`;
}

async function claimEffort(event) {
  event.preventDefault();
  const f = event.target;
  const b = W.active;
  const load = f.load ? (f.querySelector('input[name=load]:checked') || {}).value || b.load : b.load;
  const risky = !!(f.risky && f.risky.checked);
  if (!effortExtraFor(b, load, risky)) return showToast(t('effortNothing'));
  if (!navigator.onLine) return showToast(t('offlineBanner'));
  const { data, error } = await db.rpc('claim_effort', { p_booking: b.id, p_worker: W.me.id, p_load: load, p_risky: risky });
  if (error || !data) return showToast(t('saveError'));
  showToast(tf('effortWaiting', data));
}

async function decideEffort(ok, id) {
  const b = (E.booking && E.booking.id === id ? E.booking : E.crew.find((x) => x.id === id)) || E.booking;
  const { data, error } = await db.rpc('decide_effort', { p_booking: b.id, p_employer: E.me.id, p_ok: ok });
  if (error || !data) return showToast(t('saveError'));
  showToast(ok ? tf('effortAccepted', b.effort_extra) : t('effortRefusedToast'));
  if (E.crewPay && E.crewPay.id === b.id) { await refreshCrew(); drawCrewPay(); }
}

// ---------- 2. QR proof of pay ----------
// Code = first 10 hex of SHA-256("secret:amount:bookingId"). The pay secret is only ever sent to the
// employer's phone (booking_pay_secrets), so a worker can't make a receipt alone; the database checks it.
async function payCode(secret, amount, bookingId) {
  const bytes = new TextEncoder().encode(`${secret}:${amount}:${bookingId}`);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash)).map((x) => x.toString(16).padStart(2, '0')).join('').slice(0, 10);
}

function qrModal() {
  let m = document.getElementById('qrModal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'qrModal';
    m.className = 'modal';
    m.innerHTML = `<div class="modal-box"><div id="qrBody"></div>
      <button class="btn btn-light btn-block" onclick="closeQR()">${t('close')}</button></div>`;
    document.body.appendChild(m);
  }
  return m;
}

function closeQR() {
  stopScan();
  closeModal('qrModal');
}

// Employer: show the QR the worker scans. Works with no internet.
async function showPayQR(b, amount) {
  await loadOtps([b.id]);
  if (!PaySecret[b.id]) return showToast(t(navigator.onLine ? 'saveError' : 'offlineBanner')); // not on this phone yet
  const code = await payCode(PaySecret[b.id], amount, b.id);
  const payload = JSON.stringify({ wb: 1, b: b.id, a: amount, c: code });
  let svg = '';
  if (typeof qrcode === 'function') {
    const q = qrcode(0, 'M');
    q.addData(payload);
    q.make();
    svg = q.createSvgTag({ cellSize: 5, margin: 2, scalable: true });
  }
  const m = qrModal();
  document.getElementById('qrBody').innerHTML = `
    <h3>📱 ${t('qrPayTitle')}</h3>
    <div class="qr-box">${svg || `<p class="muted">${t('qrNoLib')}</p>`}</div>
    <p class="request-pay center">${money(amount)}</p>
    <p class="muted small">${t('qrPayHint')}</p>
    <p class="small center">${t('qrBackup')}: <b class="code">${code}</b></p>`;
  m.classList.add('open');
}

// Worker: scan the employer's QR with the camera (jsQR reads each frame)
const Scan = { stream: null, timer: null };
async function scanPayQR(onText) {
  const m = qrModal();
  document.getElementById('qrBody').innerHTML = `
    <h3>📷 ${t('qrScanTitle')}</h3>
    <video id="qrVideo" class="qr-video" playsinline muted></video>
    <p class="muted small">${t('qrScanHint')}</p>
    <form class="row" onsubmit="event.preventDefault(); typedQR(this.code.value, this.amount.value)">
      <input name="code" class="input" maxlength="10" required placeholder="${attr(t('qrTypeCode'))}">
      <input name="amount" class="input mat-amount" type="number" inputmode="numeric" required placeholder="${moneySign()}">
      <button class="btn btn-dark btn-small" type="submit">OK</button>
    </form>`;
  m.classList.add('open');
  Scan.onText = onText;
  if (!navigator.mediaDevices || typeof jsQR !== 'function') return showToast(t('qrNoCamera'));
  try {
    Scan.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
  } catch (e) {
    return showToast(t('qrNoCamera'));
  }
  const video = document.getElementById('qrVideo');
  video.srcObject = Scan.stream;
  await video.play();
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  Scan.timer = setInterval(() => {
    if (!video.videoWidth) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const found = jsQR(img.data, img.width, img.height);
    if (found && found.data) {
      stopScan();
      onText(found.data);
    }
  }, 300);
}

function stopScan() {
  clearInterval(Scan.timer);
  if (Scan.stream) Scan.stream.getTracks().forEach((tr) => tr.stop());
  Scan.stream = null;
}

// If the camera does not work, the worker types the 10-letter code and the amount shown with the QR
function typedQR(code, amount) {
  stopScan();
  if (Scan.onText) Scan.onText(JSON.stringify({ wb: 1, typed: true, a: parseInt(amount, 10), c: code.trim().toLowerCase() }));
}

// ---------- 26. Pay slip by SMS (for basic phones) ----------
function smsLink(phone, text) {
  return `sms:${phone || ''}?body=${encodeURIComponent(text)}`;
}

// ---------- Text ----------
Object.assign(T.en, {
  showupOwed: (n) => `⚠️ Show-up pay owed to the worker: ${money(n)}`,
  showupPaid: (n) => `✅ Show-up pay ${money(n)} paid`,
  payShowup: (n) => `Pay ${money(n)} show-up pay`,
  showupBlock: 'Please pay the show-up pay you owe before posting a new job.',
  cancelAssignedWarn: 'The worker has already set off. Cancelling now means ₹100 show-up pay for them. Cancel?',
  showupForWorker: 'The employer cancelled after you set off. You are owed ₹100 show-up pay.',
  showupLabel: 'Show-up pay',
  qrPayBtn: '🧾 Show pay-proof QR (after paying, works offline)',
  qrPayTitle: 'Show this to the worker',
  qrPayHint: 'This is not a payment QR. After you pay by cash or UPI, the worker scans it inside Worker Buddy to record the payment, even with no internet.',
  qrBackup: 'Code',
  qrNoLib: 'QR could not load. Tell the worker the code below.',
  qrScanBtn: '📷 Scan the employer’s pay QR',
  qrScanTitle: 'Scan the pay QR',
  qrScanHint: 'Point the camera at the QR on the employer’s phone.',
  qrTypeCode: 'Or type the 10-letter code',
  qrNoCamera: 'Camera not available. Type the code shown under the QR.',
  qrWrong: 'This QR is not for this job, or the code is wrong.',
  qrOk: (n) => `✅ ${money(n)} received, proven by QR. Pay slip created.`,
  qrSavedOffline: 'Saved. The pay slip will be confirmed when the internet is back.',
  travelPay: 'Travel allowance',
  travelNote: 'Workers coming from more than 5 km get a travel allowance (₹50, +₹10 per km, up to ₹150).',
  travelTag: (n) => `🚌 +${money(n)} travel`,
  rainStop: '🌧️ Rain stopped the work',
  rainConfirm: 'Stop work because of rain? The worker is paid for the time worked, at least half the wage.',
  rainNote: (n) => `🌧️ Rain-off: paid for time worked, at least half the wage (${money(n)})`,
  rainLabel: 'Rain-off pay',
  bringTools: '🧰 Worker brings own tools (+₹50)',
  toolsExtra: 'Own tools',
  toolsTag: '🧰 Bring your tools +₹50',
  myTools: 'Tools I have',
  tool_drill: 'Drill', tool_ladder: 'Ladder', tool_toolkit: 'Tool kit', tool_sprayer: 'Paint sprayer', tool_mixer: 'Cement mixer', tool_wrench: 'Pipe wrench',
  perksTitle: 'Provided at the site',
  perk_meal: 'Meal', perk_water: 'Water', perk_shade: 'Shade', perk_toilet: 'Toilet',
  materialsTitle: 'Materials bought by the worker',
  materialsHint: 'Bought parts or materials with your own money? Add them here to get repaid.',
  materialItemPh: 'Item, e.g. PVC pipe',
  materialsApproved: (n) => `Approved: ${money(n)}, repaid with the wage`,
  mat_pending: 'Waiting', mat_approved: 'Approved', mat_rejected: 'Not approved',
  materialsLabel: 'Materials repaid',
  smsSlip: '📩 Send by SMS'
});

Object.assign(T.ta, {
  showupOwed: (n) => `⚠️ வேலையாளுக்கு வர வேண்டிய வருகைக் கூலி: ${money(n)}`,
  showupPaid: (n) => `✅ வருகைக் கூலி ${money(n)} கொடுக்கப்பட்டது`,
  payShowup: (n) => `${money(n)} வருகைக் கூலி கொடு`,
  showupBlock: 'புதிய வேலை பதிவிடும் முன் நீங்கள் தர வேண்டிய வருகைக் கூலியைக் கொடுங்கள்.',
  cancelAssignedWarn: 'வேலையாள் ஏற்கனவே கிளம்பிவிட்டார். இப்போது ரத்து செய்தால் அவருக்கு ₹100 வருகைக் கூலி. ரத்து செய்யவா?',
  showupForWorker: 'நீங்கள் கிளம்பிய பிறகு முதலாளி ரத்து செய்தார். உங்களுக்கு ₹100 வருகைக் கூலி வர வேண்டும்.',
  showupLabel: 'வருகைக் கூலி',
  qrPayBtn: '🧾 கட்டணச் சான்று QR காட்டு (செலுத்திய பின், இணையம் இல்லாமலும்)',
  qrPayTitle: 'இதை வேலையாளிடம் காட்டுங்கள்',
  qrPayHint: 'இது கட்டணம் செலுத்தும் QR அல்ல. பணம் அல்லது UPI கொடுத்த பின் வேலையாள் இதை Worker Buddy-யில் ஸ்கேன் செய்வார். இணையம் இல்லாவிட்டாலும் சான்றாகப் பதிவாகும்.',
  qrBackup: 'குறியீடு',
  qrNoLib: 'QR ஏற்றப்படவில்லை. கீழே உள்ள குறியீட்டை வேலையாளிடம் சொல்லுங்கள்.',
  qrScanBtn: '📷 முதலாளியின் கட்டண QR ஐ ஸ்கேன் செய்',
  qrScanTitle: 'கட்டண QR ஐ ஸ்கேன் செய்',
  qrScanHint: 'முதலாளியின் போனில் உள்ள QR நோக்கி கேமராவைக் காட்டுங்கள்.',
  qrTypeCode: 'அல்லது 10 எழுத்துக் குறியீட்டை டைப் செய்',
  qrNoCamera: 'கேமரா இல்லை. QR கீழே உள்ள குறியீட்டை டைப் செய்யுங்கள்.',
  qrWrong: 'இந்த QR இந்த வேலைக்கானது அல்ல, அல்லது குறியீடு தவறு.',
  qrOk: (n) => `✅ ${money(n)} கிடைத்தது, QR மூலம் உறுதி. சம்பளச் சீட்டு உருவானது.`,
  qrSavedOffline: 'சேமிக்கப்பட்டது. இணையம் வந்ததும் சம்பளச் சீட்டு உறுதியாகும்.',
  travelPay: 'பயணப் படி',
  travelNote: '5 கி.மீக்கு மேல் தூரத்திலிருந்து வரும் வேலையாட்களுக்கு பயணப் படி (₹50, ஒவ்வொரு கி.மீக்கும் +₹10, அதிகபட்சம் ₹150).',
  travelTag: (n) => `🚌 +${money(n)} பயணம்`,
  rainStop: '🌧️ மழையால் வேலை நின்றது',
  rainConfirm: 'மழையால் வேலையை நிறுத்தவா? செய்த நேரத்துக்கு, குறைந்தது பாதி கூலி வேலையாளுக்குக் கிடைக்கும்.',
  rainNote: (n) => `🌧️ மழை நிறுத்தம்: செய்த நேரத்துக்கு, குறைந்தது பாதி கூலி (${money(n)})`,
  rainLabel: 'மழை நிறுத்தக் கூலி',
  bringTools: '🧰 வேலையாள் சொந்த கருவிகள் கொண்டு வருவார் (+₹50)',
  toolsExtra: 'சொந்த கருவிகள்',
  toolsTag: '🧰 உங்கள் கருவிகளைக் கொண்டு வாருங்கள் +₹50',
  myTools: 'என்னிடம் உள்ள கருவிகள்',
  tool_drill: 'டிரில்', tool_ladder: 'ஏணி', tool_toolkit: 'கருவிப் பெட்டி', tool_sprayer: 'பெயிண்ட் ஸ்பிரேயர்', tool_mixer: 'சிமெண்ட் மிக்சர்', tool_wrench: 'பைப் ரெஞ்ச்',
  perksTitle: 'இடத்தில் வழங்கப்படும்',
  perk_meal: 'உணவு', perk_water: 'தண்ணீர்', perk_shade: 'நிழல்', perk_toilet: 'கழிவறை',
  materialsTitle: 'வேலையாள் வாங்கிய பொருட்கள்',
  materialsHint: 'உங்கள் பணத்தில் பொருட்கள் வாங்கினீர்களா? திரும்பப் பெற இங்கே சேருங்கள்.',
  materialItemPh: 'பொருள், எ.கா. PVC பைப்',
  materialsApproved: (n) => `ஒப்புதல்: ${money(n)}, கூலியுடன் திருப்பித் தரப்படும்`,
  mat_pending: 'காத்திருக்கிறது', mat_approved: 'ஒப்புதல்', mat_rejected: 'ஒப்புதல் இல்லை',
  materialsLabel: 'பொருள் திருப்பம்',
  smsSlip: '📩 SMS ஆக அனுப்பு'
});

Object.assign(T.hi, {
  showupOwed: (n) => `⚠️ मज़दूर को आने का पैसा देना बाकी: ${money(n)}`,
  showupPaid: (n) => `✅ आने का पैसा ${money(n)} दिया गया`,
  payShowup: (n) => `${money(n)} आने का पैसा दें`,
  showupBlock: 'नया काम पोस्ट करने से पहले बाकी आने का पैसा दें।',
  cancelAssignedWarn: 'मज़दूर निकल चुका है। अभी रद्द करने पर उसे ₹100 आने का पैसा मिलेगा। रद्द करें?',
  showupForWorker: 'आपके निकलने के बाद मालिक ने रद्द किया। आपको ₹100 आने का पैसा मिलना है।',
  showupLabel: 'आने का पैसा',
  qrPayBtn: '🧾 भुगतान-सबूत QR दिखाएँ (भुगतान के बाद, बिना इंटरनेट भी)',
  qrPayTitle: 'यह मज़दूर को दिखाएँ',
  qrPayHint: 'यह भुगतान वाला QR नहीं है। नकद या UPI देने के बाद मज़दूर इसे Worker Buddy में स्कैन करेगा। बिना इंटरनेट के भी सबूत बनता है।',
  qrBackup: 'कोड',
  qrNoLib: 'QR नहीं खुला। मज़दूर को नीचे का कोड बताएँ।',
  qrScanBtn: '📷 मालिक का भुगतान QR स्कैन करें',
  qrScanTitle: 'भुगतान QR स्कैन करें',
  qrScanHint: 'मालिक के फ़ोन के QR की ओर कैमरा करें।',
  qrTypeCode: 'या 10 अक्षर का कोड लिखें',
  qrNoCamera: 'कैमरा नहीं चला। QR के नीचे का कोड लिखें।',
  qrWrong: 'यह QR इस काम का नहीं है, या कोड गलत है।',
  qrOk: (n) => `✅ ${money(n)} मिला, QR से पक्का। पे स्लिप बन गई।`,
  qrSavedOffline: 'सेव हो गया। इंटरनेट आने पर पे स्लिप पक्की होगी।',
  travelPay: 'आने-जाने का भत्ता',
  travelNote: '5 किमी से ज़्यादा दूर से आने वाले मज़दूर को भत्ता (₹50, हर किमी +₹10, ज़्यादा से ज़्यादा ₹150)।',
  travelTag: (n) => `🚌 +${money(n)} भत्ता`,
  rainStop: '🌧️ बारिश से काम रुका',
  rainConfirm: 'बारिश से काम रोकें? मज़दूर को किए गए समय का, कम से कम आधी मज़दूरी मिलेगी।',
  rainNote: (n) => `🌧️ बारिश से रुका: किए गए समय का, कम से कम आधी मज़दूरी (${money(n)})`,
  rainLabel: 'बारिश वाला पैसा',
  bringTools: '🧰 मज़दूर अपने औज़ार लाएगा (+₹50)',
  toolsExtra: 'अपने औज़ार',
  toolsTag: '🧰 अपने औज़ार लाएँ +₹50',
  myTools: 'मेरे पास के औज़ार',
  tool_drill: 'ड्रिल', tool_ladder: 'सीढ़ी', tool_toolkit: 'औज़ार किट', tool_sprayer: 'पेंट स्प्रेयर', tool_mixer: 'सीमेंट मिक्सर', tool_wrench: 'पाइप रिंच',
  perksTitle: 'जगह पर मिलेगा',
  perk_meal: 'खाना', perk_water: 'पानी', perk_shade: 'छाया', perk_toilet: 'शौचालय',
  materialsTitle: 'मज़दूर का खरीदा सामान',
  materialsHint: 'अपने पैसे से सामान खरीदा? वापस पाने के लिए यहाँ जोड़ें।',
  materialItemPh: 'सामान, जैसे PVC पाइप',
  materialsApproved: (n) => `मंज़ूर: ${money(n)}, मज़दूरी के साथ वापस`,
  mat_pending: 'इंतज़ार', mat_approved: 'मंज़ूर', mat_rejected: 'नामंज़ूर',
  materialsLabel: 'सामान का पैसा',
  smsSlip: '📩 SMS से भेजें'
});

// Night pay and "work harder than described"
Object.assign(T.en, {
  nightExtra: 'Night pay (+20%)',
  effortTitle: 'Work is harder than described',
  effortClaimBtn: 'Work is harder than described?',
  effortPosted: (load, risky) => `Posted as: ${load}${risky ? ' · ' + risky : ''}. What is it really?`,
  effortRiskyQ: 'It is risky (height, electrical, sewer)',
  effortSend: 'Tell the employer',
  effortNothing: 'Pick what the work really is',
  effortWas: (real, posted) => `Really ${real.toLowerCase()}, posted as ${posted.toLowerCase()}`,
  effortFair: (n) => `Fair extra by the wage rules: +${money(n)}`,
  effortAccept: (n) => `Accept +${money(n)}`,
  effortRefuse: 'Refuse',
  effortWaiting: (n) => `Asked the employer for +${money(n)}. Payment waits for their answer.`,
  effortAccepted: (n) => `+${money(n)} added for harder work`,
  effortRefused: (n) => `The employer refused +${money(n)} for harder work. This shows on their profile.`,
  effortRefusedToast: 'Refused. Workers will see this on your profile.',
  effortPayFirst: 'Answer the worker\'s harder-work request first',
  effortRefusedCount: (n) => `😓 Refused harder-work pay ${n}×`
});
Object.assign(T.ta, {
  nightExtra: 'இரவு கூலி (+20%)',
  effortTitle: 'சொன்னதை விட வேலை கடினம்',
  effortClaimBtn: 'சொன்னதை விட வேலை கடினமா?',
  effortPosted: (load, risky) => `பதிவு: ${load}${risky ? ' · ' + risky : ''}. உண்மையில் எப்படி?`,
  effortRiskyQ: 'ஆபத்தானது (உயரம், மின்சாரம், சாக்கடை)',
  effortSend: 'முதலாளிக்கு சொல்',
  effortNothing: 'வேலை உண்மையில் எப்படி என்று தேர்வு செய்யவும்',
  effortWas: (real, posted) => `உண்மையில் ${real}, பதிவில் ${posted}`,
  effortFair: (n) => `கூலி விதிப்படி நியாயமான கூடுதல்: +${money(n)}`,
  effortAccept: (n) => `+${money(n)} ஏற்கவும்`,
  effortRefuse: 'மறு',
  effortWaiting: (n) => `முதலாளியிடம் +${money(n)} கேட்கப்பட்டது. பதில் வந்த பின் கூலி.`,
  effortAccepted: (n) => `கடின வேலைக்கு +${money(n)} சேர்க்கப்பட்டது`,
  effortRefused: (n) => `கடின வேலைக்கான +${money(n)} மறுக்கப்பட்டது. இது முதலாளி சுயவிவரத்தில் தெரியும்.`,
  effortRefusedToast: 'மறுக்கப்பட்டது. வேலையாட்கள் இதை உங்கள் சுயவிவரத்தில் பார்ப்பார்கள்.',
  effortPayFirst: 'முதலில் வேலையாளின் கடின வேலை கோரிக்கைக்கு பதில் சொல்லவும்',
  effortRefusedCount: (n) => `😓 கடின வேலை கூலி ${n} முறை மறுப்பு`
});
Object.assign(T.hi, {
  nightExtra: 'रात का भत्ता (+20%)',
  effortTitle: 'काम बताए से ज़्यादा कठिन है',
  effortClaimBtn: 'काम बताए से ज़्यादा कठिन है?',
  effortPosted: (load, risky) => `बताया गया: ${load}${risky ? ' · ' + risky : ''}। असल में कैसा है?`,
  effortRiskyQ: 'जोखिम वाला है (ऊँचाई, बिजली, सीवर)',
  effortSend: 'मालिक को बताएँ',
  effortNothing: 'चुनें कि काम असल में कैसा है',
  effortWas: (real, posted) => `असल में ${real}, बताया ${posted}`,
  effortFair: (n) => `मज़दूरी नियम से सही अतिरिक्त: +${money(n)}`,
  effortAccept: (n) => `+${money(n)} मानें`,
  effortRefuse: 'मना करें',
  effortWaiting: (n) => `मालिक से +${money(n)} माँगा। जवाब के बाद भुगतान होगा।`,
  effortAccepted: (n) => `कठिन काम के लिए +${money(n)} जोड़ा गया`,
  effortRefused: (n) => `मालिक ने कठिन काम के +${money(n)} मना किए। यह उनकी प्रोफ़ाइल पर दिखेगा।`,
  effortRefusedToast: 'मना किया। मज़दूर इसे आपकी प्रोफ़ाइल पर देखेंगे।',
  effortPayFirst: 'पहले मज़दूर की कठिन काम वाली माँग का जवाब दें',
  effortRefusedCount: (n) => `😓 कठिन काम का पैसा ${n} बार मना किया`
});
Object.assign(T.en, { ruleNight: 'Night work (8 PM – 6 AM): +20%' });
Object.assign(T.ta, { ruleNight: 'இரவு வேலை (இரவு 8 – காலை 6): +20%' });
Object.assign(T.hi, { ruleNight: 'रात का काम (रात 8 – सुबह 6): +20%' });

// ---------- Pay through the employer's own UPI app (free, no payment gateway) ----------
// Opens GPay / PhonePe / Paytm with the worker's UPI ID and the amount filled in.
// The employer still taps "Pay and finish" after, and the worker confirms as before.
// The standard UPI format (NPCI): GPay, PhonePe, Paytm, FamPay, BHIM and bank apps all read it,
// as a link on the same phone or as a QR scanned from another phone.
// Only pa / pn / am / cu / tn are used: merchant fields (mc, tr) make apps refuse personal UPI IDs.
function upiLink(b, worker, amount) {
  if (!worker || !worker.upi_id) return '';
  const ascii = (s) => String(s || '').replace(/[^\x20-\x7E]/g, '').replace(/\s+/g, ' ').trim();
  const q = new URLSearchParams({ pa: worker.upi_id.trim(), pn: ascii(worker.name).slice(0, 40) || 'Worker',
    am: Number(amount).toFixed(2), cu: 'INR', tn: `Worker Buddy ${b.type} ${b.id.slice(0, 8)}` });
  return 'upi://pay?' + q.toString().replace(/\+/g, '%20').replace(/%40/g, '@'); // UPI apps expect a plain @
}
function upiPayHTML(b, worker, amount) {
  const link = upiLink(b, worker, amount);
  if (!link) return `<p class="muted small">${t('upiMissing')}</p>`;
  UpiQR.last = { b, worker, amount };
  return `<a class="btn btn-upi btn-block btn-big" href="${attr(link)}">${tf('upiPayBtn', amount)}</a>
    <button type="button" class="btn btn-light btn-block" onclick="showUpiQR(UpiQR.last.b, UpiQR.last.worker, UpiQR.last.amount)">${t('upiQrBtn')}</button>
    <p class="muted small center">${tf('upiHint', esc(worker.upi_id))}</p>`;
}
// A UPI QR anyone can scan with any UPI app (the worker shows it, or the employer pays from another phone)
const UpiQR = { last: null };
function showUpiQR(b, worker, amount) {
  const link = upiLink(b, worker, amount);
  if (!link) return showToast(t('upiMissing'));
  let svg = '';
  if (typeof qrcode === 'function') {
    const q = qrcode(0, 'M');
    q.addData(link);
    q.make();
    svg = q.createSvgTag({ cellSize: 5, margin: 3, scalable: true });
  }
  qrModal();
  document.getElementById('qrBody').innerHTML = `
    <h3>📲 ${t('upiQrTitle')}</h3>
    <div class="qr-box qr-upi">${svg || `<p class="muted">${t('qrNoLib')}</p>`}</div>
    <p class="request-pay center">${money(amount)}</p>
    <p class="center"><b>${esc(worker.name || '')}</b><br><span class="code">${esc(worker.upi_id)}</span></p>
    <p class="muted small center">${t('upiQrHint')}</p>`;
  document.getElementById('qrModal').classList.add('open');
}
Object.assign(T.en, {
  upiIdLabel: 'UPI ID (to get paid in your bank)',
  upiPayBtn: (n) => `📲 Pay ${money(n)} with UPI app`,
  upiHint: (id) => `Opens GPay, PhonePe or Paytm with ${id}. After paying, tap "Pay and finish".`,
  upiMissing: 'This worker has not added a UPI ID. Pay in cash, then tap "Pay and finish".',
  upiQrBtn: '🔳 Show UPI QR (scan from another phone)',
  upiQrTitle: 'Scan to pay with any UPI app',
  upiQrHint: 'Works with GPay, PhonePe, Paytm, FamPay, BHIM and bank apps. The money goes straight to the worker.',
  myUpiQrBtn: (n) => `🔳 Show my UPI QR · ${money(n)}`,
  noUpiYet: 'Add your UPI ID in your profile to show a pay QR.',
  qrIsUpi: 'That is a UPI payment QR. Scan it with GPay, PhonePe or another UPI app, not here.'
});
Object.assign(T.ta, {
  upiIdLabel: 'UPI ID (வங்கியில் கூலி பெற)',
  upiPayBtn: (n) => `📲 UPI ஆப் மூலம் ${money(n)} செலுத்து`,
  upiHint: (id) => `${id} உடன் GPay, PhonePe அல்லது Paytm திறக்கும். செலுத்திய பின் "செலுத்தி முடி" அழுத்தவும்.`,
  upiMissing: 'இந்த வேலையாள் UPI ID சேர்க்கவில்லை. பணமாக கொடுத்து "செலுத்தி முடி" அழுத்தவும்.',
  upiQrBtn: '🔳 UPI QR காட்டு (வேறு போனில் ஸ்கேன் செய்ய)',
  upiQrTitle: 'எந்த UPI ஆப்பிலும் ஸ்கேன் செய்து செலுத்துங்கள்',
  upiQrHint: 'GPay, PhonePe, Paytm, FamPay, BHIM, வங்கி ஆப்கள் அனைத்திலும் வேலை செய்யும். பணம் நேரடியாக வேலையாளுக்குச் செல்லும்.',
  myUpiQrBtn: (n) => `🔳 என் UPI QR காட்டு · ${money(n)}`,
  noUpiYet: 'கட்டண QR காட்ட உங்கள் சுயவிவரத்தில் UPI ID சேர்க்கவும்.',
  qrIsUpi: 'இது UPI கட்டண QR. இதை GPay, PhonePe போன்ற UPI ஆப்பில் ஸ்கேன் செய்யுங்கள்.'
});
Object.assign(T.hi, {
  upiIdLabel: 'UPI ID (बैंक में पैसा पाने के लिए)',
  upiPayBtn: (n) => `📲 UPI ऐप से ${money(n)} दें`,
  upiHint: (id) => `${id} के साथ GPay, PhonePe या Paytm खुलेगा। भुगतान के बाद "दें और पूरा करें" दबाएँ।`,
  upiMissing: 'इस मज़दूर ने UPI ID नहीं जोड़ी है। नकद दें, फिर "दें और पूरा करें" दबाएँ।',
  upiQrBtn: '🔳 UPI QR दिखाएँ (दूसरे फ़ोन से स्कैन करें)',
  upiQrTitle: 'किसी भी UPI ऐप से स्कैन करके भुगतान करें',
  upiQrHint: 'GPay, PhonePe, Paytm, FamPay, BHIM और बैंक ऐप्स में चलता है। पैसा सीधे मज़दूर को जाता है।',
  myUpiQrBtn: (n) => `🔳 मेरा UPI QR दिखाएँ · ${money(n)}`,
  noUpiYet: 'भुगतान QR दिखाने के लिए प्रोफ़ाइल में अपनी UPI ID जोड़ें।',
  qrIsUpi: 'यह UPI भुगतान QR है। इसे GPay, PhonePe या किसी UPI ऐप से स्कैन करें।'
});

// ---------- Posting a job with no internet ----------
Object.assign(T.en, {
  postSavedOffline: '📴 No internet. Job saved on this phone; it will be posted when the internet is back.',
  postsWaiting: (n) => `${n} job${n > 1 ? 's' : ''} waiting for internet to be posted`,
  postSentNow: '✅ Internet is back: your saved job is posted',
  postTooOld: 'A job saved offline was too old to post. Please post it again.'
});
Object.assign(T.ta, {
  postSavedOffline: '📴 இணையம் இல்லை. வேலை இந்த போனில் சேமிக்கப்பட்டது; இணையம் வந்ததும் பதிவாகும்.',
  postsWaiting: (n) => `${n} வேலை இணையத்திற்காக காத்திருக்கிறது`,
  postSentNow: '✅ இணையம் வந்தது: சேமித்த வேலை பதிவானது',
  postTooOld: 'இணையம் இல்லாதபோது சேமித்த வேலை மிகவும் பழையது. மீண்டும் பதிவு செய்யவும்.'
});
Object.assign(T.hi, {
  postSavedOffline: '📴 इंटरनेट नहीं है। काम इस फ़ोन में सेव हुआ; इंटरनेट आते ही पोस्ट होगा।',
  postsWaiting: (n) => `${n} काम इंटरनेट का इंतज़ार कर रहे हैं`,
  postSentNow: '✅ इंटरनेट आ गया: सेव किया काम पोस्ट हो गया',
  postTooOld: 'बिना इंटरनेट सेव किया काम बहुत पुराना था। कृपया फिर से पोस्ट करें।'
});

// ---------- Private OTP: only the job's employer can read it (booking_otps table) ----------
const Otp = Store.get('e_otps', {}) || {};
const PaySecret = Store.get('e_pay', {}) || {};
const OtpAsked = new Set();
async function loadOtps(ids) {
  const need = ids.filter((id) => id && (!Otp[id] || !PaySecret[id]));
  if (!need.length || !navigator.onLine) return;
  const [otps, secrets] = await Promise.all([
    db.from('booking_otps').select('booking_id,otp').in('booking_id', need),
    db.from('booking_pay_secrets').select('booking_id,secret').in('booking_id', need)
  ]);
  (otps.data || []).forEach((r) => { Otp[r.booking_id] = r.otp; });
  (secrets.data || []).forEach((r) => { PaySecret[r.booking_id] = r.secret; });
  Store.set('e_otps', Otp); // the employer can still show them with no internet
  Store.set('e_pay', PaySecret);
}
// Shows the OTP if known; otherwise fetches it once and redraws
function otpOf(b) {
  if (Otp[b.id]) return Otp[b.id];
  if (!OtpAsked.has(b.id)) {
    OtpAsked.add(b.id);
    loadOtps([b.id]).then(() => { if (Otp[b.id] && App.onOtp) App.onOtp(); });
  }
  return '····';
}
Object.assign(T.en, { otpLocked: 'Too many wrong OTPs. Ask the employer to call you.' });
Object.assign(T.ta, { otpLocked: 'பல முறை தவறான OTP. முதலாளியை அழைக்கச் சொல்லுங்கள்.' });
Object.assign(T.hi, { otpLocked: 'कई बार गलत OTP। मालिक से फ़ोन करने को कहें।' });

// Worker locked out after 5 wrong OTPs: the employer makes a new one
async function newOtp(id) {
  const { data, error } = await db.rpc('reset_otp', { p_booking: id, p_employer: E.me.id });
  if (error || !data) return showToast(t('saveError'));
  Otp[id] = data;
  Store.set('e_otps', Otp);
  showToast(tf('newOtpMade', data));
  if (App.onOtp) App.onOtp();
}
Object.assign(T.en, { newOtp: 'New OTP', newOtpMade: (o) => `New OTP: ${o}. Tell it to the worker.` });
Object.assign(T.ta, { newOtp: 'புதிய OTP', newOtpMade: (o) => `புதிய OTP: ${o}. வேலையாளிடம் சொல்லுங்கள்.` });
Object.assign(T.hi, { newOtp: 'नया OTP', newOtpMade: (o) => `नया OTP: ${o}। मज़दूर को बताएँ।` });

// Exact work site (any street or landmark, GPS, or a tap on the map)
Object.assign(T.en, {
  siteHint: '📌 Tap the map or drag the pin to the exact spot.',
  siteNotFound: 'Could not find that place. Tap the map to set the spot.'
});
Object.assign(T.ta, {
  siteHint: '📌 சரியான இடத்துக்கு வரைபடத்தைத் தட்டவும் அல்லது பின்னை இழுக்கவும்.',
  siteNotFound: 'அந்த இடம் கிடைக்கவில்லை. வரைபடத்தைத் தட்டி இடத்தைக் குறிக்கவும்.'
});
Object.assign(T.hi, {
  siteHint: '📌 सही जगह के लिए नक्शे पर टैप करें या पिन खींचें।',
  siteNotFound: 'वह जगह नहीं मिली। नक्शे पर टैप करके जगह चुनें।'
});

// ---------- Cancel a job, always with a reason (like Rapido) ----------
// One box for both apps and every stage. The reason is saved as a key (shown to the other side
// in their own language) or as the words typed under "Other".
const CANCEL_REASONS = {
  worker_before: ['crLate', 'crSick', 'crFar', 'crAskedToCancel', 'crWorkDifferent', 'crTesting'],
  worker_after: ['crWorkDifferent', 'crUnsafe', 'crLetGo', 'crAskedToCancel', 'crTesting'],
  employer_before: ['crPlans', 'crWorkerLate', 'crFoundOther', 'crMistake', 'crTesting'],
  employer_after: ['crNotDone', 'crWorkerLeft', 'crPlans', 'crTesting']
};
const Cancel = { done: null };

function reasonText(note) {
  return note && T.en[note] ? t(note) : (note || '');
}

function askCancel(side, started, warn, done) {
  Cancel.done = done;
  let m = document.getElementById('cancelModal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'cancelModal';
    m.className = 'modal';
    m.innerHTML = '<div class="modal-box"><div id="cancelBody"></div></div>';
    m.addEventListener('click', (e) => { if (e.target === m) closeModal('cancelModal'); });
    document.body.appendChild(m);
  }
  const keys = CANCEL_REASONS[`${side}_${started ? 'after' : 'before'}`];
  document.getElementById('cancelBody').innerHTML = `
    <h3>${t('cancelWhy')}</h3>
    <form id="cancelForm" class="cancel-reasons" onsubmit="event.preventDefault(); sendCancel(this)">
      ${keys.map((k) => `<label class="check"><input type="radio" name="why" value="${k}" required> <span>${t(k)}</span></label>`).join('')}
      <label class="check"><input type="radio" name="why" value="other"> <span>${t('crOther')}</span></label>
      <input name="other" class="input" maxlength="120" placeholder="${attr(t('crOtherPh'))}" hidden>
      ${warn ? `<p class="dispute-note small">${warn}</p>` : ''}
      <button class="btn btn-danger btn-block btn-big" type="submit">${t('cancelJobBtn')}</button>
      <button class="btn btn-light btn-block" type="button" onclick="closeModal('cancelModal')">${t('keepJob')}</button>
    </form>`;
  const f = document.getElementById('cancelForm');
  f.addEventListener('change', () => {
    f.other.hidden = f.why.value !== 'other';
    f.other.required = f.why.value === 'other';
    if (!f.other.hidden) f.other.focus();
  });
  m.classList.add('open');
}

async function sendCancel(f) {
  const note = f.why.value === 'other' ? f.other.value.trim() : f.why.value;
  if (!note) return showToast(t('crPick'));
  const btn = f.querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    await Cancel.done(note);
    closeModal('cancelModal');
  } finally {
    btn.disabled = false;
  }
}

// "Cancelled by the worker: Not feeling well" for the other side
function cancelLine(b) {
  if (!b || !b.cancel_note) return '';
  return tf(b.cancelled_by === 'worker' ? 'cancelledByWorker' : 'cancelledByEmployer', reasonText(b.cancel_note));
}

Object.assign(T.en, {
  cancelWhy: 'Why are you cancelling?',
  cancelJobBtn: 'Cancel job',
  keepJob: 'Keep the job',
  crPick: 'Pick a reason.',
  crOther: 'Other reason',
  crOtherPh: 'Type the reason',
  crLate: 'I can’t reach on time',
  crSick: 'Emergency or not feeling well',
  crFar: 'The place is too far',
  crAskedToCancel: 'The other person asked me to cancel',
  crWorkDifferent: 'The work is different from what was posted',
  crUnsafe: 'The site is not safe',
  crLetGo: 'I don’t want payment for this',
  crTesting: 'Just testing the app',
  crPlans: 'My plans changed',
  crWorkerLate: 'The worker is late or not reachable',
  crFoundOther: 'I found someone else',
  crMistake: 'Posted by mistake',
  crNotDone: 'The work was not done',
  crWorkerLeft: 'The worker left before finishing',
  cancelledByWorker: (r) => `Cancelled by the worker: ${r}`,
  cancelledByEmployer: (r) => `Cancelled by the employer: ${r}`,
  cancelDone: 'Job cancelled.',
  workerClosedNote: 'The worker closed this job with no payment. Nothing is owed.',
  workerCancelBefore: 'The employer will be sent another worker.',
  workerCancelAfter: 'The job closes with no payment.',
  empCancelShowup: 'The worker is already on the way, so ₹100 show-up pay is owed to them.',
  empCancelAfter: 'Work has started. Cancelling counts as an unpaid job and lowers your Fair Pay Score, and the worker can use it as proof in a complaint.',
  employerClosedUnpaid: '⚠️ The employer cancelled after the work started, without paying. It is saved as proof, and their Fair Pay Score went down. Free legal help: 15100.'
});
Object.assign(T.ta, {
  cancelWhy: 'ஏன் ரத்து செய்கிறீர்கள்?',
  cancelJobBtn: 'வேலையை ரத்து செய்',
  keepJob: 'வேலையை வைத்திரு',
  crPick: 'ஒரு காரணத்தைத் தேர்ந்தெடுக்கவும்.',
  crOther: 'வேறு காரணம்',
  crOtherPh: 'காரணத்தை டைப் செய்யவும்',
  crLate: 'நேரத்துக்கு வர முடியாது',
  crSick: 'அவசரம் அல்லது உடல்நலம் சரியில்லை',
  crFar: 'இடம் மிகத் தொலைவில் உள்ளது',
  crAskedToCancel: 'மற்றவர் ரத்து செய்யச் சொன்னார்',
  crWorkDifferent: 'பதிவிட்டதிலிருந்து வேலை வேறாக உள்ளது',
  crUnsafe: 'வேலை இடம் பாதுகாப்பாக இல்லை',
  crLetGo: 'இதற்குப் பணம் வேண்டாம்',
  crTesting: 'ஆப்பைச் சோதிக்கிறேன்',
  crPlans: 'என் திட்டம் மாறிவிட்டது',
  crWorkerLate: 'வேலையாள் தாமதம் அல்லது தொடர்பில் இல்லை',
  crFoundOther: 'வேறு ஒருவரைக் கண்டுபிடித்தேன்',
  crMistake: 'தவறாகப் பதிவிட்டேன்',
  crNotDone: 'வேலை செய்யப்படவில்லை',
  crWorkerLeft: 'வேலையாள் முடிக்காமல் சென்றார்',
  cancelledByWorker: (r) => `வேலையாள் ரத்து செய்தார்: ${r}`,
  cancelledByEmployer: (r) => `முதலாளி ரத்து செய்தார்: ${r}`,
  cancelDone: 'வேலை ரத்து செய்யப்பட்டது.',
  workerClosedNote: 'வேலையாள் இந்த வேலையைப் பணம் இல்லாமல் மூடினார். எதுவும் தர வேண்டியதில்லை.',
  workerCancelBefore: 'முதலாளிக்கு வேறு வேலையாள் அனுப்பப்படுவார்.',
  workerCancelAfter: 'பணம் இல்லாமல் வேலை மூடப்படும்.',
  empCancelShowup: 'வேலையாள் ஏற்கனவே வருகிறார், எனவே ₹100 வருகைக் கூலி தர வேண்டும்.',
  empCancelAfter: 'வேலை தொடங்கிவிட்டது. ரத்து செய்தால் செலுத்தாத வேலையாகக் கணக்கிடப்பட்டு Fair Pay மதிப்பெண் குறையும்; வேலையாள் இதைச் சான்றாகப் பயன்படுத்தலாம்.',
  employerClosedUnpaid: '⚠️ வேலை தொடங்கிய பின் முதலாளி பணம் செலுத்தாமல் ரத்து செய்தார். இது சான்றாகச் சேமிக்கப்பட்டது; அவரது Fair Pay மதிப்பெண் குறைந்தது. இலவச சட்ட உதவி: 15100.'
});
Object.assign(T.hi, {
  cancelWhy: 'आप क्यों रद्द कर रहे हैं?',
  cancelJobBtn: 'काम रद्द करें',
  keepJob: 'काम रखें',
  crPick: 'एक कारण चुनें।',
  crOther: 'कोई और कारण',
  crOtherPh: 'कारण लिखें',
  crLate: 'समय पर नहीं पहुँच सकता',
  crSick: 'आपात स्थिति या तबीयत ठीक नहीं',
  crFar: 'जगह बहुत दूर है',
  crAskedToCancel: 'दूसरे व्यक्ति ने रद्द करने को कहा',
  crWorkDifferent: 'काम पोस्ट किए गए काम से अलग है',
  crUnsafe: 'काम की जगह सुरक्षित नहीं है',
  crLetGo: 'मुझे इसका पैसा नहीं चाहिए',
  crTesting: 'बस ऐप टेस्ट कर रहा हूँ',
  crPlans: 'मेरी योजना बदल गई',
  crWorkerLate: 'मज़दूर देर कर रहा है या संपर्क में नहीं',
  crFoundOther: 'मुझे कोई और मिल गया',
  crMistake: 'गलती से पोस्ट हुआ',
  crNotDone: 'काम नहीं हुआ',
  crWorkerLeft: 'मज़दूर काम पूरा किए बिना चला गया',
  cancelledByWorker: (r) => `मज़दूर ने रद्द किया: ${r}`,
  cancelledByEmployer: (r) => `मालिक ने रद्द किया: ${r}`,
  cancelDone: 'काम रद्द हुआ।',
  workerClosedNote: 'मज़दूर ने यह काम बिना भुगतान के बंद किया। कुछ देना बाकी नहीं।',
  workerCancelBefore: 'मालिक को दूसरा मज़दूर भेजा जाएगा।',
  workerCancelAfter: 'काम बिना भुगतान के बंद होगा।',
  empCancelShowup: 'मज़दूर पहले से रास्ते में है, इसलिए ₹100 आने का पैसा देना होगा।',
  empCancelAfter: 'काम शुरू हो चुका है। रद्द करना बिना भुगतान वाला काम गिना जाएगा और आपका Fair Pay स्कोर घटेगा; मज़दूर इसे सबूत की तरह इस्तेमाल कर सकता है।',
  employerClosedUnpaid: '⚠️ काम शुरू होने के बाद मालिक ने बिना भुगतान के रद्द किया। यह सबूत के रूप में सहेजा गया है और उनका Fair Pay स्कोर घटा। मुफ़्त कानूनी मदद: 15100.'
});
