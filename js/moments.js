// moments.js — a short, quiet celebration at the big moments of a job, in the pay-slip style:
//   accepted → a handshake tile pops in a saffron ring     started → a clock ring draws round
//   done     → a tick draws                                paid    → a green PAID stamp thumps down,
//                                                                    the amount counts up, coins jump
// It shows for about 1.5 s over the screen, never blocks a tap (pointer-events: none), reads the line
// out to screen readers, buzzes once on Android, and is skipped when the phone asks for less motion.
// Also: pay slips "print" when they open and their amount counts up (see css/app-look.css).
const MOMENT_ICON = { accepted: '🤝', started: '⏱️', done: '✔️', paid: '' };

function moment(kind, line, amount) {
  const live = document.getElementById('momentSay') || Object.assign(document.body.appendChild(document.createElement('p')),
    { id: 'momentSay', className: 'sr-only' });
  live.setAttribute('role', 'status');
  live.textContent = line || '';
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (navigator.vibrate) try { navigator.vibrate(kind === 'paid' ? [30, 60, 30] : 25); } catch (e) { /* not allowed yet */ }

  document.querySelectorAll('.moment').forEach((m) => m.remove());
  const el = document.createElement('div');
  el.className = `moment moment-${kind}`;
  el.setAttribute('aria-hidden', 'true');
  const coins = kind === 'paid'
    ? Array.from({ length: 8 }, (_, i) => `<i class="coin" style="--a:${i * 45 + 20}deg;--d:${60 + (i % 3) * 18}px"></i>`).join('') : '';
  el.innerHTML = `
    <div class="moment-card">
      ${kind === 'paid'
        ? `<span class="stamp-paid">${t('introPaid')}</span>${amount ? `<b class="moment-amount">${money(0)}</b>` : ''}`
        : `<span class="moment-icon"><svg viewBox="0 0 44 44"><circle cx="22" cy="22" r="20"/></svg><em>${MOMENT_ICON[kind] || '✨'}</em></span>`}
      ${coins}
      <p>${esc(line || '')}</p>
    </div>`;
  document.body.appendChild(el);
  const amt = el.querySelector('.moment-amount');
  if (amt && typeof countTo === 'function') setTimeout(() => countTo(amt, amount, 550, (n) => money(Math.round(n))), 250);
  setTimeout(() => el.classList.add('out'), 1500);
  setTimeout(() => el.remove(), 1900);
}

// Pay slips: when one opens, its amount counts up from zero (the text ends exactly as the app wrote it)
document.addEventListener('DOMContentLoaded', () => {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || typeof countTo !== 'function') return;
  new MutationObserver((list) => list.forEach((r) => r.addedNodes.forEach((n) => {
    if (n.nodeType !== 1) return;
    n.querySelectorAll('.slip-amount').forEach((a) => {
      const text = a.textContent;
      const m = text.match(/\d[\d,]*(\.\d+)?/);
      const to = m ? Number(m[0].replace(/,/g, '')) : 0;
      if (!(to > 0)) return;
      const grouped = m[0].includes(',');
      const dec = m[1] ? m[1].length - 1 : 0;
      countTo(a, to, 650, (v) => (v >= to ? text : text.replace(m[0],
        grouped ? v.toLocaleString('en-IN', { minimumFractionDigits: dec, maximumFractionDigits: dec }) : v.toFixed(dec))));
    });
  }))).observe(document.body, { childList: true, subtree: true });
});
