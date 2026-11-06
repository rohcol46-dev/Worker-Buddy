// push.js — job alerts that reach a worker's phone with the app closed (Web Push, supabase/034)
// Worker app: a card asks once; the phone's push address is then saved for this worker.
// Employer app: after a job is posted, asks the job-alert server function to alert nearby workers.
const Push = { busy: false, refreshed: false };

function pushReady() {
  return typeof PUSH_PUBLIC_KEY !== 'undefined' && !!PUSH_PUBLIC_KEY && window.isSecureContext &&
    'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

function pushKeyBytes() {
  const s = PUSH_PUBLIC_KEY.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(s + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
}

function sameKey(sub) {
  const k = sub.options && sub.options.applicationServerKey;
  if (!k) return true;
  const a = new Uint8Array(k), b = pushKeyBytes();
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

// Get (or make) this phone's push address and save it for my worker profile
async function pushSave(workerId) {
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub)) { await sub.unsubscribe(); sub = null; }   // the server key was changed
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: pushKeyBytes() });
  const j = sub.toJSON();
  const { error } = await db.rpc('save_push_subscription', {
    p_worker: workerId, p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_lang: App.lang
  });
  return !error;
}

// On start: alerts already allowed, so keep the saved address (and language) up to date
function refreshPush(workerId) {
  if (Push.refreshed || !pushReady() || Notification.permission !== 'granted' || !navigator.onLine) return;
  Push.refreshed = true;
  pushSave(workerId).catch(() => { Push.refreshed = false; });
}

// The worker taps "Turn on job alerts"
async function turnOnPush(workerId) {
  if (Push.busy || !pushReady()) return;
  if (!navigator.onLine) return showToast(t('offlineBanner'));
  Push.busy = true;
  try {
    const answer = await Notification.requestPermission();
    if (answer !== 'granted') showToast(t('pushBlocked'));
    else showToast((await pushSave(workerId)) ? t('pushOn') : t('pushFailed'));
  } catch (e) {
    showToast(t('pushFailed'));
  }
  Push.busy = false;
  renderPushCard(workerId);
}

// Shown on the worker's home until alerts are on
function renderPushCard(workerId) {
  const box = document.getElementById('pushCard');
  if (!box) return;
  if (!workerId || !pushReady() || Notification.permission === 'granted') { box.hidden = true; return; }
  box.innerHTML = Notification.permission === 'denied'
    ? `<p class="small muted">${t('pushBlocked')}</p>`
    : `<button class="btn btn-block" type="button" onclick="turnOnPush(W.me.id)">${t('pushOnBtn')}</button>
       <p class="small muted">${t('pushHint')}</p>`;
  box.hidden = false;
}

// Sign out: this phone stops getting alerts for the account
async function forgetPush() {
  if (!pushReady()) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg && await reg.pushManager.getSubscription();
    if (!sub) return;
    await db.rpc('delete_push_subscription', { p_endpoint: sub.endpoint });
    await sub.unsubscribe();
  } catch (e) { /* signing out still goes on */ }
}

// Employer: alert workers about jobs just posted (one alert per team job). Fire and forget.
function sendJobAlert(made) {
  if (typeof PUSH_PUBLIC_KEY === 'undefined' || !PUSH_PUBLIC_KEY || !navigator.onLine || !made || !made.length) return;
  const groups = new Set();
  const ids = made.filter((b) => {
    if (!b.group_id) return true;
    if (groups.has(b.group_id)) return false;
    groups.add(b.group_id);
    return true;
  }).map((b) => b.id).slice(0, 10);
  db.functions.invoke('job-alert', { body: { bookings: ids } }).catch(() => {});
}
