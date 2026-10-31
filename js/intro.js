// intro.js — Worker Buddy's opening, the first time on a phone: a pay slip prints line by line, a green PAID
// stamp thumps onto it, then the slip folds away into the logo with the tagline. About 3 seconds;
// a tap, any key or "Tap to skip" ends it, and it never plays when the phone asks for less motion.
// Also counts money up from zero when a big number first shows (.stats b). Look: css/app-look.css.
document.addEventListener('DOMContentLoaded', () => {
  const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!calm) countUpStats();

  // Only the very first time on this phone: a worker opens the app many times a day to check for
  // jobs, and 3 seconds each time adds up. (Before 2026-10-31 it played once per visit.)
  try {
    if (localStorage.getItem('wb_intro_seen') || sessionStorage.getItem('wb_intro')) return;
    localStorage.setItem('wb_intro_seen', '1');
    sessionStorage.setItem('wb_intro', '1');
  } catch (e) { return; } // storage blocked: don't risk playing it on every page
  if (calm) return;

  const logo = (document.querySelector('.brand-logo') || {}).textContent || '🤝';
  const el = document.createElement('div');
  el.className = 'intro';
  el.setAttribute('role', 'presentation');
  el.innerHTML = `
    <div class="intro-slip" aria-hidden="true">
      <h2>${t('introSlip')}</h2>
      <div class="intro-row"><span>${t('introWork')}</span><b>8 h</b></div>
      <div class="intro-row"><span>${t('introRate')}</span><b>${t('introFair')}</b></div>
      <div class="intro-row total"><span>${t('introTotal')}</span><b class="intro-amount">0</b></div>
      <div class="intro-stampbox"><span class="stamp-paid">${t('introPaid')}</span></div>
    </div>
    <div class="intro-brand">
      <span class="brand-logo" aria-hidden="true">${logo}</span>
      <h1>Worker Buddy</h1>
      <p>${t('tagline')}</p>
    </div>
    <button type="button" class="intro-skip">${t('introSkip')}</button>`;
  document.body.appendChild(el);

  const amount = el.querySelector('.intro-amount');
  const timers = [];
  const at = (ms, fn) => timers.push(setTimeout(fn, ms));
  at(800, () => countTo(amount, 800, 600, (n) => (typeof money === 'function' ? money(Math.round(n)) : '₹' + Math.round(n))));
  at(1500, () => el.classList.add('stamped'));
  at(2200, () => el.classList.add('fold'));

  let done = false;
  function finish() {
    if (done) return;
    done = true;
    timers.forEach(clearTimeout);
    document.removeEventListener('keydown', finish);
    el.classList.add('out');
    setTimeout(() => el.remove(), 400);
  }
  at(3400, finish);
  el.addEventListener('click', finish);
  document.addEventListener('keydown', finish);
});

// Counts the number inside el from 0 up to `to` over `ms`, easing out; fmt turns a number into text.
// Stops if something else writes into el meanwhile, so a fresh value from the app always wins.
function countTo(el, to, ms, fmt) {
  const start = performance.now();
  let mine = null;
  (function step(now) {
    if (mine !== null && el.textContent !== mine) return;
    const p = Math.min(1, (now - start) / ms);
    mine = el.textContent = fmt(to * (1 - Math.pow(1 - p, 3)));
    if (p < 1) requestAnimationFrame(step);
  })(start);
}

// Big numbers (earnings, jobs done) count up the first time the app sets them. Only the digits run;
// the currency sign and words stay exactly as the app wrote them, and the last frame is the app's text.
function countUpStats() {
  const seen = new WeakSet();
  const run = (b) => {
    const text = b.textContent;
    const m = text.match(/\d[\d,]*(\.\d+)?/);
    const to = m ? Number(m[0].replace(/,/g, '')) : 0;
    if (!(to > 0) || seen.has(b)) return;
    seen.add(b);
    const decimals = m[1] ? m[1].length - 1 : 0;
    const grouped = m[0].includes(',');
    b.classList.add('counting');
    countTo(b, to, 700, (v) => {
      if (v >= to) return text;
      const n = grouped ? v.toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
                        : v.toFixed(decimals);
      return text.replace(m[0], n);
    });
  };
  const watch = new MutationObserver((list) => list.forEach((r) => {
    const b = r.target.nodeType === 1 ? r.target : r.target.parentElement;
    if (b && b.matches && b.matches('.stats b')) run(b);
  }));
  document.querySelectorAll('.stats b').forEach((b) => watch.observe(b, { childList: true, characterData: true, subtree: true }));
}
