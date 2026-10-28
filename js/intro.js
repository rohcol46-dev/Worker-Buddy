// intro.js — the opening animation, once per visit: a worker walks the route stop to stop, the day's
// 8 hours fill up as paid, then "Worker Buddy" rises with "One worker. One job. Fair pay."
// About 3.6 seconds; a tap, any key or the "Tap to skip" button ends it. Skipped when the phone asks
// for less motion. The look lives in css/app-look.css (.intro).
document.addEventListener('DOMContentLoaded', () => {
  try {
    if (sessionStorage.getItem('wb_intro')) return;
    sessionStorage.setItem('wb_intro', '1');
  } catch (e) { return; } // storage blocked: don't risk playing it on every page
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const STOPS = [0, 33.3, 66.6, 100];
  const HOURS = 8;
  const TOTAL = 3600;
  const el = document.createElement('div');
  el.className = 'intro';
  el.setAttribute('role', 'presentation');
  el.innerHTML = `
    <div class="intro-stage">
      <p class="intro-eyebrow">${t('introEyebrow')}</p>
      <div class="intro-route">
        ${STOPS.map((x, i) => `<span class="intro-stop" style="left:${x}%;animation-delay:${0.25 + i * 0.1}s"></span>`).join('')}
        <span class="intro-walker" aria-hidden="true">👷</span>
      </div>
      <div class="intro-hours" aria-hidden="true">${'<i></i>'.repeat(HOURS)}</div>
      <p class="intro-count"><b>0</b> ${t('introHours')}</p>
      <div class="intro-title"><h1>Worker Buddy</h1></div>
      <p class="intro-tag"><span>${t('introLine1')}</span><span>${t('introLine2')}</span><span>${t('introLine3')}</span></p>
    </div>
    <button type="button" class="intro-skip">${t('introSkip')}</button>
    <span class="intro-bar"></span>`;
  document.body.appendChild(el);

  const $ = (s) => el.querySelector(s);
  const $$ = (s) => el.querySelectorAll(s);
  const stops = $$('.intro-stop');
  const walker = $('.intro-walker');
  const cells = $$('.intro-hours i');
  const count = $('.intro-count b');
  const tags = $$('.intro-tag span');
  const timers = [];
  const at = (ms, fn) => timers.push(setTimeout(fn, ms));

  stops[0].classList.add('on');
  STOPS.slice(1).forEach((x, i) => at(700 + i * 450, () => {
    walker.style.left = x + '%';
    at(420, () => stops[i + 1].classList.add('on'));
  }));
  cells.forEach((c, i) => at(700 + i * 150, () => { c.classList.add('on'); count.textContent = i + 1; }));
  at(2000, () => el.classList.add('title-in'));
  tags.forEach((s, i) => at(2350 + i * 200, () => s.classList.add('on')));

  const bar = $('.intro-bar');
  requestAnimationFrame(() => {
    bar.style.transition = `transform ${TOTAL}ms linear`;
    bar.style.transform = 'scaleX(1)';
  });

  let done = false;
  function finish() {
    if (done) return;
    done = true;
    timers.forEach(clearTimeout);
    document.removeEventListener('keydown', finish);
    el.classList.add('out');
    setTimeout(() => el.remove(), 450);
  }
  at(TOTAL, finish);
  el.addEventListener('click', finish);
  document.addEventListener('keydown', finish);
});
