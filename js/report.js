// report.js — when a script breaks on someone's phone, save a short note in the database
// (table client_errors) so the team can see and fix it. At most 5 different errors per page load.
// Loaded right after config.js, so errors in the other scripts are caught too; notes wait until
// the database client (db, made in live.js) exists.
(function () {
  const seen = new Set();
  const waiting = [];
  function client() {
    try { return typeof db === 'undefined' ? null : db; } catch (e) { return null; } // db not made yet
  }
  function send() {
    const c = client();
    if (!c || !navigator.onLine) return;
    while (waiting.length) {
      c.rpc('log_client_error', waiting.shift()).then(() => {}, () => {});
    }
  }
  function report(message, stack) {
    const key = String(message || 'error').slice(0, 300);
    if (seen.size >= 5 || seen.has(key)) return;
    seen.add(key);
    waiting.push({
      p_page: location.pathname.slice(0, 100),
      p_message: key,
      p_stack: String(stack || '').slice(0, 2000),
      p_agent: navigator.userAgent.slice(0, 300)
    });
    send();
  }
  window.addEventListener('error', (e) => report(e.message, e.error && e.error.stack));
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason || {};
    report(r.message || String(r), r.stack);
  });
  window.addEventListener('load', send);
  window.addEventListener('online', send);
})();
