// wage.js — fair-wage engine (same rules as the backend's wage.js)
// Owner: Member 2. Gives an ESTIMATED range with a breakdown, never an exact rate.

function roundTo10(n) {
  return Math.round(n / 10) * 10;
}

// Rounds up, so the bottom of a range never drops below the legal minimum
function ceilTo10(n) {
  return Math.ceil(n / 10) * 10;
}

// Same rules and rounding as legal_min_wage() and the bookings_fair_pay trigger in supabase/016
function estimateWage(job) {
  const work = WORK_TYPES[job.type] || WORK_TYPES.coolie;
  const hours = Number(job.hours) || 8;
  let min = Math.max(work.min, MIN_WAGE_DAY);
  let max = Math.max(work.max, min);
  const parts = [{ label: t('base'), min, max }];

  // More than 8 hours: each extra hour at twice the hourly rate (Code on Wages, 2019)
  if (hours > 8) {
    const extraMin = ceilTo10(((hours - 8) * min) / 4);
    const extraMax = ceilTo10(((hours - 8) * max) / 4);
    parts.push({ label: `${t('extraHours')} (${hours - 8})`, min: extraMin, max: extraMax });
    min += extraMin;
    max += extraMax;
  }

  // Less than 8 hours: pay by the hour, never below half a day
  if (hours < 8) {
    const share = Math.max(hours / 8, 0.5);
    const cutMin = ceilTo10(min * share) - min;
    const cutMax = ceilTo10(max * share) - max;
    parts.push({ label: t('shortShift'), min: cutMin, max: cutMax });
    min += cutMin;
    max += cutMax;
  }

  // Effort
  const loadExtra = { light: 0, medium: 50, heavy: 100 }[job.load] || 0;
  if (loadExtra) {
    parts.push({ label: t('loadExtra'), min: loadExtra, max: loadExtra });
    min += loadExtra;
    max += loadExtra;
  }

  // Risky work: height, electrical, sewer
  if (job.risky) {
    parts.push({ label: t('riskExtra'), min: 100, max: 100 });
    min += 100;
    max += 100;
  }

  // Worker brings own tools: +₹50
  if (job.tools) {
    parts.push({ label: t('toolsExtra'), min: 50, max: 50 });
    min += 50;
    max += 50;
  }

  // Night work (8 PM to 6 AM): +20%
  if (job.night) {
    const nightMin = roundTo10(min * 0.2);
    const nightMax = roundTo10(max * 0.2);
    parts.push({ label: t('nightExtra'), min: nightMin, max: nightMax });
    min += nightMin;
    max += nightMax;
  }

  // Hot day: +10% (not at night)
  if (App.isHot && !job.night) {
    const heatMin = roundTo10(min * 0.1);
    const heatMax = roundTo10(max * 0.1);
    parts.push({ label: t('heatExtra'), min: heatMin, max: heatMax });
    min += heatMin;
    max += heatMax;
  }

  return { min: roundTo10(min), max: roundTo10(max), parts };
}

// The single figure written into a work agreement: the middle of the range
function agreedWage(job) {
  const w = estimateWage(job);
  return roundTo10((w.min + w.max) / 2);
}

// "₹650 – ₹800" with each step listed underneath
function wageBoxHTML(wage) {
  const sign = (n) => (n >= 0 ? '+' : '−') + money(Math.abs(n));
  const lines = wage.parts.map((p, i) => {
    let amount;
    if (i === 0) amount = `${money(p.min)}–${p.max}`;
    else if (p.min === p.max) amount = sign(p.min);
    else amount = `${sign(p.min)} / ${sign(p.max)}`;
    return `<li><span>${p.label}</span><span>${amount}</span></li>`;
  }).join('');
  return `<div class="wage-total">${money(wage.min)} – ${money(wage.max)}</div><ul class="wage-parts">${lines}</ul>`;
}
