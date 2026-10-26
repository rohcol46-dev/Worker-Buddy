// Checks the country-pack helpers in js/countries.js (money and phone numbers). Run: node tests/countries.test.js
const fs = require('fs'); const vm = require('vm');
const ctx = { console, Intl, Number, String, Object, RegExp, document: { addEventListener() {}, querySelectorAll: () => [] },
  Store: { d: {}, get(k, f) { return k in this.d ? this.d[k] : f; }, set(k, v) { this.d[k] = v; } }, App: { lang: 'en' } };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(require('path').join(__dirname, '..', 'js', 'countries.js'), 'utf8') + ';this.r={money,moneySign,phoneIntl,phoneLocal,waHref,telHref,setMyCountry,Country};', ctx);
const r = ctx.r; const eq = (a, b) => { if (a !== b) { console.log('FAIL', JSON.stringify(a), '!=', JSON.stringify(b)); process.exitCode = 1; } };
eq(r.money(1500), '₹1,500'); eq(r.money(0), '₹0'); eq(r.money(12.5), '₹12.50'); eq(r.money(undefined), ''); eq(r.moneySign(), '₹');
eq(r.phoneIntl('98765 43210'), '+919876543210'); eq(r.phoneIntl('09876543210'), '+919876543210'); eq(r.phoneIntl('+91 98765 43210'), '+919876543210');
eq(r.phoneIntl('12345'), null); eq(r.phoneIntl('+254712345678'), '+254712345678');
eq(r.phoneLocal('+919876543210'), '9876543210'); eq(r.phoneLocal('9876543210'), '9876543210');
eq(r.waHref('9876543210', 'hi there'), 'https://wa.me/919876543210?text=hi%20there'); eq(r.telHref('+919876543210'), 'tel:+919876543210');
r.Country.list.KE = { code: 'KE', currency: 'KES', calling_code: '254', phone_pattern: '[17][0-9]{8}', phone_example: '712345678' };
r.setMyCountry('KE');
eq(r.money(1500).replace(/\s/g, ' '), 'Ksh 1,500'); eq(r.phoneIntl('0712 345 678'), '+254712345678'); eq(r.phoneIntl('9876543210'), null);
ctx.App.lang = 'ta'; r.setMyCountry('IN'); eq(r.money(1500), '₹1,500');
console.log(process.exitCode ? 'failed' : 'all ok');
