// more.js — ideas from more apps, shared by both apps:
//   counter-offers (inDrive), team booking (Porter "add helpers"),
//   rest points hosted by shops (Zomato rest points), zero commission (Namma Yatri)
// Load after extras.js. Owner: Member 3 (rest points), with Member 2 (offers, teams)

const MAX_TEAM = 5;

// ---------- Counter-offers (inDrive) ----------
// A worker may ask a little more, more, or the top of the fair range, never above it
function offerChoices(b) {
  const list = [b.agreed_wage + 50, b.agreed_wage + 100, b.wage_max]
    .filter((n) => n > b.agreed_wage && n <= b.wage_max);
  return [...new Set(list)].sort((x, y) => x - y);
}

async function loadOffers(bookingId) {
  const { data } = await db.from('offers').select('*').eq('booking_id', bookingId).eq('status', 'open').order('amount');
  const list = data || [];
  const ids = list.map((o) => o.worker_id);
  const { data: ws } = ids.length ? await db.from('workers_public').select('*').in('id', ids) : { data: [] };
  list.forEach((o) => { o.worker = (ws || []).find((w) => w.id === o.worker_id) || {}; });
  return list;
}

function listenOffers(onChange) {
  db.channel('offers-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'offers' }, (p) => onChange(p.new || {}))
    .subscribe();
}

// ---------- Rest points hosted by shops and employers (Zomato rest points) ----------
const AMENITIES = { water: '💧', shade: '⛱️', toilet: '🚻', charging: '🔌' };
REST_ICONS.host = '🤝';

function amenityIcons(r) {
  return Object.keys(AMENITIES).filter((k) => r[k]).map((k) => AMENITIES[k]).join(' ');
}

async function loadHostPoints() {
  if (!navigator.onLine) return;
  const { data } = await db.from('rest_points').select('*').limit(300);
  if (!data) return;
  HOST_POINTS = data.map((r) => ({
    kind: 'host', name: `${r.name} · ${amenityIcons(r)}`, lat: r.lat, lng: r.lng, employer_id: r.employer_id
  }));
  Store.set('hostPoints', HOST_POINTS);
  if (typeof refreshPlacesOnMap === 'function') refreshPlacesOnMap();
  renderRestList();
}

function hostsRestPoint(employerId) {
  return HOST_POINTS.some((p) => p.employer_id === employerId);
}

// ---------- Text ----------
Object.assign(T.en, {
  host: 'Worker Buddy rest point',
  askMore: 'Ask for more:',
  offerSent: (n) => `Offer of ₹${n} sent. The employer will decide.`,
  offerAccepted: (n) => `Your offer of ₹${n} was accepted! 🎉`,
  offersTitle: 'Offers from workers',
  offerHint: 'Workers can ask for a little more, up to the top of the fair range. You choose.',
  acceptOffer: (n) => `Accept ₹${n}`,
  offerGone: 'That worker just took another job. Pick another offer.',
  teamSize: 'Workers needed',
  bookTeam: (n, w) => `Book ${n} workers · ₹${w} total`,
  teamOf: (n, type) => `Team of ${n} · ${type}`,
  teamFilled: (a, n) => `${a} of ${n} workers found`,
  teamJob: (n) => `👥 Team job · ${n} workers`,
  slotFinding: 'Finding a worker…',
  slotEmpty: 'Not filled',
  teamTotal: 'Team total',
  payOne: (n) => `Pay ₹${n}`,
  cancelUnfilled: 'Stop searching for the rest',
  restHostTitle: '🏪 Be a rest point for workers',
  restHostHint: 'Let workers use your water, shade, toilet or phone charging. Your shop shows on every worker’s map, and workers see “Hosts a rest point” on your job requests.',
  shopName: 'Shop or place name',
  giveWater: '💧 Drinking water',
  giveShade: '⛱️ Shade / place to sit',
  giveToilet: '🚻 Toilet',
  giveCharging: '🔌 Phone charging',
  saveRestPoint: '📍 Save at my location',
  restPointLive: 'Your rest point is on the workers’ map',
  removeRestPoint: 'Remove',
  pickOneAmenity: 'Tick at least one thing you can give',
  hostsRest: '🤝 Hosts a rest point for workers',
  zeroCommission: '💯 0% commission: you keep everything you earn',
  commissionLabel: 'Worker Buddy commission',
  commissionValue: '₹0 (worker keeps 100%)'
});

Object.assign(T.ta, {
  host: 'Worker Buddy ஓய்வு இடம்',
  askMore: 'கூடுதலாகக் கேள்:',
  offerSent: (n) => `₹${n} கோரிக்கை அனுப்பப்பட்டது. முதலாளி முடிவு செய்வார்.`,
  offerAccepted: (n) => `உங்கள் ₹${n} கோரிக்கை ஏற்கப்பட்டது! 🎉`,
  offersTitle: 'வேலையாட்களின் கோரிக்கைகள்',
  offerHint: 'நியாயமான வரம்புக்குள் வேலையாட்கள் கொஞ்சம் கூடுதலாகக் கேட்கலாம். நீங்கள் தேர்வு செய்யுங்கள்.',
  acceptOffer: (n) => `₹${n} ஏற்கவும்`,
  offerGone: 'அந்த வேலையாள் வேறு வேலை எடுத்துவிட்டார். வேறு கோரிக்கையைத் தேர்வு செய்யுங்கள்.',
  teamSize: 'தேவையான வேலையாட்கள்',
  bookTeam: (n, w) => `${n} வேலையாட்களை புக் செய் · மொத்தம் ₹${w}`,
  teamOf: (n, type) => `${n} பேர் குழு · ${type}`,
  teamFilled: (a, n) => `${n} இல் ${a} வேலையாட்கள் கிடைத்தனர்`,
  teamJob: (n) => `👥 குழு வேலை · ${n} பேர்`,
  slotFinding: 'வேலையாளைத் தேடுகிறது…',
  slotEmpty: 'யாரும் இல்லை',
  teamTotal: 'குழு மொத்தம்',
  payOne: (n) => `₹${n} கொடு`,
  cancelUnfilled: 'மீதியைத் தேடுவதை நிறுத்து',
  restHostTitle: '🏪 வேலையாட்களுக்கு ஓய்வு இடமாக இருங்கள்',
  restHostHint: 'உங்கள் தண்ணீர், நிழல், கழிவறை அல்லது சார்ஜிங்கை வேலையாட்கள் பயன்படுத்தட்டும். உங்கள் கடை எல்லா வேலையாட்களின் வரைபடத்திலும் தெரியும்; உங்கள் வேலைக் கோரிக்கைகளில் “ஓய்வு இடம் தருகிறார்” என்று தெரியும்.',
  shopName: 'கடை அல்லது இடத்தின் பெயர்',
  giveWater: '💧 குடிநீர்',
  giveShade: '⛱️ நிழல் / உட்கார இடம்',
  giveToilet: '🚻 கழிவறை',
  giveCharging: '🔌 போன் சார்ஜிங்',
  saveRestPoint: '📍 என் இடத்தில் சேமி',
  restPointLive: 'உங்கள் ஓய்வு இடம் வேலையாட்களின் வரைபடத்தில் உள்ளது',
  removeRestPoint: 'நீக்கு',
  pickOneAmenity: 'நீங்கள் தரக்கூடிய ஒன்றையாவது தேர்வு செய்யுங்கள்',
  hostsRest: '🤝 வேலையாட்களுக்கு ஓய்வு இடம் தருகிறார்',
  zeroCommission: '💯 0% கமிஷன்: நீங்கள் சம்பாதிப்பது முழுவதும் உங்களுக்கே',
  commissionLabel: 'Worker Buddy கமிஷன்',
  commissionValue: '₹0 (வேலையாளுக்கு 100%)'
});

Object.assign(T.hi, {
  host: 'Worker Buddy आराम की जगह',
  askMore: 'ज़्यादा माँगें:',
  offerSent: (n) => `₹${n} की माँग भेज दी। मालिक तय करेंगे।`,
  offerAccepted: (n) => `आपकी ₹${n} की माँग मान ली गई! 🎉`,
  offersTitle: 'मज़दूरों की माँगें',
  offerHint: 'मज़दूर सही मज़दूरी की सीमा तक थोड़ा ज़्यादा माँग सकते हैं। आप चुनें।',
  acceptOffer: (n) => `₹${n} मानें`,
  offerGone: 'वह मज़दूर दूसरा काम ले चुका है। दूसरी माँग चुनें।',
  teamSize: 'कितने मज़दूर चाहिए',
  bookTeam: (n, w) => `${n} मज़दूर बुक करें · कुल ₹${w}`,
  teamOf: (n, type) => `${n} लोगों की टीम · ${type}`,
  teamFilled: (a, n) => `${n} में से ${a} मज़दूर मिले`,
  teamJob: (n) => `👥 टीम का काम · ${n} मज़दूर`,
  slotFinding: 'मज़दूर ढूँढ रहे हैं…',
  slotEmpty: 'कोई नहीं मिला',
  teamTotal: 'टीम का कुल',
  payOne: (n) => `₹${n} दें`,
  cancelUnfilled: 'बाकी को ढूँढना बंद करें',
  restHostTitle: '🏪 मज़दूरों के लिए आराम की जगह बनें',
  restHostHint: 'मज़दूरों को अपना पानी, छाया, शौचालय या फ़ोन चार्जिंग इस्तेमाल करने दें। आपकी दुकान हर मज़दूर के नक्शे पर दिखेगी, और आपके काम के अनुरोध पर “आराम की जगह देते हैं” दिखेगा।',
  shopName: 'दुकान या जगह का नाम',
  giveWater: '💧 पीने का पानी',
  giveShade: '⛱️ छाया / बैठने की जगह',
  giveToilet: '🚻 शौचालय',
  giveCharging: '🔌 फ़ोन चार्जिंग',
  saveRestPoint: '📍 मेरी जगह पर सेव करें',
  restPointLive: 'आपकी आराम की जगह मज़दूरों के नक्शे पर है',
  removeRestPoint: 'हटाएँ',
  pickOneAmenity: 'कम से कम एक चीज़ चुनें जो आप दे सकते हैं',
  hostsRest: '🤝 मज़दूरों को आराम की जगह देते हैं',
  zeroCommission: '💯 0% कमीशन: आपकी पूरी कमाई आपकी',
  commissionLabel: 'Worker Buddy कमीशन',
  commissionValue: '₹0 (मज़दूर को 100%)'
});
