// trust.js — shared by both apps: privacy notice and consent, report and block, download or delete
// my data, and plain messages for the database's safety checks (supabase/018 and 019).
// Owner: Member 4.

const CONSENT_VERSION = '2026-10';

// ---------- Messages for the safety checks ----------
// Returns true when the error was one of ours and the person has been told what to do
function trustError(error) {
  const m = String((error && error.message) || '');
  if (m === 'verify_first') {
    showToast(t('needVerify'));
    if (typeof openAccount === 'function') openAccount();
    return true;
  }
  const keys = { suspended: 'accSuspended', slow_down: 'slowDown', blocked: 'blockedPair', own_job: 'ownJob',
    finish_jobs_first: 'finishJobsFirst', delete_failed: 'deleteFailed', bad_phone: 'badPhone' };
  if (keys[m]) {
    showToast(t(keys[m]));
    return true;
  }
  return false;
}

// ---------- Privacy notice: shown once, before the app collects anything ----------
function ensureConsent() {
  if (Store.get('consent', null) === CONSENT_VERSION) return Promise.resolve();
  return new Promise((resolve) => {
    const m = document.createElement('div');
    m.id = 'consentModal';
    m.className = 'modal open';
    m.setAttribute('role', 'dialog');
    m.setAttribute('aria-modal', 'true');
    const draw = () => {
      m.innerHTML = `<div class="modal-box consent-box">
        <h3>🔐 ${t('consentTitle')} ${speakButton(t('consentSpeech'))}</h3>
        <ul class="consent-list">${['consent1', 'consent2', 'consent3', 'consent4', 'consent5'].map((k) => `<li>${t(k)}</li>`).join('')}</ul>
        <p class="small"><a href="../privacy/" target="_blank" rel="noopener">${t('privacyRead')}</a></p>
        <button type="button" class="btn btn-accept btn-block btn-big" id="consentYes">${t('consentAgree')}</button>
        <p class="muted small">${t('consentNo')}</p>
      </div>`;
      m.querySelector('#consentYes').addEventListener('click', () => {
        Store.set('consent', CONSENT_VERSION);
        Store.set('consent_lang', App.lang);
        m.remove();
        resolve();
      });
    };
    draw();
    const before = App.onLang;
    App.onLang = () => { if (before) before(); if (document.body.contains(m)) draw(); };
    document.body.appendChild(m);
  });
}

// Once signed in: record which notice this account agreed to (kept for the law). Remembered per
// account, because signing in with Google or another number on this phone is a different account.
async function sendConsent() {
  if (!navigator.onLine || Store.get('consent', null) !== CONSENT_VERSION) return;
  try {
    const { data } = await db.auth.getSession();
    const id = data.session && data.session.user && data.session.user.id;
    if (!id || Store.get('consent_sent_' + id, null) === CONSENT_VERSION) return;
    const { error } = await db.rpc('give_consent', { p_version: CONSENT_VERSION, p_lang: Store.get('consent_lang', App.lang) });
    if (!error) Store.set('consent_sent_' + id, CONSENT_VERSION);
  } catch (e) { /* offline: tried again on the next start */ }
}

// ---------- Report or block the other person on a job ----------
const REPORT_REASONS = {
  worker: ['fake_job', 'no_pay', 'unsafe', 'abuse', 'other'],
  employer: ['no_show', 'abuse', 'unsafe', 'other']
};

function reportLinkHTML(bookingId, side) {
  return `<button type="button" class="link-btn small report-link" onclick="askReport('${attr(bookingId)}', '${side}')">⚠️ ${t('reportBtn')}</button>`;
}

