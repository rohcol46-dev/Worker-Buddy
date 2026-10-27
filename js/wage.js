// wage.js — fair-wage engine (same rules as the backend's wage.js)
// Owner: Member 2. Gives an ESTIMATED range with a breakdown, never an exact rate.

// Same rules and rounding as legal_min_wage() and the bookings_fair_pay trigger (supabase/031).
// Every amount comes from the country's pay rules (js/countries.js).
function estimateWage(job) {
  const range = tradeRange(job.type);
  const hours = Number(job.hours) || 8;
  let min = range.min;
  let max = range.max;
  const parts = [{ label: t('base'), min, max }];

  // More than 8 hours: each extra hour at the overtime multiple of the hourly rate (twice in India, Code on Wages, 2019)
  if (hours > 8) {
    const extraMin = ceilMoney(((hours - 8) * min * payRule('overtime')) / 8);
    const extraMax = ceilMoney(((hours - 8) * max * payRule('overtime')) / 8);
    parts.push({ label: `${t('extraHours')} (${hours - 8})`, min: extraMin, max: extraMax });
    min += extraMin;
    max += extraMax;
  }

  // Less than 8 hours: pay by the hour, never below the shortest paid share of a day (half in India)
  if (hours < 8) {
    const share = Math.max(hours / 8, payRule('short_min'));
    const cutMin = ceilMoney(min * share) - min;
    const cutMax = ceilMoney(max * share) - max;
    parts.push({ label: t('shortShift'), min: cutMin, max: cutMax });
    min += cutMin;
    max += cutMax;
  }

  // Effort
  const loadExtra = loadExtraFor(job.load);
  if (loadExtra) {
    parts.push({ label: t('loadExtra'), min: loadExtra, max: loadExtra });
    min += loadExtra;
    max += loadExtra;
  }

  // Risky work: height, electrical, sewer
  if (job.risky) {
    const risky = payRule('risky');
    parts.push({ label: t('riskExtra'), min: risky, max: risky });
    min += risky;
    max += risky;
  }

  // Worker brings own tools
  if (job.tools) {
    const tools = payRule('tools');
    parts.push({ label: t('toolsExtra'), min: tools, max: tools });
    min += tools;
    max += tools;
  }

  // Night work (8 PM to 6 AM)
  if (job.night) {
    const nightMin = roundMoney(min * payRule('night'));
    const nightMax = roundMoney(max * payRule('night'));
    parts.push({ label: t('nightExtra'), min: nightMin, max: nightMax });
    min += nightMin;
    max += nightMax;
  }

  // Hot day (not at night)
  if (App.isHot && !job.night) {
    const heatMin = roundMoney(min * payRule('heat'));
    const heatMax = roundMoney(max * payRule('heat'));
    parts.push({ label: t('heatExtra'), min: heatMin, max: heatMax });
    min += heatMin;
    max += heatMax;
  }

  return { min: roundMoney(min), max: roundMoney(max), parts };
}

// Medium or heavy work, in the country's money (the person's, or a job's own country)
function loadExtraFor(load, country) {
  return { medium: payRule('load_medium', country), heavy: payRule('load_heavy', country) }[load] || 0;
}

// The single figure written into a work agreement: the middle of the range
function agreedWage(job) {
  const w = estimateWage(job);
  return roundMoney((w.min + w.max) / 2);
}

// "₹650 – ₹800" (in the local money) with each step listed underneath
function wageBoxHTML(wage) {
  const sign = (n) => (n >= 0 ? '+' : '−') + money(Math.abs(n));
  const lines = wage.parts.map((p, i) => {
    let amount;
    if (i === 0) amount = `${money(p.min)}–${money(p.max)}`;
    else if (p.min === p.max) amount = sign(p.min);
    else amount = `${sign(p.min)} / ${sign(p.max)}`;
    return `<li><span>${p.label}</span><span>${amount}</span></li>`;
  }).join('');
  return `<div class="wage-total">${money(wage.min)} – ${money(wage.max)}</div><ul class="wage-parts">${lines}</ul>`;
}
