// Country packs: the currency, phone format, time zone and languages of the country the app is used in.
// India is built in, so the app works offline on its first open. Other countries come from the
// database's countries table and are kept on the phone. The country comes from the person's profile.

const COUNTRY_INDIA = {
  code: 'IN', name: 'India', live: true, currency: 'INR', calling_code: '91',
  phone_pattern: '[6-9][0-9]{9}', phone_example: '9876543210',
  time_zone: 'Asia/Kolkata', emergency: '112', languages: ['en', 'ta', 'hi']
};

const Country = {
  list: Object.assign({ IN: COUNTRY_INDIA }, Store.get('countries', {})),
  code: Store.get('country', 'IN')
};

function myCountry() {
  return Country.list[Country.code] || COUNTRY_INDIA;
}

// Called when a profile loads; old profiles have no country and mean India
function setMyCountry(code) {
  if (!code || code === Country.code) return;
  Country.code = code;
  Store.set('country', code);
  if (!Country.list[code]) loadCountries(true);
  applyPhoneInputs();
  if (typeof accountHTML === 'function') document.querySelectorAll('.account-box:not([hidden])').forEach((box) => { box.innerHTML = accountHTML(); });
}

// The list rarely changes: fetched when missing or a day old
async function loadCountries(force) {
  if (typeof db === 'undefined') return;
  if (!force && Country.list[Country.code] && Date.now() - Store.get('countries_at', 0) < 86400000) return;
  const { data, error } = await db.from('countries').select('*');
  if (error || !data) return;
  data.forEach((c) => { Country.list[c.code] = c; });
  Store.set('countries', Country.list);
  Store.set('countries_at', Date.now());
  applyPhoneInputs();
}

// Language + country for dates and numbers, e.g. ta-IN or en-KE
function localeTag() {
  return `${App.lang}-${myCountry().code}`;
}

// Speech engines know few language-country pairs: English follows the country, Tamil and Hindi stay Indian
function speechTag() {
  return App.lang === 'en' ? localeTag() : ({ ta: 'ta-IN', hi: 'hi-IN' }[App.lang] || App.lang);
}

// ---------- Money ----------
const moneyFormats = {};

// 1500 -> "₹1,500" in India, "KSh 1,500" in Kenya. Whole amounts show no decimals.
function money(amount, currency) {
  const n = Number(amount);
  if (amount === null || amount === undefined || amount === '' || !Number.isFinite(n)) return '';
  const cur = currency || myCountry().currency;
  const whole = Number.isInteger(n);
  const key = `${localeTag()}|${cur}|${whole}`;
  if (!moneyFormats[key]) {
    try {
      moneyFormats[key] = new Intl.NumberFormat(localeTag(), {
        style: 'currency', currency: cur, currencyDisplay: 'narrowSymbol',
        minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2
      });
    } catch (e) {
      moneyFormats[key] = { format: (v) => `${cur} ${v}` };
    }
  }
  return moneyFormats[key].format(n);
}

// The currency sign alone, for input placeholders
function moneySign() {
  return money(0).replace(/[\d\s.,]/g, '') || myCountry().currency;
}

// ---------- Phone numbers ----------
// Stored as +<calling code><number>. Numbers saved before country packs are 10 digits and mean India.

// What the person typed -> +919876543210, or null when it is not a valid number in their country
function phoneIntl(raw, countryCode) {
  const c = Country.list[countryCode || Country.code];
  const text = String(raw || '').trim();
  let d = text.replace(/\D/g, '');
  if (!d) return null;
  // Pack not loaded yet (first open, offline): the database checks it with the right country
  if (!c) return (text.startsWith('+') ? '+' : '') + d;
  const national = new RegExp(`^(?:${c.phone_pattern})$`);
  if (text.startsWith('+') || text.startsWith('00')) {
    d = d.replace(/^00/, '');
    if (d.startsWith(c.calling_code)) return national.test(d.slice(c.calling_code.length)) ? '+' + d : null;
    return /^[1-9]\d{6,14}$/.test(d) ? '+' + d : null;
  }
  d = d.replace(/^0/, '');
  if (national.test(d)) return '+' + c.calling_code + d;
  if (d.startsWith(c.calling_code) && national.test(d.slice(c.calling_code.length))) return '+' + d;
  return null;
}

// A stored number in international form (old Indian numbers get +91)
function phoneStored(p) {
  if (!p) return '';
  const s = String(p);
  return s.startsWith('+') ? s : '+91' + s.replace(/\D/g, '');
}

// The number the way people write it at home, for form fields: +919876543210 -> 9876543210
function phoneLocal(p) {
  const s = phoneStored(p);
  const cc = '+' + myCountry().calling_code;
  return s.startsWith(cc) ? s.slice(cc.length) : s;
}

function telHref(p) {
  return 'tel:' + phoneStored(p);
}

function waHref(p, text) {
  const d = phoneStored(p).replace(/\D/g, '');
  return `https://wa.me/${d}` + (text ? `?text=${encodeURIComponent(text)}` : '');
}

// India's ambulance is 108; elsewhere the country's emergency number
function ambulanceLink() {
  const n = myCountry().code === 'IN' ? '108' : myCountry().emergency;
  return `<a class="btn btn-dark btn-block" href="tel:${n}">🚑 ${n}</a>`;
}

// Phone fields marked data-phone follow the country's format; emergency buttons call the country's number
function applyPhoneInputs() {
  const c = myCountry();
  document.querySelectorAll('a[data-emergency]').forEach((a) => {
    a.href = 'tel:' + c.emergency;
    a.querySelector('b').textContent = c.emergency;
  });
  document.querySelectorAll('[data-only-country]').forEach((el) => { el.hidden = el.dataset.onlyCountry !== c.code; });
  document.querySelectorAll('input[data-phone]').forEach((el) => {
    el.placeholder = c.phone_example;
    el.removeAttribute('pattern');
    el.maxLength = 20;
  });
}

document.addEventListener('DOMContentLoaded', () => {
  applyPhoneInputs();
  loadCountries();
});
