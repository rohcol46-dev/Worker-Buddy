// Checks the country-pack helpers in js/countries.js (money, phone numbers, pay rules) and the wage estimate in js/wage.js. Run: node tests/countries.test.js
const fs = require('fs'); const vm = require('vm');
const ctx = { console, Intl, Number, String, Object, RegExp, Math, t: (k) => k, WORK_TYPES: { coolie: {}, plumber: {}, mason: {} }, document: { addEventListener() {}, querySelectorAll: () => [] },
  Store: { d: {}, get(k, f) { return k in this.d ? this.d[k] : f; }, set(k, v) { this.d[k] = v; } }, App: { lang: 'en' } };
vm.createContext(ctx);
const src = (f) => fs.readFileSync(require('path').join(__dirname, '..', 'js', f), 'utf8');
vm.runInContext(src('countries.js') + ';' + src('wage.js') +
  ';this.r={money,moneySign,phoneIntl,phoneLocal,waHref,telHref,setMyCountry,Country,estimateWage,tradeRange,minWageDay,payRule};', ctx);
const r = ctx.r; const eq = (a, b) => { if (a !== b) { console.log('FAIL', JSON.stringify(a), '!=', JSON.stringify(b)); process.exitCode = 1; } };
eq(r.money(1500), '₹1,500'); eq(r.money(0), '₹0'); eq(r.money(12.5), '₹12.50'); eq(r.money(undefined), ''); eq(r.moneySign(), '₹');
eq(r.phoneIntl('98765 43210'), '+919876543210'); eq(r.phoneIntl('09876543210'), '+919876543210'); eq(r.phoneIntl('+91 98765 43210'), '+919876543210');
eq(r.phoneIntl('12345'), null); eq(r.phoneIntl('+254712345678'), '+254712345678');
eq(r.phoneLocal('+919876543210'), '9876543210'); eq(r.phoneLocal('9876543210'), '9876543210');
eq(r.waHref('9876543210', 'hi there'), 'https://wa.me/919876543210?text=hi%20there'); eq(r.telHref('+919876543210'), 'tel:+919876543210');
// India's wage estimate is what it was before pay rules moved into the country pack
const est = (job) => { const w = r.estimateWage(job); return `${w.min}-${w.max}`; };
eq(est({ type: 'plumber', hours: 8, load: 'light' }), '700-1000');
eq(est({ type: 'plumber', hours: 10, load: 'light' }), '1050-1500');
eq(est({ type: 'plumber', hours: 3, load: 'light' }), '350-500');
eq(est({ type: 'mason', hours: 8, load: 'heavy', risky: true, tools: true }), '1000-1250');
eq(est({ type: 'coolie', hours: 8, load: 'light', night: true }), '730-840');
eq(r.minWageDay(), 610); eq(r.payRule('showup'), 100);
r.Country.list.KE = { code: 'KE', currency: 'KES', calling_code: '254', phone_pattern: '[17][0-9]{8}', phone_example: '712345678',
  pay_rules: { round: 10, overtime: 1.5, short_min: 0.5, showup: 200, tools: 100, load_medium: 100, load_heavy: 200, risky: 200,
    travel_free_km: 5, travel_base: 100, travel_per_km: 20, travel_max: 300, night: 0.2, heat: 0.1 },
  min_wages: ['coolie', 'helper', 'plumber', 'electrician', 'mason', 'painter'].map((type) => ({ type, day_rate: 400, est_min: 450, est_max: 700 })) };
r.setMyCountry('KE');
eq(r.money(1500).replace(/\s/g, ' '), 'Ksh 1,500');
eq(est({ type: 'plumber', hours: 10, load: 'light' }), '620-970'); eq(est({ type: 'plumber', hours: 8, load: 'heavy', risky: true }), '850-1100');
eq(r.payRule('showup'), 200); eq(r.minWageDay(), 400); eq(r.phoneIntl('0712 345 678'), '+254712345678'); eq(r.phoneIntl('9876543210'), null);
ctx.App.lang = 'ta'; r.setMyCountry('IN'); eq(r.money(1500), '₹1,500');
console.log(process.exitCode ? 'failed' : 'all ok');
