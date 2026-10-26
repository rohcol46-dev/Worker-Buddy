// report.js — when a script breaks on someone's phone, save a short note in the database
// (table client_errors) so the team can see and fix it. At most 5 different errors per page load.
(function () {
  const seen = new Set();
  function report(message, stack) {
    const key = String(message || 'error').slice(0, 300);
    if (seen.size >= 5 || seen.has(key) || typeof db === 'undefined' || !navigator.onLine) return;
    seen.add(key);
    db.rpc('log_client_error', {
      p_page: location.pathname.slice(0, 100),
      p_message: key,
      p_stack: String(stack || '').slice(0, 2000),
      p_agent: navigator.userAgent.slice(0, 300)
    }).then(() => {}, () => {});
  }
  window.addEventListener('error', (e) => report(e.message, e.error && e.error.stack));
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason || {};
    report(r.message || String(r), r.stack);
  });
})();
