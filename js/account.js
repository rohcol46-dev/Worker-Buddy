// account.js — sign in with Google or a mobile number (OTP by SMS), on top of the phone's own account.
// A new phone starts with an anonymous account (no password). Adding Google or a mobile number to it
// keeps the same account, so the profile, jobs and pay slips come back on a new phone or after
// clearing the browser: sign in there with the same Google account or number.
// Owner: Member 4. Needs the Google and Phone providers switched on in Supabase (see README).

const Acc = { user: null, phone: null, step: 'idle', haveProfile: () => false, onSignedIn: null };

async function accUser() {
  try {
    const { data } = await db.auth.getUser();
    Acc.user = data.user || null;
  } catch (e) { /* offline */ }
  return Acc.user;
}

function accGoogle(u) {
  return u && (u.identities || []).find((i) => i.provider === 'google');
}

function accErr(error) {
  const m = String((error && (error.code || error.message)) || '');
  if (/provider.*not.*enabled|unsupported_provider|validation_failed.*provider|phone_provider_disabled|sms_send_failed|Unsupported phone provider/i.test(m)) return t('accNotOn');
  if (/identity_already_exists|already.*linked|phone_exists|already.*registered|email_exists/i.test(m)) return t('accTaken');
  if (/otp_expired|invalid.*otp|token.*(invalid|expired)/i.test(m)) return t('accBadOtp');
  if (/rate|too many|over_sms_send_rate/i.test(m)) return t('accSlowDown');
  return t('accFailed');
}

// Which sign-in options are switched on in Supabase (a switched-off one would open an error page)
async function accProviders() {
  if (Acc.providers) return Acc.providers;
  if (!navigator.onLine) return {};
  try {
    const r = await fetch(SUPABASE_URL + '/auth/v1/settings', { headers: { apikey: SUPABASE_KEY } });
    Acc.providers = (await r.json()).external || {};
  } catch (e) {
    return {};
  }
  return Acc.providers;
}

// Google: link it to this phone's account if a profile is already here, otherwise sign in with it
async function accSignInGoogle() {
  if (!navigator.onLine) return showToast(t('accOffline'));
  if (!(await accProviders()).google) return showToast(t('accNotOn'));
  const u = await accUser();
  const back = location.origin + location.pathname;
  const linking = u && u.is_anonymous && Acc.haveProfile();
  const { error } = linking
    ? await db.auth.linkIdentity({ provider: 'google', options: { redirectTo: back } })
    : await db.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: back } });
  if (error) showToast(accErr(error));
  // on success the browser goes to Google and comes back here, already signed in
}

function accPhoneNumber(raw) {
  const d = String(raw || '').replace(/\D/g, '').replace(/^(91|0)(?=[6-9]\d{9}$)/, '');
  return /^[6-9]\d{9}$/.test(d) ? '+91' + d : null;
}

async function accSendOtp(event) {
  event.preventDefault();
  if (!navigator.onLine) return showToast(t('accOffline'));
  const phone = accPhoneNumber(event.target.mobile.value);
  if (!phone) return showToast(t('badPhone'));
  if (!(await accProviders()).phone) return showToast(t('accNotOn'));
  const u = await accUser();
  Acc.linking = !!(u && u.is_anonymous && Acc.haveProfile());
  const { error } = Acc.linking ? await db.auth.updateUser({ phone }) : await db.auth.signInWithOtp({ phone });
  if (error) return showToast(accErr(error));
  Acc.phone = phone;
  Acc.step = 'otp';
  renderAccount();
  showToast(tf('accOtpSent', phone));
}

async function accVerifyOtp(event) {
  event.preventDefault();
  const token = event.target.code.value.replace(/\D/g, '');
  if (token.length < 6) return showToast(t('accBadOtp'));
  const { error } = await db.auth.verifyOtp({ phone: Acc.phone, token, type: Acc.linking ? 'phone_change' : 'sms' });
  if (error) return showToast(accErr(error));
  Acc.step = 'idle';
  await accSignedIn();
}

async function accSignOut() {
  if (!confirm(t('accSignOutAsk'))) return;
  await db.auth.signOut();
  ['w_me', 'e_me', 'device'].forEach((k) => Store.set(k, null));
  location.reload();
}

// After Google comes back, or the SMS code is right: reload so the app opens this account's profile
async function accSignedIn() {
  await accUser();
  showToast(t('accDone'));
  if (Acc.onSignedIn) await Acc.onSignedIn();
  renderAccount();
}