function askReport(bookingId, side) {
  let m = document.getElementById('reportModal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'reportModal';
    m.className = 'modal';
    m.innerHTML = '<div class="modal-box"><div id="reportBody"></div></div>';
    m.addEventListener('click', (e) => { if (e.target === m) closeModal('reportModal'); });
    document.body.appendChild(m);
  }
  document.getElementById('reportBody').innerHTML = `
    <h3>${t(side === 'worker' ? 'reportEmployerTitle' : 'reportWorkerTitle')}</h3>
    <form id="reportForm" class="cancel-reasons" onsubmit="event.preventDefault(); sendReport(this, '${attr(bookingId)}', '${side}')">
      ${REPORT_REASONS[side].map((k) => `<label class="check"><input type="radio" name="why" value="${k}" required> <span>${t('rr_' + k)}</span></label>`).join('')}
      <textarea name="note" class="input" maxlength="300" rows="2" placeholder="${attr(t('reportNotePh'))}"></textarea>
      <label class="check"><input type="checkbox" name="block" checked> <span>${t(side === 'worker' ? 'blockEmployer' : 'blockWorker')}</span></label>
      <p class="dispute-note small">${t('reportDanger')}</p>
      <button class="btn btn-danger btn-block btn-big" type="submit">${t('reportSend')}</button>
      <button class="btn btn-light btn-block" type="button" onclick="closeModal('reportModal')">${t('close')}</button>
    </form>`;
  m.classList.add('open');
}

async function sendReport(f, bookingId, side) {
  if (!f.why.value) return showToast(t('crPick'));
  if (!navigator.onLine) return showToast(t('accOffline'));
  const btn = f.querySelector('button[type=submit]');
  btn.disabled = true;
  const { error } = await db.rpc('report_person', {
    p_booking: bookingId, p_by: side, p_reason: f.why.value, p_note: f.note.value.trim(), p_block: f.block.checked
  });
  btn.disabled = false;
  if (error) return trustError(error) || showToast(t('saveError'));
  closeModal('reportModal');
  showToast(t(f.block.checked ? 'reportSentBlocked' : 'reportSent'));
}

// ---------- My data: privacy page, download, delete (in the account box) ----------
function privacyLinksHTML() {
  const signedIn = Acc.user && Acc.haveProfile();
  return `<div class="privacy-links small">
      <a href="../privacy/" target="_blank" rel="noopener">📄 ${t('privacyLink')}</a>
      ${signedIn ? `<button type="button" class="link-btn small" onclick="downloadMyData()">⬇️ ${t('downloadData')}</button>
      <button type="button" class="link-btn small danger-link" onclick="deleteMyAccount()">🗑️ ${t('deleteAccount')}</button>` : ''}
    </div>`;
}

