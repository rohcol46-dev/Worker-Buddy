// data.js — saving on the phone, sample data, schemes and translations
// Owner: Member 4 (lead). Every other file uses what is defined here.

// ---------- Saving on the phone (localStorage) ----------
// Data stays in this phone's browser, so the demo needs no server or database.
const Store = {
  get(key, fallback) {
    try {
      const value = localStorage.getItem('wb_' + key);
      return value === null ? fallback : JSON.parse(value);
    } catch (e) {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem('wb_' + key, JSON.stringify(value));
    } catch (e) {
      // Private mode or storage blocked: the app still works, it just won't remember.
    }
  },
  clear() {
    try {
      Object.keys(localStorage).filter((k) => k.startsWith('wb_')).forEach((k) => localStorage.removeItem(k));
    } catch (e) { /* nothing to clear */ }
  }
};

// Makes typed text safe to put inside HTML
function esc(text) {
  const div = document.createElement('div');
  div.textContent = text == null ? '' : String(text);
  return div.innerHTML;
}

function dayFromToday(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ---------- Work types ----------
// Legal floor for an 8-hour day: Tamil Nadu minimum wage, "construction or maintenance of roads and
// buildings": ₹606.60 to Mar 2026, VDA from 1 Apr 2026 per notification Z3/3459/2026 (₹609.30 reported),
// rounded up. No per-trade figure could be confirmed, so it is the floor for every kind of work. The same
// number is in the min_wages table (supabase/016_private_data_and_fair_pay.sql): change both together.
const MIN_WAGE_DAY = 610;

// Base daily wage range in ₹ for 8 hours. ESTIMATES, never below MIN_WAGE_DAY.
const WORK_TYPES = {
  coolie:      { icon: '🧱', min: 610, max: 700 },
  helper:      { icon: '🦺', min: 610, max: 650 },
  plumber:     { icon: '🔧', min: 700, max: 1000 },
  electrician: { icon: '⚡', min: 800, max: 1100 },
  mason:       { icon: '🏗️', min: 750, max: 1000 },
  painter:     { icon: '🎨', min: 650, max: 900 }
};

// Safety gear the employer should provide, per work type
const GEAR = {
  coolie: ['gloves', 'safetyShoes'],
  helper: ['gloves', 'safetyShoes'],
  plumber: ['gloves', 'goggles'],
  electrician: ['rubberGloves', 'insulatedTools'],
  mason: ['helmet', 'gloves', 'safetyShoes'],
  painter: ['mask', 'harness']
};

// ---------- Places (Chennai demo). Change to your own city. ----------
const WORK_SITE = { lat: 13.0067, lng: 80.2206 }; // Guindy

// Localities offered while typing. Anything else typed (a street, a building, a landmark)
// is looked up on OpenStreetMap, and the employer can also tap the map for the exact spot.
const AREAS = {
  // South
  'Guindy': [13.0067, 80.2206], 'Guindy Industrial Estate': [13.0108, 80.2128], 'Little Mount': [13.0153, 80.2240],
  'Saidapet': [13.0213, 80.2231], 'Saidapet West': [13.0236, 80.2154], 'Jafferkhanpet': [13.0297, 80.2072],
  'West Mambalam': [13.0383, 80.2209], 'K.K. Nagar': [13.0410, 80.1990], 'M.G.R. Nagar': [13.0370, 80.1855],
  'Ashok Nagar': [13.0350, 80.2120], 'Kodambakkam': [13.0521, 80.2255], 'Vadapalani': [13.0500, 80.2121],
  'Virugambakkam': [13.0532, 80.1947], 'Saligramam': [13.0545, 80.2022], 'Valasaravakkam': [13.0405, 80.1723],
  'Porur': [13.0382, 80.1565], 'Ramapuram': [13.0317, 80.1817], 'Nesapakkam': [13.0381, 80.1913],
  'Alandur': [13.0035, 80.2006], 'St. Thomas Mount': [12.9951, 80.1960], 'Nanganallur': [12.9806, 80.1883],
  'Adambakkam': [12.9886, 80.2045], 'Meenambakkam': [12.9872, 80.1767], 'Pallavaram': [12.9675, 80.1491],
  'Chromepet': [12.9516, 80.1462], 'Tambaram': [12.9249, 80.1000], 'East Tambaram': [12.9246, 80.1311],
  'Selaiyur': [12.9171, 80.1393], 'Medavakkam': [12.9171, 80.1923], 'Madipakkam': [12.9647, 80.1961],
  'Keelkattalai': [12.9572, 80.1866], 'Pallikaranai': [12.9349, 80.2137], 'Velachery': [12.9791, 80.2209],
  'Velachery Vijayanagar': [12.9756, 80.2162], 'Taramani': [12.9863, 80.2432], 'Kotturpuram': [13.0187, 80.2427],
  'Adyar': [13.0012, 80.2565], 'Gandhi Nagar (Adyar)': [13.0056, 80.2560], 'Kasturba Nagar (Adyar)': [13.0003, 80.2509],
  'Indira Nagar (Adyar)': [12.9935, 80.2537], 'Shastri Nagar (Adyar)': [12.9996, 80.2640], 'Besant Nagar': [12.9990, 80.2668],
  'Thiruvanmiyur': [12.9830, 80.2594], 'Kottivakkam': [12.9680, 80.2590], 'Palavakkam': [12.9585, 80.2570],
  'Neelankarai': [12.9488, 80.2585], 'Injambakkam': [12.9170, 80.2490], 'Perungudi': [12.9654, 80.2461],
  'Thoraipakkam': [12.9400, 80.2340], 'Karapakkam': [12.9180, 80.2290], 'Sholinganallur': [12.9010, 80.2279],
  'Semmancheri': [12.8735, 80.2245], 'Navalur': [12.8459, 80.2265], 'Siruseri': [12.8256, 80.2200],
  'Kelambakkam': [12.7880, 80.2190],
  // Central
  'T. Nagar': [13.0418, 80.2341], 'Pondy Bazaar': [13.0410, 80.2399], 'Nandanam': [13.0300, 80.2400],
  'Teynampet': [13.0450, 80.2510], 'Alwarpet': [13.0337, 80.2539], 'Mylapore': [13.0339, 80.2697],
  'Mandaveli': [13.0272, 80.2618], 'R.A. Puram': [13.0263, 80.2543], 'Santhome': [13.0330, 80.2787],
  'Royapettah': [13.0540, 80.2640], 'Gopalapuram': [13.0500, 80.2560], 'Thousand Lights': [13.0580, 80.2530],
  'Nungambakkam': [13.0569, 80.2425], 'Chetpet': [13.0720, 80.2410], 'Egmore': [13.0732, 80.2609],
  'Triplicane': [13.0587, 80.2756], 'Chintadripet': [13.0730, 80.2720], 'Mount Road (Anna Salai)': [13.0600, 80.2630],
  'Park Town': [13.0780, 80.2730], 'George Town': [13.0915, 80.2865], 'Parrys': [13.0900, 80.2880],
  'Sowcarpet': [13.0930, 80.2800], 'Vepery': [13.0840, 80.2600], 'Purasawalkam': [13.0880, 80.2550],
  'Kilpauk': [13.0827, 80.2420], 'Aminjikarai': [13.0730, 80.2240], 'Shenoy Nagar': [13.0780, 80.2290],
  'Anna Nagar': [13.0850, 80.2101], 'Anna Nagar West': [13.0890, 80.2000], 'Anna Nagar East': [13.0870, 80.2210],
  'Arumbakkam': [13.0720, 80.2100], 'Choolaimedu': [13.0640, 80.2270], 'Vadapalani Bus Depot': [13.0520, 80.2120],
  'Koyambedu': [13.0694, 80.1948], 'Koyambedu Market': [13.0726, 80.1943], 'Maduravoyal': [13.0650, 80.1700],
  'Thirumangalam': [13.0850, 80.1990], 'Mogappair': [13.0840, 80.1750], 'Mogappair West': [13.0870, 80.1650],
  // North and west
  'Perambur': [13.1180, 80.2330], 'Kolathur': [13.1240, 80.2120], 'Villivakkam': [13.1080, 80.2090],
  'Padi': [13.0980, 80.1880], 'Ambattur': [13.1143, 80.1548], 'Ambattur Industrial Estate': [13.0990, 80.1640],
  'Avadi': [13.1147, 80.1018], 'Thirumullaivoyal': [13.1290, 80.1350], 'Korattur': [13.1080, 80.1840],
  'Madhavaram': [13.1480, 80.2310], 'Kodungaiyur': [13.1370, 80.2470], 'Vyasarpadi': [13.1170, 80.2560],
  'Tondiarpet': [13.1260, 80.2880], 'Royapuram': [13.1137, 80.2954], 'Washermanpet': [13.1140, 80.2850],
  'Tiruvottiyur': [13.1600, 80.3000], 'Ennore': [13.2140, 80.3200], 'Manali': [13.1660, 80.2600],
  'Red Hills': [13.1950, 80.1850], 'Puzhal': [13.1600, 80.2050],
  'Poonamallee': [13.0473, 80.0945], 'Iyyappanthangal': [13.0390, 80.1360], 'Mangadu': [13.0270, 80.1100],
  'Kundrathur': [12.9970, 80.0970], 'Vanagaram': [13.0590, 80.1520], 'Thiruverkadu': [13.0730, 80.1260],
  'Perungalathur': [12.9050, 80.0900], 'Vandalur': [12.8920, 80.0810], 'Guduvanchery': [12.8450, 80.0600]
};

// Rest points placed by hand near the work site. Replace with real spots you know.
const REST_POINTS = [
  { kind: 'shade',  name: 'Bus stand shelter',              lat: 13.0089, lng: 80.2122 },
  { kind: 'shade',  name: 'Tree shade near park',           lat: 13.0046, lng: 80.2245 },
  { kind: 'water',  name: 'Public drinking water',          lat: 13.0075, lng: 80.2190 },
  { kind: 'water',  name: 'Temple water tap',               lat: 13.0112, lng: 80.2231 },
  { kind: 'tea',    name: 'Tea stall (free water partner)', lat: 13.0058, lng: 80.2178 },
  { kind: 'tea',    name: 'Mess and tea shop',              lat: 13.0101, lng: 80.2168 },
  { kind: 'toilet', name: 'Public toilet',                  lat: 13.0032, lng: 80.2201 },
  { kind: 'toilet', name: 'Market toilet',                  lat: 13.0120, lng: 80.2195 }
];
const REST_ICONS = { shade: '🌳', water: '🚰', tea: '☕', toilet: '🚻' };

// ---------- Government welfare schemes ----------
// Simplified eligibility. Workers should confirm on the official website.
const SCHEMES = [
  {
    icon: '🪪', name: 'e-Shram card', link: 'https://eshram.gov.in',
    eligible: (a) => a.age >= 16 && a.age <= 59 && a.unorganised,
    text: {
      en: 'Free registration for unorganised workers. You get a UAN card and access to welfare schemes.',
      ta: 'அமைப்புசாரா தொழிலாளர்களுக்கு இலவச பதிவு. UAN அட்டை மற்றும் நலத்திட்டங்கள் பெறலாம்.'
    }
  },
  {
    icon: '👴', name: 'PM-SYM pension', link: 'https://maandhan.in',
    eligible: (a) => a.age >= 18 && a.age <= 40 && a.unorganised && a.lowIncome,
    text: {
      en: '₹3,000 a month pension after age 60. You pay a small monthly amount and the government adds the same.',
      ta: '60 வயதுக்குப் பின் மாதம் ₹3,000 ஓய்வூதியம். நீங்கள் செலுத்தும் சிறு தொகைக்கு இணையாக அரசும் செலுத்தும்.'
    }
  },
  {
    icon: '🩹', name: 'PMSBY accident insurance', link: 'https://jansuraksha.gov.in',
    eligible: (a) => a.age >= 18 && a.age <= 70 && a.bank,
    text: {
      en: 'Accident cover of ₹2 lakh for ₹20 a year, taken from your bank account.',
      ta: 'ஆண்டுக்கு ₹20-க்கு ₹2 லட்சம் விபத்துக் காப்பீடு, வங்கிக் கணக்கிலிருந்து எடுக்கப்படும்.'
    }
  },
  {
    icon: '🛡️', name: 'PMJJBY life insurance', link: 'https://jansuraksha.gov.in',
    eligible: (a) => a.age >= 18 && a.age <= 50 && a.bank,
    text: {
      en: 'Life cover of ₹2 lakh for ₹436 a year, taken from your bank account.',
      ta: 'ஆண்டுக்கு ₹436-க்கு ₹2 லட்சம் ஆயுள் காப்பீடு, வங்கிக் கணக்கிலிருந்து எடுக்கப்படும்.'
    }
  },
  {
    icon: '🏥', name: 'Ayushman Bharat (PM-JAY)', link: 'https://pmjay.gov.in',
    eligible: (a) => a.unorganised || a.lowIncome,
    text: {
      en: 'Free hospital treatment up to ₹5 lakh per family per year, if your family is on the list. Check on the website.',
      ta: 'பட்டியலில் உள்ள குடும்பத்துக்கு ஆண்டுக்கு ₹5 லட்சம் வரை இலவச மருத்துவம். இணையதளத்தில் சரிபார்க்கவும்.'
    }
  }
];

// ---------- Shared app state ----------
const App = {
  lang: Store.get('lang', 'en'),
  here: { ...WORK_SITE },   // worker's location (Guindy until "Use my location")
  temp: null,               // "feels like" temperature
  isHot: false,             // adds heat pay and shows the warning
  simulateHot: false        // demo switch on the Safety screen
};

// ---------- Translations ----------
// Every on-screen text comes from here. Ask a Tamil-speaking teammate to check the Tamil lines.
const T = {
  en: {
    langBtn: 'தமிழ்',
    appWorker: 'Worker app',
    appEmployer: 'Employer app',
    chooseApp: 'Choose your app',
    workerAppDesc: 'Get jobs nearby or from WhatsApp, hear them read aloud, start with an OTP, and get a pay slip.',
    employerAppDesc: 'Post a job at a fair rate, share it on WhatsApp, and nearby workers get it instantly.',
    howItWorks: 'How it works',
    flow1: 'Post job: type of work, place and hours',
    flow2: 'Fair rate calculated and shown before anyone accepts',
    flow3: 'Shared on WhatsApp, and nearby workers’ phones ring',
    flow4: 'Worker accepts and starts with an OTP',
    flow5: 'Work with heat alerts, water breaks and overtime',
    flow6: 'Employer pays, worker confirms: pay slip and rating',
    wageMapLink: '🗺️ Wage map: what people are paid near you',
    openApp: 'Open',
    demoSideBySide: 'Live demo: open the Worker app on one phone and the Employer app on another. A booking rings on the worker’s phone within a second.',
    yourProfile: 'Your name, skill and WhatsApp number (employers see this)',
    workerNamePh: 'Your name',
    mainSkill: 'Main skill',
    justNow: 'Free now',
    navWorkers: 'Workers',
    navMyJobs: 'My jobs',
    workersTitle: 'Workers free today near you',
    tagline: 'Fair pay, safe work and the next job, one tap away.',
    needWork: 'I need work',
    needWorker: 'I need a worker',
    featWage: 'Fair wage estimate',
    featAgreement: 'Work agreement',
    featHeat: 'Heat alerts',
    featSos: 'SOS help',
    featFairPay: 'Fair Pay Score',
    featSchemes: 'Govt schemes',
    demoNote: 'Demo data is saved on this phone only.',
    resetDemo: 'Reset demo',
    resetConfirm: 'Clear all demo data on this phone?',
    navHome: 'Home', navJobs: 'Jobs', navPost: 'Post', navSafety: 'Safety', navSchemes: 'Schemes',

    freeToday: "I'm free today",
    freeTodayHint: 'Employers nearby will see you are available.',
    nowAvailable: 'Employers can now see you are free today ✅',
    notAvailable: 'You are hidden from employers today.',
    jobsTitle: 'Jobs near you',
    all: 'All',
    noJobs: 'No jobs of this type right now.',
    listen: '🔊 Listen',
    accept: '✅ Accept',
    viewAgreement: '📄 Agreement',
    gotPaid: '💰 I got paid',
    rateEmployer: '⭐ Rate employer',
    rateEmployerTitle: 'How was this employer?',
    rateWorkerTitle: 'How was this worker?',
    pickStars: 'Tap the stars first.',
    thanksRating: 'Thanks for rating ⭐',
    noVoice: 'Voice is not supported on this phone.',
    newEmployer: 'New employer',
    fairPay: 'Fair Pay',
    fairPayScore: 'Based on paying on time and workers’ ratings',
    riskyShort: 'Risky',
    hoursUnit: 'hrs',
    distanceUnknown: 'Distance not known',
    nearby: 'Nearby (walk)',
    bus: 'bus',

    postTitle: 'Post a job',
    yourName: 'Your name or shop',
    yourNamePh: 'e.g. Kumar Stores',
    workType: 'Work type',
    area: 'Area', areaPh: 'Street, area or landmark',
    date: 'Date', hours: 'Hours', load: 'Load / effort',
    light: 'Light', medium: 'Medium', heavy: 'Heavy',
    risky: 'Risky work (height, electric, sewer)',
    phone: 'Your WhatsApp number',
    postBtn: 'Post job',
    posted: 'Job posted ✅',
    badPhone: 'Enter a valid mobile number.',
    estimate: 'Estimated fair wage',
    gearTitle: 'Safety gear you must provide:',
    gloves: 'Gloves', safetyShoes: 'Safety shoes', goggles: 'Goggles', rubberGloves: 'Rubber gloves',
    insulatedTools: 'Insulated tools', helmet: 'Helmet', mask: 'Mask', harness: 'Safety harness for height',
    freeWorkers: 'Workers free today',
    newWorker: 'New',
    offerJob: 'Offer job',
    thisPhone: 'You',
    myJobs: 'Jobs I posted',
    noMyJobs: 'You have not posted any jobs yet.',
    markPaid: '💰 Mark paid',
    rateWorker: '⭐ Rate worker',
    statusOpen: 'Open', statusAccepted: 'Accepted', statusDone: 'Done',

    agreementTitle: 'Work agreement',
    agreementCode: 'Agreement no.',
    work: 'Work', employer: 'Employer', worker: 'Worker',
    agreedWage: 'Agreed wage',
    payment: 'Payment', paid: 'Paid', pending: 'Pending',
    paymentSaved: 'Payment recorded ✅',
    agreementNote: 'Both sides agreed to this wage and these hours before work started.',
    defaultWorker: 'Worker (this phone)',
    shareWhatsapp: 'Share on WhatsApp',
    close: 'Close', cancel: 'Cancel', submit: 'Submit',

    base: 'Base (8 hrs)', extraHours: 'Extra hours', shortShift: 'Short shift',
    loadExtra: 'Heavy effort', riskExtra: 'Risk pay', heatExtra: 'Heat pay (+10%)',

    sosBtn: 'SOS: send my location',
    sosHint: 'Sends your live location to your emergency contact on WhatsApp.',
    sosContact: 'Emergency contact number',
    sosNeedContact: 'Add an emergency contact number first.',
    police: 'Police', ambulance: 'Ambulance',
    mapTitle: 'Rest points nearby',
    simulateHot: 'Demo: simulate a hot day',
    useLocation: '📍 Use my location',
    noLocation: 'Could not get your location.',
    mapOffline: 'Map needs internet. The list below still works.',
    youAreHere: 'You are here',
    shade: 'Shade', water: 'Water', tea: 'Tea / food', toilet: 'Toilet',
    heatOffline: '🌐 Weather not available (offline).',

    schemesTitle: 'Government schemes for you',
    schemesHint: 'Answer 4 questions to see which schemes you can apply for.',
    qAge: 'Your age',
    qUnorganised: 'Do you work daily wage, without PF or ESI?',
    qIncome: 'Do you earn ₹15,000 a month or less?',
    qBank: 'Do you have a bank account?',
    yes: 'Yes', no: 'No',
    findSchemes: 'Find my schemes',
    officialSite: 'Official website',
    schemesDisclaimer: 'Eligibility here is simplified. Confirm on the official website before applying.',

    heatHot: (temp) => `🔥 Very hot (feels like ${temp}°C). Rest 10 min every hour and drink water. Heat pay added.`,
    heatOk: (temp) => `🌤️ Feels like ${temp}°C. Drink water regularly.`,
    speakJob: (name, j, w) => `${name} work at ${j.area}. ${j.hours} hours. Wage ${money(w.min)} to ${money(w.max)}.`,
    waAccept: (name, j) => `Hi, I saw your ${name} job at ${j.area} on Worker Buddy. I accept the work. Agreement no. ${j.agreement.code}, wage ${money(j.agreement.wage)}.`,
    waOffer: (name) => `Hi ${name}, I saw on Worker Buddy that you are free today. I have work for you. Can you call me?`,
    sosMsg: (link) => `🆘 I need help. ${link ? 'My location: ' + link : 'Please call me now.'} (sent from Worker Buddy)`,
    schemesFound: (n) => `${n} scheme${n === 1 ? '' : 's'} you may be able to get`,

    coolie: 'Coolie / Loader', helper: 'Helper', plumber: 'Plumber',
    electrician: 'Electrician', mason: 'Mason', painter: 'Painter'
  },

  ta: {
    langBtn: 'English',
    appWorker: 'வேலையாள் ஆப்',
    appEmployer: 'முதலாளி ஆப்',
    chooseApp: 'உங்கள் ஆப்பைத் தேர்ந்தெடுக்கவும்',
    workerAppDesc: 'அருகிலோ வாட்ஸ்அப்பிலோ வேலை பெறுங்கள், சத்தமாகக் கேளுங்கள், OTP-உடன் தொடங்குங்கள், சம்பளச் சீட்டு பெறுங்கள்.',
    employerAppDesc: 'நியாயமான கூலியில் வேலையைப் பதிவிடுங்கள், வாட்ஸ்அப்பில் பகிருங்கள், அருகிலுள்ள வேலையாட்களுக்கு உடனே செல்லும்.',
    howItWorks: 'எப்படி வேலை செய்கிறது',
    flow1: 'வேலையைப் பதிவிடு: வேலை வகை, இடம், நேரம்',
    flow2: 'யாரும் ஏற்கும் முன் நியாயமான கூலி கணக்கிட்டுக் காட்டப்படும்',
    flow3: 'வாட்ஸ்அப்பில் பகிரப்படும், அருகிலுள்ள வேலையாட்களின் போன் ஒலிக்கும்',
    flow4: 'வேலையாள் ஏற்று OTP-உடன் தொடங்குகிறார்',
    flow5: 'வெப்ப எச்சரிக்கை, தண்ணீர் இடைவேளை, கூடுதல் நேரத்துடன் வேலை',
    flow6: 'முதலாளி கொடுக்கிறார், வேலையாள் உறுதி செய்கிறார்: சம்பளச் சீட்டு, மதிப்பீடு',
    wageMapLink: '🗺️ கூலி வரைபடம்: அருகில் எவ்வளவு கொடுக்கிறார்கள்',
    openApp: 'திற',
    demoSideBySide: 'நேரடி டெமோ: ஒரு போனில் வேலையாள் ஆப், இன்னொரு போனில் முதலாளி ஆப் திறக்கவும். புக்கிங் ஒரு நொடியில் வேலையாளின் போனில் ஒலிக்கும்.',
    yourProfile: 'உங்கள் பெயர், திறன் மற்றும் வாட்ஸ்அப் எண் (முதலாளிகள் பார்ப்பார்கள்)',
    workerNamePh: 'உங்கள் பெயர்',
    mainSkill: 'முக்கிய திறன்',
    justNow: 'இப்போது தயார்',
    navWorkers: 'வேலையாட்கள்',
    navMyJobs: 'என் வேலைகள்',
    workersTitle: 'இன்று அருகில் தயாராக உள்ள வேலையாட்கள்',
    tagline: 'நியாயமான கூலி, பாதுகாப்பான வேலை, அடுத்த வேலை: ஒரே தட்டில்.',
    needWork: 'எனக்கு வேலை வேண்டும்',
    needWorker: 'எனக்கு வேலையாள் வேண்டும்',
    featWage: 'நியாயமான கூலி',
    featAgreement: 'வேலை ஒப்பந்தம்',
    featHeat: 'வெயில் எச்சரிக்கை',
    featSos: 'அவசர உதவி',
    featFairPay: 'நியாய ஊதிய மதிப்பெண்',
    featSchemes: 'அரசு திட்டங்கள்',
    demoNote: 'டெமோ தகவல் இந்த போனில் மட்டும் சேமிக்கப்படும்.',
    resetDemo: 'டெமோவை மீட்டமை',
    resetConfirm: 'இந்த போனில் உள்ள டெமோ தகவல்களை அழிக்கவா?',
    navHome: 'முகப்பு', navJobs: 'வேலைகள்', navPost: 'பதிவு', navSafety: 'பாதுகாப்பு', navSchemes: 'திட்டங்கள்',

    freeToday: 'இன்று நான் வேலைக்கு தயார்',
    freeTodayHint: 'அருகிலுள்ள முதலாளிகள் நீங்கள் தயார் என்று பார்ப்பார்கள்.',
    nowAvailable: 'நீங்கள் இன்று தயார் என்று முதலாளிகள் பார்க்கலாம் ✅',
    notAvailable: 'இன்று முதலாளிகளுக்கு நீங்கள் தெரியமாட்டீர்கள்.',
    jobsTitle: 'அருகிலுள்ள வேலைகள்',
    all: 'அனைத்தும்',
    noJobs: 'இந்த வகை வேலை இப்போது இல்லை.',
    listen: '🔊 கேளுங்கள்',
    accept: '✅ ஏற்கிறேன்',
    viewAgreement: '📄 ஒப்பந்தம்',
    gotPaid: '💰 கூலி கிடைத்தது',
    rateEmployer: '⭐ முதலாளியை மதிப்பிடு',
    rateEmployerTitle: 'இந்த முதலாளி எப்படி?',
    rateWorkerTitle: 'இந்த வேலையாள் எப்படி?',
    pickStars: 'முதலில் நட்சத்திரங்களைத் தட்டவும்.',
    thanksRating: 'மதிப்பீட்டுக்கு நன்றி ⭐',
    noVoice: 'இந்த போனில் குரல் வசதி இல்லை.',
    newEmployer: 'புதிய முதலாளி',
    fairPay: 'நியாய ஊதியம்',
    fairPayScore: 'நேரத்தில் கூலி கொடுப்பது மற்றும் மதிப்பீடுகளின் அடிப்படையில்',
    riskyShort: 'ஆபத்து',
    hoursUnit: 'மணி',
    distanceUnknown: 'தூரம் தெரியவில்லை',
    nearby: 'அருகில் (நடந்து)',
    bus: 'பஸ்',

    postTitle: 'வேலை பதிவு செய்யுங்கள்',
    yourName: 'உங்கள் பெயர் அல்லது கடை',
    yourNamePh: 'எ.கா. குமார் ஸ்டோர்ஸ்',
    workType: 'வேலை வகை',
    area: 'இடம்', areaPh: 'தெரு, பகுதி அல்லது அடையாளம்',
    date: 'தேதி', hours: 'மணி நேரம்', load: 'சுமை / உழைப்பு',
    light: 'குறைவு', medium: 'நடுத்தரம்', heavy: 'அதிகம்',
    risky: 'ஆபத்தான வேலை (உயரம், மின்சாரம், சாக்கடை)',
    phone: 'உங்கள் வாட்ஸ்அப் எண்',
    postBtn: 'பதிவு செய்',
    posted: 'வேலை பதிவானது ✅',
    badPhone: 'சரியான மொபைல் எண்ணை உள்ளிடவும்.',
    estimate: 'மதிப்பிட்ட நியாயமான கூலி',
    gearTitle: 'நீங்கள் வழங்க வேண்டிய பாதுகாப்பு உபகரணங்கள்:',
    gloves: 'கையுறை', safetyShoes: 'பாதுகாப்பு காலணி', goggles: 'கண்ணாடி', rubberGloves: 'ரப்பர் கையுறை',
    insulatedTools: 'மின்காப்பு கருவிகள்', helmet: 'தலைக்கவசம்', mask: 'முகக்கவசம்', harness: 'உயர வேலைக்கான பாதுகாப்பு பெல்ட்',
    freeWorkers: 'இன்று தயாராக உள்ள வேலையாட்கள்',
    newWorker: 'புதியவர்',
    offerJob: 'வேலை கொடு',
    thisPhone: 'நீங்கள்',
    myJobs: 'நான் பதிவு செய்த வேலைகள்',
    noMyJobs: 'நீங்கள் இன்னும் வேலை பதிவு செய்யவில்லை.',
    markPaid: '💰 கூலி கொடுத்தேன்',
    rateWorker: '⭐ வேலையாளை மதிப்பிடு',
    statusOpen: 'திறந்துள்ளது', statusAccepted: 'ஏற்கப்பட்டது', statusDone: 'முடிந்தது',

    agreementTitle: 'வேலை ஒப்பந்தம்',
    agreementCode: 'ஒப்பந்த எண்',
    work: 'வேலை', employer: 'முதலாளி', worker: 'வேலையாள்',
    agreedWage: 'ஒப்புக்கொண்ட கூலி',
    payment: 'கூலி', paid: 'கொடுக்கப்பட்டது', pending: 'நிலுவையில்',
    paymentSaved: 'கூலி பதிவானது ✅',
    agreementNote: 'வேலை தொடங்கும் முன் இருவரும் இந்த கூலி மற்றும் நேரத்தை ஒப்புக்கொண்டனர்.',
    defaultWorker: 'வேலையாள் (இந்த போன்)',
    shareWhatsapp: 'வாட்ஸ்அப்பில் பகிர்',
    close: 'மூடு', cancel: 'ரத்து', submit: 'சமர்ப்பி',

    base: 'அடிப்படை (8 மணி)', extraHours: 'கூடுதல் நேரம்', shortShift: 'குறைந்த நேரம்',
    loadExtra: 'கடின உழைப்பு', riskExtra: 'ஆபத்து கூலி', heatExtra: 'வெயில் கூலி (+10%)',

    sosBtn: 'அவசரம்: என் இருப்பிடத்தை அனுப்பு',
    sosHint: 'உங்கள் இருப்பிடத்தை அவசர தொடர்புக்கு வாட்ஸ்அப்பில் அனுப்பும்.',
    sosContact: 'அவசர தொடர்பு எண்',
    sosNeedContact: 'முதலில் அவசர தொடர்பு எண்ணைச் சேர்க்கவும்.',
    police: 'காவல்', ambulance: 'ஆம்புலன்ஸ்',
    mapTitle: 'அருகிலுள்ள ஓய்வு இடங்கள்',
    simulateHot: 'டெமோ: வெயில் நாள்',
    useLocation: '📍 என் இருப்பிடம்',
    noLocation: 'உங்கள் இருப்பிடத்தைப் பெற முடியவில்லை.',
    mapOffline: 'வரைபடத்துக்கு இணையம் தேவை. கீழே உள்ள பட்டியல் வேலை செய்யும்.',
    youAreHere: 'நீங்கள் இங்கே',
    shade: 'நிழல்', water: 'குடிநீர்', tea: 'டீ / உணவு', toilet: 'கழிப்பறை',
    heatOffline: '🌐 வானிலை தகவல் இல்லை (இணையம் இல்லை).',

    schemesTitle: 'உங்களுக்கான அரசு திட்டங்கள்',
    schemesHint: '4 கேள்விகளுக்குப் பதில் சொல்லுங்கள், நீங்கள் பெறக்கூடிய திட்டங்களைப் பாருங்கள்.',
    qAge: 'உங்கள் வயது',
    qUnorganised: 'PF அல்லது ESI இல்லாமல் தினக்கூலி வேலை செய்கிறீர்களா?',
    qIncome: 'மாதம் ₹15,000 அல்லது அதற்குக் குறைவாக சம்பாதிக்கிறீர்களா?',
    qBank: 'உங்களுக்கு வங்கிக் கணக்கு உள்ளதா?',
    yes: 'ஆம்', no: 'இல்லை',
    findSchemes: 'என் திட்டங்களைக் காட்டு',
    officialSite: 'அதிகாரப்பூர்வ இணையதளம்',
    schemesDisclaimer: 'இங்குள்ள தகுதி எளிமைப்படுத்தப்பட்டது. விண்ணப்பிக்கும் முன் அதிகாரப்பூர்வ இணையதளத்தில் சரிபார்க்கவும்.',

    heatHot: (temp) => `🔥 கடும் வெயில் (${temp}°C போல் உணர்கிறது). ஒவ்வொரு மணி நேரமும் 10 நிமிடம் ஓய்வு, தண்ணீர் குடியுங்கள். வெயில் கூலி சேர்க்கப்பட்டது.`,
    heatOk: (temp) => `🌤️ ${temp}°C போல் உணர்கிறது. அடிக்கடி தண்ணீர் குடியுங்கள்.`,
    speakJob: (name, j, w) => `${name} வேலை, ${j.area}. ${j.hours} மணி நேரம். கூலி ${money(w.min)} முதல் ${money(w.max)}.`,
    waAccept: (name, j) => `வணக்கம், Worker Buddy-ல் ${j.area} ${name} வேலையைப் பார்த்தேன். நான் வேலையை ஏற்கிறேன். ஒப்பந்த எண் ${j.agreement.code}, கூலி ${money(j.agreement.wage)}.`,
    waOffer: (name) => `வணக்கம் ${name}, நீங்கள் இன்று தயார் என்று Worker Buddy-ல் பார்த்தேன். உங்களுக்கு வேலை உள்ளது. என்னை அழைக்க முடியுமா?`,
    sosMsg: (link) => `🆘 எனக்கு உதவி தேவை. ${link ? 'என் இருப்பிடம்: ' + link : 'உடனே என்னை அழைக்கவும்.'} (Worker Buddy)`,
    schemesFound: (n) => `நீங்கள் பெறக்கூடிய ${n} திட்டங்கள்`,

    coolie: 'கூலி / சுமை தூக்குபவர்', helper: 'உதவியாளர்', plumber: 'பிளம்பர்',
    electrician: 'எலக்ட்ரீஷியன்', mason: 'கொத்தனார்', painter: 'பெயிண்டர்'
  }
};

// t('key') returns the text in the current language (falls back to English)
function t(key) {
  const value = (T[App.lang] && T[App.lang][key]) || T.en[key];
  return typeof value === 'string' ? value : key;
}