function accountHTML() {
  const u = Acc.user;
  const g = accGoogle(u);
  const linked = u && !u.is_anonymous;
  const head = linked
    ? `<b>🔐 ${t('accSafeTitle')}</b>
       <p class="muted small">${[g ? `Google: ${esc((g.identity_data && g.identity_data.email) || u.email || '')}` : '', u.phone ? `📱 +${esc(u.phone)}` : ''].filter(Boolean).join(' · ')}</p>`
    : `<b>🔐 ${t(Acc.haveProfile() ? 'accProtectTitle' : 'accHaveTitle')}</b>
       <p class="muted small">${t(Acc.haveProfile() ? 'accProtectHint' : 'accHaveHint')}</p>`;
  const google = g ? '' : `<button type="button" class="btn btn-light btn-block btn-google" onclick="accSignInGoogle()">
      <svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
      ${t(Acc.haveProfile() && !linked ? 'accLinkGoogle' : 'accGoogle')}</button>`;
  let phone = '';
  if (!(u && u.phone)) {
    phone = Acc.step === 'otp'
      ? `<form class="row acc-row" onsubmit="accVerifyOtp(event)">
           <input name="code" class="input" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required placeholder="${attr(tf('accCodePh', Acc.phone))}">
           <button class="btn btn-dark btn-small" type="submit">${t('accVerify')}</button>
         </form>
         <button type="button" class="link-btn small" onclick="Acc.step='idle'; renderAccount()">${t('accChangeNumber')}</button>`
      : `<form class="row acc-row" onsubmit="accSendOtp(event)">
           <span class="acc-cc">+91</span>
           <input name="mobile" class="input" type="tel" inputmode="numeric" maxlength="10" required placeholder="9876543210" autocomplete="tel-national">
           <button class="btn btn-dark btn-small" type="submit">${t('accSendOtp')}</button>
         </form>`;
  }
  const out = linked ? `<button type="button" class="link-btn small" onclick="accSignOut()">${t('accSignOut')}</button>` : '';
  return head + google + (phone ? `<p class="small acc-or">${t(Acc.haveProfile() && !linked ? 'accOrPhoneLink' : 'accOrPhone')}</p>${phone}` : '') + out;
}

async function renderAccount() {
  accProviders();
  document.querySelectorAll('.account-box').forEach((box) => { box.hidden = false; box.innerHTML = accountHTML(); });
  renderAccountButton();
}

// The 👤 button in the top bar of both apps: "Sign in", or who is signed in
function renderAccountButton() {
  const btn = document.getElementById('accBtn');
  if (!btn) return;
  const u = Acc.user;
  const g = accGoogle(u);
  const who = u && !u.is_anonymous
    ? ((g && g.identity_data && g.identity_data.email) || u.email || (u.phone ? '+' + u.phone : '')).split('@')[0] : '';
  btn.textContent = who ? `✅ ${who.slice(0, 14)}` : `👤 ${t('accSignInShort')}`;
}

function openAccount() {
  let m = document.getElementById('accountModal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'accountModal';
    m.className = 'modal';
    m.innerHTML = `<div class="modal-box"><div class="account-box"></div>
      <button class="btn btn-light btn-block" onclick="closeModal('accountModal')">${t('close')}</button></div>`;
    m.addEventListener('click', (e) => { if (e.target === m) closeModal('accountModal'); });
    document.body.appendChild(m);
  }
  renderAccount();
  m.classList.add('open');
}

// Called once at start. haveProfile tells if this phone already has a profile; onSignedIn reloads it.
async function initAccount(haveProfile, onSignedIn) {
  Acc.haveProfile = haveProfile;
  Acc.onSignedIn = onSignedIn;
  // Coming back from Google with an error in the address (for example the account is already used)
  const q = new URLSearchParams(location.hash.slice(1) + '&' + location.search.slice(1));
  if (q.get('error_description') || q.get('error_code')) {
    showToast(accErr({ code: q.get('error_code'), message: q.get('error_description') }));
    history.replaceState(null, '', location.pathname);
  }
  await accUser();
  renderAccount();
  db.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_IN' || event === 'USER_UPDATED') accUser().then(renderAccount);
  });
}

