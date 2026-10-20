// safety.js — heat alert, rest-point map, SOS, welfare scheme finder
// Owner: Member 3 (Safety & welfare)

// ---------- Distance helpers ----------
function distanceKm(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

// "3.2 km · ~₹10 bus" from where the worker is to the job's area
function distanceText(job) {
  const spot = job.lat != null ? [job.lat, job.lng] : AREAS[job.area];
  if (!spot) return t('distanceUnknown');
  const km = distanceKm(App.here, { lat: spot[0], lng: spot[1] });
  if (km < 0.5) return t('nearby');
  const fare = Math.max(5, Math.round(5 + km * 1.5));
  return `${km.toFixed(1)} km · ~₹${fare} ${t('bus')}`;
}

// ---------- Heat alert (free Open-Meteo API, no key) ----------
async function loadHeat() {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${App.here.lat}&longitude=${App.here.lng}&current=apparent_temperature`;
    const data = await fetch(url).then((r) => r.json());
    App.temp = Math.round(data.current.apparent_temperature);
  } catch (e) {
    App.temp = null;
  }
  App.heatChecked = true;
  updateHeatState();
}

function updateHeatState() {
  App.isHot = App.simulateHot || (App.temp !== null && App.temp >= 36);
  renderHeatBanners();
  if (App.onHeat) App.onHeat(); // each app redraws wages when heat pay changes
}

function renderHeatBanners() {
  let html;
  let cls;
  if (App.simulateHot) {
    html = T[App.lang].heatHot(40);
    cls = 'heat-hot';
  } else if (App.temp === null) {
    html = App.heatChecked ? t('heatOffline') : ''; // stay hidden while the weather loads
    cls = 'heat-off';
  } else if (App.isHot) {
    html = T[App.lang].heatHot(App.temp);
    cls = 'heat-hot';
  } else {
    html = T[App.lang].heatOk(App.temp);
    cls = 'heat-ok';
  }
  document.querySelectorAll('.heat-banner').forEach((el) => {
    el.className = 'heat-banner ' + cls;
    el.textContent = html;
  });
}

function toggleSimulateHot() {
  App.simulateHot = document.getElementById('simulateHot').checked;
  updateHeatState();
}

// ---------- Rest-point map ----------
let map = null;
let hereMarker = null;

function initMap() {
  if (!document.getElementById('map')) return;
  if (map) {
    map.invalidateSize();
    return;
  }
  if (typeof L === 'undefined') {
    document.getElementById('map').innerHTML = `<div class="map-note">${t('mapOffline')}</div>`;
    return;
  }
  map = L.map('map').setView([App.here.lat, App.here.lng], 15);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);

  placeLayer = L.layerGroup().addTo(map);
  refreshPlacesOnMap();
  hereMarker = L.marker([App.here.lat, App.here.lng]).addTo(map).bindPopup(t('youAreHere'));
  setTimeout(() => map.invalidateSize(), 100);
  loadPlaces(); // real places from OpenStreetMap (features.js)
}

// Draws water, shade, tea shops and toilets: real ones when online, saved ones offline
let placeLayer = null;
function refreshPlacesOnMap() {
  if (!placeLayer) return;
  placeLayer.clearLayers();
  currentPlaces().forEach((p) => {
    const icon = L.divIcon({ className: 'map-pin', html: REST_ICONS[p.kind], iconSize: [32, 32] });
    L.marker([p.lat, p.lng], { icon }).addTo(placeLayer).bindPopup(`<b>${esc(p.name)}</b><br>${t(p.kind)}`);
  });
}

function renderRestList() {
  if (!document.getElementById('restList')) return;
  const points = currentPlaces()
    .map((p) => ({ ...p, km: distanceKm(App.here, p) }))
    // Rest points hosted by shops come first when they are close
    .sort((a, b) => ((b.kind === 'host' && b.km < 2) - (a.kind === 'host' && a.km < 2)) || a.km - b.km)
    .slice(0, 15);
  document.getElementById('restList').innerHTML = points.map((p) => `
    <div class="rest-item">
      <span>${REST_ICONS[p.kind]} ${esc(p.name)}</span>
      <span class="muted small">${Math.round(p.km * 1000)} m</span>
    </div>`).join('');
}

function useMyLocation() {
  if (!navigator.geolocation) {
    showToast(t('noLocation'));
    return;
  }
  navigator.geolocation.getCurrentPosition((pos) => {
    App.here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    if (map) {
      map.setView([App.here.lat, App.here.lng], 15);
      hereMarker.setLatLng([App.here.lat, App.here.lng]);
    }
    renderRestList();
    loadPlaces();
    if (App.onMove) App.onMove(); // each app redraws distances
    loadHeat();
  }, () => showToast(t('noLocation')), { timeout: 10000 });
}

// ---------- SOS ----------
function saveContact() {
  Store.set('sosContact', document.getElementById('sosContact').value.replace(/\D/g, ''));
}

function sendSOS() {
  const contact = document.getElementById('sosContact').value.replace(/\D/g, '');
  if (!/^[6-9]\d{9}$/.test(contact)) {
    showToast(t('sosNeedContact'));
    document.getElementById('sosContact').focus();
    return;
  }
  saveContact();
  const send = (link) => {
    const text = T[App.lang].sosMsg(link);
    window.open(`https://wa.me/91${contact}?text=${encodeURIComponent(text)}`, '_blank');
  };
  if (!navigator.geolocation) return send(null);
  navigator.geolocation.getCurrentPosition(
    (pos) => send(`https://maps.google.com/?q=${pos.coords.latitude},${pos.coords.longitude}`),
    () => send(null),
    { timeout: 8000 }
  );
}

// ---------- Welfare scheme finder ----------
function findSchemes(event) {
  event.preventDefault();
  const form = event.target;
  const answers = {
    age: Number(form.age.value),
    unorganised: form.unorganised.value === 'yes',
    lowIncome: form.lowIncome.value === 'yes',
    bank: form.bank.value === 'yes'
  };
  Store.set('schemeAnswers', answers);
  renderSchemes(answers);
}

function renderSchemes(answers) {
  const box = document.getElementById('schemeResults');
  if (!box) return;
  if (!answers) {
    box.innerHTML = '';
    return;
  }
  const matches = SCHEMES.filter((s) => s.eligible(answers));
  box.innerHTML = `<h3>${T[App.lang].schemesFound(matches.length)}</h3>` + matches.map((s) => `
    <div class="scheme">
      <h3>${s.icon} ${s.name}</h3>
      <p>${s.text[App.lang]}</p>
      <a href="${s.link}" target="_blank" rel="noopener">${t('officialSite')} ↗</a>
    </div>`).join('') + `<p class="muted small">${t('schemesDisclaimer')}</p>`;
}

function initSafety() {
  const contact = document.getElementById('sosContact');
  if (contact) contact.value = Store.get('sosContact', '');
  const schemeForm = document.getElementById('schemeForm');
  if (schemeForm) schemeForm.addEventListener('submit', findSchemes);
}