async function downloadMyData() {
  if (!navigator.onLine) return showToast(t('accOffline'));
  const { data, error } = await db.rpc('export_my_data');
  if (error || !data) return showToast(t('saveError'));
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `worker-buddy-my-data-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  showToast(t('dataDownloaded'));
}

async function deleteMyAccount() {
  if (!navigator.onLine) return showToast(t('accOffline'));
  if (!confirm(t('deleteAsk1')) || !confirm(t('deleteAsk2'))) return;
  const { error } = await db.rpc('delete_my_account');
  if (error) return trustError(error) || showToast(t('saveError'));
  try { await db.auth.signOut({ scope: 'local' }); } catch (e) { /* the account is already gone */ }
  Store.clear();
  alert(t('deleteDone'));
  location.href = '../';
}

// ---------- Text ----------
Object.assign(T.en, {
  needVerify: 'Sign in with Google or your mobile number first. It keeps fake accounts out.',
  accSuspended: 'This account is on hold while the Worker Buddy team checks a report.',
  slowDown: 'Too many in a short time. Wait a while and try again.',
  blockedPair: 'You can’t work with this person: one of you has blocked the other.',
  ownJob: 'You can’t take your own job.',
  finishJobsFirst: 'Finish or cancel your current jobs first.',
  consentTitle: 'Your data and your privacy',
  consentSpeech: 'Worker Buddy saves your name, mobile number, work, location and payments to find you work and make pay slips. We never sell it. Only the person on your job sees your number. You can download or delete your data any time.',
  consent1: 'We save your name, mobile number, type of work, jobs and payments, to find you work and make pay slips.',
  consent2: 'While you are online or on a job, we use your location to show nearby jobs and the way to the site.',
  consent3: 'Your number and exact location are shown only to the other person on your job. We never sell your data.',
  consent4: 'Workers must be 18 or older.',
  consent5: 'You can download or delete your data any time from the 👤 account button.',
  privacyRead: 'Read the full privacy notice and terms',
  consentAgree: 'I agree, continue',
  consentNo: 'If you don’t agree, close this page. Nothing is saved until you agree.',
  reportBtn: 'Report or block',
  reportEmployerTitle: 'Report this employer',
  reportWorkerTitle: 'Report this worker',
  rr_fake_job: 'The job was fake or not as posted',
  rr_no_pay: 'I was not paid',
  rr_unsafe: 'Unsafe site or I felt in danger',
  rr_abuse: 'Abuse, threats or harassment',
  rr_no_show: 'Did not come or left without finishing',
  rr_other: 'Something else',
  reportNotePh: 'What happened? (optional)',
  blockEmployer: 'Block: don’t show me this employer’s jobs again',
  blockWorker: 'Block: never send my jobs to this worker again',
  reportDanger: 'In danger now? Call 112.',
  reportSend: 'Send report',
  reportSent: 'Report sent. The Worker Buddy team will look at it.',
  reportSentBlocked: 'Report sent and blocked. The Worker Buddy team will look at it.',
  privacyLink: 'Privacy and terms',
  downloadData: 'Download my data',
  deleteAccount: 'Delete my account',
  dataDownloaded: 'Your data file is downloaded.',
  deleteAsk1: 'Delete your account? Your profile, crew list and saved places will be removed. Pay slips the other person holds keep the job, without your name or number.',
  deleteAsk2: 'This can’t be undone. Delete now?',
  deleteDone: 'Your account is deleted.',
  deleteFailed: 'Could not delete the account. Nothing was changed. Try again later.'
});
Object.assign(T.ta, {
  needVerify: 'முதலில் Google அல்லது மொபைல் எண் மூலம் உள்நுழையவும். இது போலி கணக்குகளைத் தடுக்கும்.',
  accSuspended: 'ஒரு புகாரை Worker Buddy குழு சரிபார்க்கும் வரை இந்தக் கணக்கு நிறுத்தி வைக்கப்பட்டுள்ளது.',
  slowDown: 'குறுகிய நேரத்தில் அதிகம். சிறிது நேரம் கழித்து முயலவும்.',
  blockedPair: 'இவருடன் வேலை செய்ய முடியாது: உங்களில் ஒருவர் மற்றவரைத் தடுத்துள்ளார்.',
  ownJob: 'உங்கள் சொந்த வேலையை நீங்களே எடுக்க முடியாது.',
  finishJobsFirst: 'முதலில் நடப்பு வேலைகளை முடிக்கவும் அல்லது ரத்து செய்யவும்.',
  consentTitle: 'உங்கள் தகவலும் தனியுரிமையும்',
  consentSpeech: 'வேலை தேடவும் கூலிச் சீட்டு தயாரிக்கவும் Worker Buddy உங்கள் பெயர், மொபைல் எண், வேலை, இருப்பிடம், பணம் விவரங்களைச் சேமிக்கிறது. இதை நாங்கள் ஒருபோதும் விற்பதில்லை. உங்கள் வேலையில் உள்ளவர் மட்டுமே உங்கள் எண்ணைப் பார்ப்பார். எப்போது வேண்டுமானாலும் உங்கள் தகவலைப் பதிவிறக்கலாம் அல்லது நீக்கலாம்.',
  consent1: 'வேலை தேடவும் கூலிச் சீட்டு தயாரிக்கவும் உங்கள் பெயர், மொபைல் எண், வேலை வகை, வேலைகள், பணம் விவரங்களைச் சேமிக்கிறோம்.',
  consent2: 'நீங்கள் ஆன்லைனில் அல்லது வேலையில் இருக்கும்போது, அருகிலுள்ள வேலைகளையும் வழியையும் காட்ட இருப்பிடத்தைப் பயன்படுத்துகிறோம்.',
  consent3: 'உங்கள் எண்ணும் சரியான இருப்பிடமும் உங்கள் வேலையில் உள்ளவருக்கு மட்டுமே தெரியும். உங்கள் தகவலை ஒருபோதும் விற்பதில்லை.',
  consent4: 'தொழிலாளர்கள் 18 வயது அல்லது அதற்கு மேல் இருக்க வேண்டும்.',
  consent5: '👤 கணக்கு பொத்தானில் எப்போது வேண்டுமானாலும் உங்கள் தகவலைப் பதிவிறக்கலாம் அல்லது நீக்கலாம்.',
  privacyRead: 'முழு தனியுரிமை அறிவிப்பு மற்றும் விதிமுறைகளைப் படிக்கவும்',
  consentAgree: 'ஒப்புக்கொள்கிறேன், தொடர்',
  consentNo: 'ஒப்புக்கொள்ளவில்லை என்றால் இந்தப் பக்கத்தை மூடவும். ஒப்புக்கொள்ளும் வரை எதுவும் சேமிக்கப்படாது.',
  reportBtn: 'புகார் அல்லது தடு',
  reportEmployerTitle: 'இந்த முதலாளியைப் பற்றி புகார்',
  reportWorkerTitle: 'இந்தத் தொழிலாளியைப் பற்றி புகார்',
  rr_fake_job: 'வேலை போலியானது அல்லது சொன்னபடி இல்லை',
  rr_no_pay: 'எனக்கு கூலி தரவில்லை',
  rr_unsafe: 'பாதுகாப்பற்ற இடம் அல்லது ஆபத்தாக உணர்ந்தேன்',
  rr_abuse: 'திட்டுதல், மிரட்டல் அல்லது தொல்லை',
  rr_no_show: 'வரவில்லை அல்லது முடிக்காமல் சென்றார்',
  rr_other: 'வேறு ஏதாவது',
  reportNotePh: 'என்ன நடந்தது? (விருப்பம்)',
  blockEmployer: 'தடு: இந்த முதலாளியின் வேலைகளை இனி காட்ட வேண்டாம்',
  blockWorker: 'தடு: என் வேலைகளை இனி இவருக்கு அனுப்ப வேண்டாம்',
  reportDanger: 'இப்போது ஆபத்திலா? 112 அழைக்கவும்.',
  reportSend: 'புகார் அனுப்பு',
  reportSent: 'புகார் அனுப்பப்பட்டது. Worker Buddy குழு சரிபார்க்கும்.',
  reportSentBlocked: 'புகார் அனுப்பப்பட்டது, தடுக்கப்பட்டது. Worker Buddy குழு சரிபார்க்கும்.',
  privacyLink: 'தனியுரிமை மற்றும் விதிமுறைகள்',
  downloadData: 'என் தகவலைப் பதிவிறக்கு',
  deleteAccount: 'என் கணக்கை நீக்கு',
  dataDownloaded: 'உங்கள் தகவல் கோப்பு பதிவிறக்கப்பட்டது.',
  deleteAsk1: 'உங்கள் கணக்கை நீக்கவா? சுயவிவரம், குழு பட்டியல், சேமித்த இடங்கள் நீக்கப்படும். மற்றவரிடம் உள்ள கூலிச் சீட்டில் வேலை இருக்கும், உங்கள் பெயர், எண் இல்லாமல்.',
  deleteAsk2: 'இதை மாற்ற முடியாது. இப்போது நீக்கவா?',
  deleteDone: 'உங்கள் கணக்கு நீக்கப்பட்டது.',
  deleteFailed: 'கணக்கை நீக்க முடியவில்லை. எதுவும் மாற்றப்படவில்லை. பிறகு முயலவும்.'
});
Object.assign(T.hi, {
  needVerify: 'पहले Google या मोबाइल नंबर से साइन इन करें। इससे नकली खाते रुकते हैं।',
  accSuspended: 'एक शिकायत की जाँच होने तक यह खाता रोका गया है।',
  slowDown: 'थोड़े समय में बहुत ज़्यादा। कुछ देर बाद फिर कोशिश करें।',
  blockedPair: 'आप इनके साथ काम नहीं कर सकते: आप में से किसी ने दूसरे को ब्लॉक किया है।',
  ownJob: 'आप अपना ही काम नहीं ले सकते।',
  finishJobsFirst: 'पहले अपने चल रहे काम पूरे या रद्द करें।',
  consentTitle: 'आपका डेटा और आपकी निजता',
  consentSpeech: 'काम ढूँढने और वेतन पर्ची बनाने के लिए Worker Buddy आपका नाम, मोबाइल नंबर, काम, लोकेशन और भुगतान सेव करता है। हम इसे कभी नहीं बेचते। आपका नंबर सिर्फ़ आपके काम वाले व्यक्ति को दिखता है। आप कभी भी अपना डेटा डाउनलोड या डिलीट कर सकते हैं।',
  consent1: 'काम ढूँढने और वेतन पर्ची बनाने के लिए हम आपका नाम, मोबाइल नंबर, काम का प्रकार, काम और भुगतान सेव करते हैं।',
  consent2: 'जब आप ऑनलाइन हों या काम पर हों, पास के काम और रास्ता दिखाने के लिए हम आपकी लोकेशन इस्तेमाल करते हैं।',
  consent3: 'आपका नंबर और सही लोकेशन सिर्फ़ आपके काम वाले व्यक्ति को दिखती है। हम आपका डेटा कभी नहीं बेचते।',
  consent4: 'मज़दूर की उम्र 18 साल या उससे ज़्यादा होनी चाहिए।',
  consent5: '👤 खाता बटन से आप कभी भी अपना डेटा डाउनलोड या डिलीट कर सकते हैं।',
  privacyRead: 'पूरी निजता सूचना और शर्तें पढ़ें',
  consentAgree: 'मैं सहमत हूँ, आगे बढ़ें',
  consentNo: 'सहमत नहीं हैं तो यह पेज बंद करें। सहमति से पहले कुछ भी सेव नहीं होता।',
  reportBtn: 'शिकायत या ब्लॉक',
  reportEmployerTitle: 'इस मालिक की शिकायत करें',
  reportWorkerTitle: 'इस मज़दूर की शिकायत करें',
  rr_fake_job: 'काम नकली था या बताए जैसा नहीं था',
  rr_no_pay: 'मुझे पैसे नहीं मिले',
  rr_unsafe: 'जगह असुरक्षित थी या मुझे खतरा लगा',
  rr_abuse: 'गाली, धमकी या परेशान करना',
  rr_no_show: 'नहीं आए या काम पूरा किए बिना चले गए',
  rr_other: 'कुछ और',
  reportNotePh: 'क्या हुआ? (वैकल्पिक)',
  blockEmployer: 'ब्लॉक: इस मालिक के काम फिर न दिखाएँ',
  blockWorker: 'ब्लॉक: मेरे काम इस मज़दूर को फिर न भेजें',
  reportDanger: 'अभी खतरे में हैं? 112 पर कॉल करें।',
  reportSend: 'शिकायत भेजें',
  reportSent: 'शिकायत भेजी गई। Worker Buddy टीम जाँच करेगी।',
  reportSentBlocked: 'शिकायत भेजी गई और ब्लॉक किया गया। Worker Buddy टीम जाँच करेगी।',
  privacyLink: 'निजता और शर्तें',
  downloadData: 'मेरा डेटा डाउनलोड करें',
  deleteAccount: 'मेरा खाता डिलीट करें',
  dataDownloaded: 'आपकी डेटा फ़ाइल डाउनलोड हो गई।',
  deleteAsk1: 'खाता डिलीट करें? प्रोफ़ाइल, टीम सूची और सेव की जगहें हट जाएँगी। दूसरे व्यक्ति की वेतन पर्ची में काम रहेगा, आपके नाम और नंबर के बिना।',
  deleteAsk2: 'यह वापस नहीं होगा। अभी डिलीट करें?',
  deleteDone: 'आपका खाता डिलीट हो गया।',
  deleteFailed: 'खाता डिलीट नहीं हो सका। कुछ नहीं बदला। बाद में फिर कोशिश करें।'
});