// ---------- Text ----------
Object.assign(T.en, {
  accHaveTitle: 'Already have an account?',
  accHaveHint: 'Sign in to get your profile, jobs and pay slips back on this phone.',
  accProtectTitle: 'Keep your account safe',
  accProtectHint: 'Add Google or your mobile number. If you change phones or clear the browser, sign in to get everything back.',
  accSafeTitle: 'Your account is saved',
  accGoogle: 'Sign in with Google',
  accLinkGoogle: 'Add Google to this account',
  accOrPhone: 'or with your mobile number',
  accOrPhoneLink: 'or add your mobile number',
  accSendOtp: 'Send OTP',
  accCodePh: (p) => `6-digit code sent to ${p}`,
  accVerify: 'Verify',
  accChangeNumber: 'Change number',
  accOtpSent: (p) => `OTP sent to ${p}`,
  accDone: '✅ Signed in. Your account is saved.',
  accSignOut: 'Sign out',
  accSignOutAsk: 'Sign out on this phone? Sign in again with the same Google account or number to get everything back.',
  accNotOn: 'This sign-in option is still being set up by the Worker Buddy team. Use Continue for now; your account stays on this phone.',
  accSignInShort: 'Sign in',
  accTaken: 'That Google account or number already has a Worker Buddy account. Sign out, then sign in with it.',
  accBadOtp: 'Wrong or expired code. Try again.',
  accSlowDown: 'Too many tries. Wait a minute and try again.',
  accFailed: 'Could not sign in. Try again.',
  accOffline: 'Connect to the internet to sign in.'
});
Object.assign(T.ta, {
  accHaveTitle: 'ஏற்கனவே கணக்கு உள்ளதா?',
  accHaveHint: 'உள்நுழைந்தால் உங்கள் சுயவிவரம், வேலைகள், கூலிச் சீட்டுகள் இந்த போனில் திரும்ப வரும்.',
  accProtectTitle: 'உங்கள் கணக்கைப் பாதுகாக்கவும்',
  accProtectHint: 'Google அல்லது மொபைல் எண்ணைச் சேர்க்கவும். போன் மாற்றினாலும் உள்நுழைந்து அனைத்தையும் திரும்பப் பெறலாம்.',
  accSafeTitle: 'உங்கள் கணக்கு சேமிக்கப்பட்டது',
  accGoogle: 'Google மூலம் உள்நுழை',
  accLinkGoogle: 'இந்தக் கணக்கில் Google சேர்',
  accOrPhone: 'அல்லது மொபைல் எண் மூலம்',
  accOrPhoneLink: 'அல்லது மொபைல் எண்ணைச் சேர்',
  accSendOtp: 'OTP அனுப்பு',
  accCodePh: (p) => `${p} க்கு வந்த 6 இலக்க குறியீடு`,
  accVerify: 'சரிபார்',
  accChangeNumber: 'எண்ணை மாற்று',
  accOtpSent: (p) => `${p} க்கு OTP அனுப்பப்பட்டது`,
  accDone: '✅ உள்நுழைந்தீர்கள். கணக்கு சேமிக்கப்பட்டது.',
  accSignOut: 'வெளியேறு',
  accSignOutAsk: 'இந்த போனில் வெளியேறவா? அதே Google அல்லது எண்ணில் மீண்டும் உள்நுழைந்தால் அனைத்தும் திரும்ப வரும்.',
  accNotOn: 'இந்த உள்நுழைவு வசதி இன்னும் அமைக்கப்படுகிறது. இப்போது "தொடர்" பயன்படுத்தவும்; உங்கள் கணக்கு இந்த போனில் இருக்கும்.',
  accSignInShort: 'உள்நுழை',
  accTaken: 'அந்த Google கணக்கு அல்லது எண்ணுக்கு ஏற்கனவே கணக்கு உள்ளது. வெளியேறி, அதில் உள்நுழையவும்.',
  accBadOtp: 'தவறான அல்லது காலாவதியான குறியீடு. மீண்டும் முயலவும்.',
  accSlowDown: 'அதிக முயற்சிகள். ஒரு நிமிடம் கழித்து முயலவும்.',
  accFailed: 'உள்நுழைய முடியவில்லை. மீண்டும் முயலவும்.',
  accOffline: 'உள்நுழைய இணையத்துடன் இணைக்கவும்.'
});
Object.assign(T.hi, {
  accHaveTitle: 'पहले से खाता है?',
  accHaveHint: 'साइन इन करें, आपकी प्रोफ़ाइल, काम और वेतन पर्ची इस फ़ोन पर वापस आ जाएँगी।',
  accProtectTitle: 'अपना खाता सुरक्षित रखें',
  accProtectHint: 'Google या मोबाइल नंबर जोड़ें। फ़ोन बदलने पर साइन इन करके सब वापस पाएँ।',
  accSafeTitle: 'आपका खाता सुरक्षित है',
  accGoogle: 'Google से साइन इन करें',
  accLinkGoogle: 'इस खाते में Google जोड़ें',
  accOrPhone: 'या मोबाइल नंबर से',
  accOrPhoneLink: 'या मोबाइल नंबर जोड़ें',
  accSendOtp: 'OTP भेजें',
  accCodePh: (p) => `${p} पर आया 6 अंकों का कोड`,
  accVerify: 'जाँचें',
  accChangeNumber: 'नंबर बदलें',
  accOtpSent: (p) => `${p} पर OTP भेजा गया`,
  accDone: '✅ साइन इन हो गया। खाता सुरक्षित है।',
  accSignOut: 'साइन आउट',
  accSignOutAsk: 'इस फ़ोन पर साइन आउट करें? उसी Google या नंबर से फिर साइन इन करके सब वापस पाएँ।',
  accNotOn: 'यह साइन-इन विकल्प अभी तैयार किया जा रहा है। अभी "जारी रखें" इस्तेमाल करें; आपका खाता इसी फ़ोन पर रहेगा।',
  accSignInShort: 'साइन इन',
  accTaken: 'उस Google खाते या नंबर पर पहले से खाता है। साइन आउट करके उससे साइन इन करें।',
  accBadOtp: 'गलत या पुराना कोड। फिर कोशिश करें।',
  accSlowDown: 'बहुत ज़्यादा कोशिशें। एक मिनट बाद फिर करें।',
  accFailed: 'साइन इन नहीं हो सका। फिर कोशिश करें।',
  accOffline: 'साइन इन के लिए इंटरनेट से जुड़ें।'
});
