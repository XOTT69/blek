/* global supabase */
const DEMO_SERVICES = {
  electricity: { label: 'Світло', value: 'Є', confirmations: 24, updated: Date.now() - 2 * 60_000 },
  water: { label: 'Вода', value: 'Є', confirmations: 18, updated: Date.now() - 6 * 60_000 },
  internet: { label: 'Мобільний інтернет', value: 'Нестабільний', confirmations: 9, updated: Date.now() - 10 * 60_000 },
};
const DEMO_PLACES = [];
const $ = (selector) => document.querySelector(selector);
let savedLocation = null;
try { savedLocation = JSON.parse(localStorage.getItem('poruch-location') || 'null'); } catch { localStorage.removeItem('poruch-location'); }
let locationState = savedLocation || { city: 'Київ', district: 'Поділ', lat: 50.4662, lon: 30.5157 };
let services = JSON.parse(localStorage.getItem('poruch-demo-services') || 'null') || structuredClone(DEMO_SERVICES);
let places = DEMO_PLACES;
let verifiedPlaces = [];
let nearbyPlaces = [];
let db = null;
let realtimeChannel = null;
let selectedReport = {};
let selectedSearchResult = null;
const geocodeCache = new Map();

function emptyServices() { return Object.fromEntries(Object.entries(DEMO_SERVICES).map(([key, item]) => [key, { ...item, value: 'Ще немає даних', confirmations: 0, updated: null }])); }
function since(time) { if (!time) return 'ще немає звітів'; const minutes = Math.max(0, Math.round((Date.now() - new Date(time)) / 60_000)); return minutes < 1 ? 'щойно' : `${minutes} хв тому`; }
function confirmationsLabel(count) {
  const lastTwo = count % 100;
  const last = count % 10;
  const ending = lastTwo >= 11 && lastTwo <= 14 ? 'підтверджень' : last === 1 ? 'підтвердження' : last >= 2 && last <= 4 ? 'підтвердження' : 'підтверджень';
  return `${count} ${ending} за годину`;
}
function setConnection(live) { $('#connectionPill').innerHTML = `<i></i> ${live ? 'Оновлюється наживо' : 'Демо-режим'}`; }
function statusValue(service, status) {
  if (status === 'unavailable') return 'Немає';
  if (status === 'unstable') return service === 'internet' ? 'Нестабільний' : 'Нестабільно';
  return service === 'internet' ? 'Працює' : 'Є';
}
function cardClass(service) { return ['Є', 'Працює'].includes(services[service].value) ? 'status-good' : 'status-warn'; }
function renderServices() {
  Object.entries(services).forEach(([key, item]) => {
    const card = document.querySelector(`[data-service="${key}"].status-card`);
    card.classList.remove('status-good', 'status-warn'); card.classList.add(cardClass(key));
    $(`#${key}Value`).textContent = item.value;
    $(`#${key}Proof`).textContent = item.confirmations ? confirmationsLabel(item.confirmations) : 'поки немає підтверджень';
    $(`#${key}Time`).textContent = since(item.updated);
  });
}
function placeIcon(place) { return place.icon || ((place.tags || []).includes('charge') ? '⚡' : '⌁'); }
function distanceInKm(lat, lon) {
  if (!locationState.lat || !locationState.lon || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon))) return null;
  const toRad = (degrees) => degrees * Math.PI / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(Number(lat) - Number(locationState.lat));
  const dLon = toRad(Number(lon) - Number(locationState.lon));
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(locationState.lat)) * Math.cos(toRad(lat)) * Math.sin(dLon / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function formatDistance(place) {
  const distance = distanceInKm(place.lat, place.lon);
  if (distance === null) return place.distance || 'Поруч';
  return distance < 1 ? `${Math.max(50, Math.round(distance * 1000 / 50) * 50)} м` : `${distance.toFixed(1).replace('.', ',')} км`;
}
function updatePlaces() {
  places = [...verifiedPlaces, ...nearbyPlaces];
  renderPlaces();
  renderMapContext();
}
function renderPlaces(filter = document.querySelector('.filter.active')?.dataset.filter || 'all') {
  const visiblePlaces = places.filter((place) => filter === 'all' || (place.tags || []).includes(filter));
  $('#placeList').innerHTML = visiblePlaces.map((place) => {
    const content = `<span class="place-icon">${escapeHtml(placeIcon(place))}</span><div class="place-info"><h3>${escapeHtml(place.name)}</h3><p>${escapeHtml(place.detail || 'Деталі не вказані')}</p></div><span class="place-distance">${escapeHtml(formatDistance(place))}</span>`;
    return place.url ? `<a class="place place-link" href="${escapeHtml(place.url)}" target="_blank" rel="noopener noreferrer" aria-label="Відкрити ${escapeHtml(place.name)} на мапі">${content}</a>` : `<article class="place">${content}</article>`;
  }).join('') || '<p class="empty">Поки що немає місць цього типу. Спробуйте інший фільтр.</p>';
}
function toast(message) { const el = $('#toast'); el.textContent = message; el.classList.add('show'); clearTimeout(window.toastTimer); window.toastTimer = setTimeout(() => el.classList.remove('show'), 3200); }
function updateLocationLabel() { $('#locationName').textContent = `${locationState.city} · ${locationState.district}`; renderMapContext(); }
function renderMapContext() {
  $('#mapCityLabel').textContent = locationState.city;
  $('#mapDistrictLabel').textContent = locationState.district;
  const live = Boolean(db);
  $('#mapCard').classList.toggle('live-map', live);
  $('#mapCaption').textContent = places.length ? 'Місця показані списком; точні адреси людей не збираються' : 'Виберіть адресу, щоб знайти місця поруч';
}
function saveDemoServices() { localStorage.setItem('poruch-demo-services', JSON.stringify(services)); renderServices(); }
function demoReport(service, status) { services[service] = { ...services[service], value: statusValue(service, status), confirmations: services[service].confirmations + 1, updated: Date.now() }; saveDemoServices(); }

async function setupSupabase() {
  try {
    const response = await fetch('/api/config', { cache: 'no-store' });
    if (!response.ok) return;
    const config = await response.json();
    if (!config.url || !config.anonKey || !window.supabase) return;
    db = window.supabase.createClient(config.url, config.anonKey);
    const { data: sessionData } = await db.auth.getSession();
    if (!sessionData.session) { const { error } = await db.auth.signInAnonymously(); if (error) throw error; }
    setConnection(true); await refreshLiveData(); subscribeToUpdates();
  } catch (error) { console.warn('Supabase unavailable; demo mode remains active.', error.message); setConnection(false); }
}
async function refreshLiveData() {
  if (!db) return;
  const sinceIso = new Date(Date.now() - 60 * 60_000).toISOString();
  const [reportsResult, placesResult] = await Promise.all([
    db.from('status_reports').select('service,status,created_at').eq('city', locationState.city).eq('district', locationState.district).gte('created_at', sinceIso).order('created_at', { ascending: false }),
    db.from('places').select('name,details,capabilities,is_open,distance_label').eq('city', locationState.city).eq('district', locationState.district).eq('is_open', true).order('sort_order'),
  ]);
  if (reportsResult.error) throw reportsResult.error;
  aggregateReports(reportsResult.data || []);
  if (!placesResult.error) {
    verifiedPlaces = (placesResult.data || []).map((place) => ({ name: place.name, detail: place.details, tags: place.capabilities || [], distance: place.distance_label || 'Поруч' }));
    updatePlaces();
  }
}
function aggregateReports(reports) {
  services = emptyServices();
  Object.keys(services).forEach((service) => {
    const current = reports.filter((report) => report.service === service);
    if (!current.length) return;
    const scores = current.reduce((totals, report) => ({ ...totals, [report.status]: (totals[report.status] || 0) + 1 }), {});
    const status = Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0];
    services[service] = { ...services[service], value: statusValue(service, status), confirmations: current.length, updated: current[0].created_at };
  });
  renderServices();
}
async function sendReport(service, status, silent = false) {
  if (!db) { demoReport(service, status); if (!silent) toast(`Дякуємо! Стан «${services[service].label}» оновлено в демо.`); return; }
  const { error } = await db.rpc('submit_status_report', { p_city: locationState.city, p_district: locationState.district, p_service: service, p_status: status });
  if (error) {
    const rateLimited = error.message?.includes('Please wait before sending');
    toast(rateLimited ? 'Ви вже повідомляли про цей сервіс. Спробуйте ще раз через 2 хвилини.' : 'Не вдалося зберегти повідомлення. Спробуйте ще раз.');
    console.error(error);
    return;
  }
  await refreshLiveData(); if (!silent) toast(`Дякуємо! Стан «${services[service].label}» оновлено.`);
}
function subscribeToUpdates() {
  if (realtimeChannel) realtimeChannel.unsubscribe();
  realtimeChannel = db.channel(`reports:${locationState.city}:${locationState.district}`).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'status_reports', filter: `city=eq.${locationState.city}` }, (payload) => { if (payload.new.district === locationState.district) refreshLiveData().catch(console.error); }).subscribe();
}
function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]); }
function parseSearchResult(place) {
  const address = place.address || {};
  const city = address.city || address.town || address.village || address.municipality || address.city_district || address.county || address.state_district || 'Локація';
  const district = address.city_district || address.suburb || address.neighbourhood || address.quarter || address.municipality || address.county || 'Уся громада';
  return { city, district, label: place.displayName, lat: place.lat, lon: place.lon };
}
function selectLocationResult(place) {
  selectedSearchResult = parseSearchResult(place);
  $('#selectedLocation').textContent = `Обрано: ${selectedSearchResult.label}`;
  $('#selectedLocation').hidden = false;
  $('#saveLocation').disabled = false;
  $('#saveLocation').textContent = 'Зберегти цю локацію';
  $('#searchFeedback').textContent = `Звіти будуть об’єднані для: ${selectedSearchResult.city} · ${selectedSearchResult.district}`;
}
function showSearchResults(results) {
  $('#searchResults').innerHTML = results.map((place, index) => `<button type="button" class="search-result" data-search-result="${index}"><strong>${escapeHtml(place.displayName.split(',').slice(0, 2).join(', '))}</strong><span>${escapeHtml(place.displayName)}</span></button>`).join('');
  document.querySelectorAll('[data-search-result]').forEach((button) => button.addEventListener('click', () => {
    selectLocationResult(results[Number(button.dataset.searchResult)]);
  }));
}
async function loadNearbyPlaces() {
  if (!locationState.lat || !locationState.lon) { $('#nearbyFeedback').textContent = 'Спершу знайдіть та оберіть адресу через кнопку з локацією вгорі.'; return; }
  $('#nearbyButton').disabled = true; $('#nearbyButton').textContent = 'Шукаємо поруч…'; $('#nearbyFeedback').textContent = 'Отримуємо об’єкти з OpenStreetMap…';
  try {
    const response = await fetch(`/api/nearby?lat=${encodeURIComponent(locationState.lat)}&lon=${encodeURIComponent(locationState.lon)}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error);
    nearbyPlaces = (payload.places || []).map((place) => {
      const lat = Number(place.lat);
      const lon = Number(place.lon);
      const mapUrl = Number.isFinite(lat) && Number.isFinite(lon) ? `https://www.openstreetmap.org/?mlat=${encodeURIComponent(lat)}&mlon=${encodeURIComponent(lon)}#map=18/${lat}/${lon}` : null;
      return {
        name: place.name,
        detail: [place.type, place.openingHours ? `Години: ${place.openingHours}` : 'Режим роботи не вказано'].join(' · '),
        tags: place.kind ? [place.kind] : [],
        icon: place.icon,
        lat,
        lon,
        url: mapUrl,
      };
    });
    const activeFilter = document.querySelector('.filter.active');
    if (activeFilter?.dataset.filter !== 'all') { activeFilter.classList.remove('active'); document.querySelector('[data-filter="all"]').classList.add('active'); }
    updatePlaces();
    $('#nearbyFeedback').textContent = nearbyPlaces.length ? `Знайдено ${nearbyPlaces.length} реальних об’єктів. Дані про режим роботи можуть бути неактуальними — перевіряйте перед візитом.` : 'Поруч не знайдено об’єктів з потрібними тегами OpenStreetMap.';
  } catch (error) { $('#nearbyFeedback').textContent = error.message || 'Пошук місць тимчасово недоступний.'; }
  finally { $('#nearbyButton').disabled = false; $('#nearbyButton').textContent = 'Знайти реальні місця поруч'; }
}
async function findLocation() {
  const query = $('#locationSearch').value.trim();
  if (query.length < 3) { $('#searchFeedback').textContent = 'Введіть щонайменше 3 символи.'; return; }
  $('#searchFeedback').textContent = 'Шукаємо в OpenStreetMap…'; $('#searchResults').innerHTML = '';
  try {
    const cacheKey = query.toLocaleLowerCase('uk');
    if (geocodeCache.has(cacheKey)) {
      const cachedResults = geocodeCache.get(cacheKey);
      $('#searchFeedback').textContent = 'Оберіть точний варіант нижче:';
      showSearchResults(cachedResults);
      return;
    }
    const response = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error);
    if (!payload.results?.length) { $('#searchFeedback').textContent = 'Нічого не знайдено. Спробуйте повнішу назву або додайте місто.'; return; }
    geocodeCache.set(cacheKey, payload.results);
    $('#searchFeedback').textContent = 'Оберіть точний варіант нижче:';
    showSearchResults(payload.results);
  } catch (error) { $('#searchFeedback').textContent = error.message || 'Пошук тимчасово недоступний.'; }
}
async function findMyLocation() {
  if (!navigator.geolocation) { $('#searchFeedback').textContent = 'Ваш браузер не підтримує визначення геолокації. Скористайтеся пошуком вручну.'; return; }
  const button = $('#geolocationButton');
  button.disabled = true; button.textContent = 'Визначаємо місце…'; $('#searchFeedback').textContent = 'Попросимо дозвіл на геолокацію лише для пошуку поруч.';
  try {
    const position = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: false, timeout: 12_000, maximumAge: 300_000 }));
    $('#searchFeedback').textContent = 'Визначаємо адресу…';
    const response = await fetch(`/api/reverse?lat=${encodeURIComponent(position.coords.latitude)}&lon=${encodeURIComponent(position.coords.longitude)}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error);
    selectLocationResult(payload.result);
  } catch (error) {
    const message = error.code === 1 ? 'Доступ до геолокації заборонено. Дозвольте його в браузері або введіть адресу вручну.' : error.code === 3 ? 'Не вдалося визначити місце вчасно. Спробуйте ще раз або введіть адресу.' : (error.message || 'Не вдалося визначити локацію. Спробуйте пошук вручну.');
    $('#searchFeedback').textContent = message;
  } finally { button.disabled = false; button.textContent = '⌖ Визначити мою геолокацію'; }
}

document.querySelectorAll('.report-actions button').forEach((button) => button.addEventListener('click', () => sendReport(button.dataset.service, button.dataset.status === 'yes' ? 'available' : 'unavailable')));
$('#locationButton').addEventListener('click', () => { selectedSearchResult = null; $('#locationSearch').value = ''; $('#searchResults').innerHTML = ''; $('#selectedLocation').hidden = true; $('#saveLocation').disabled = true; $('#saveLocation').textContent = 'Спершу оберіть локацію'; $('#searchFeedback').textContent = 'Введіть адресу й оберіть один із варіантів нижче.'; $('#locationDialog').showModal(); });
$('#locationSearchButton').addEventListener('click', findLocation);
$('#locationSearch').addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); findLocation(); } });
$('#geolocationButton').addEventListener('click', findMyLocation);
$('#locationDialog').addEventListener('close', async () => { if ($('#locationDialog').returnValue !== 'save' || !selectedSearchResult) return; locationState = selectedSearchResult; localStorage.setItem('poruch-location', JSON.stringify(locationState)); updateLocationLabel(); await refreshLiveData().catch(console.error); if (db) subscribeToUpdates(); await loadNearbyPlaces(); toast('Локацію оновлено'); });
$('#filterButton').addEventListener('click', () => { $('#filterRow').hidden = !$('#filterRow').hidden; });
document.querySelectorAll('.filter').forEach((button) => button.addEventListener('click', () => { document.querySelector('.filter.active').classList.remove('active'); button.classList.add('active'); renderPlaces(button.dataset.filter); }));
$('#nearbyButton').addEventListener('click', loadNearbyPlaces);
function renderQuickReport() {
  $('#quickReport').innerHTML = Object.entries(services).map(([key, item]) => `<button class="${selectedReport[key] === 'available' ? 'selected' : ''}" data-quick="${key}">${item.label}<span>${selectedReport[key] === 'available' ? 'Є / працює' : 'Немає'}</span></button>`).join('');
  document.querySelectorAll('[data-quick]').forEach((button) => button.addEventListener('click', (event) => { event.preventDefault(); const key = button.dataset.quick; selectedReport[key] = selectedReport[key] === 'available' ? 'unavailable' : 'available'; renderQuickReport(); }));
}
$('#reportNav').addEventListener('click', () => { selectedReport = Object.fromEntries(Object.keys(services).map((key) => [key, services[key].value === 'Немає' ? 'unavailable' : 'available'])); renderQuickReport(); $('#reportDialog').showModal(); });
$('#reportDialog').addEventListener('close', async () => { if ($('#reportDialog').returnValue !== 'save') return; await Promise.all(Object.entries(selectedReport).map(([service, status]) => sendReport(service, status, true))); toast(db ? 'Дякуємо! Дані району оновлено.' : 'Демо-дані району оновлено.'); });
$('#alertsButton').addEventListener('click', () => $('#alertDialog').showModal());
$('#enableAlerts').addEventListener('click', (event) => { event.preventDefault(); $('#alertDialog').close(); toast('Сповіщення увімкнено — функція буде активна після запуску сервера.'); });
let deferredPrompt; window.addEventListener('beforeinstallprompt', (event) => { event.preventDefault(); deferredPrompt = event; $('#installButton').hidden = false; }); $('#installButton').addEventListener('click', async () => { if (!deferredPrompt) return; deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt = null; $('#installButton').hidden = true; });
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/service-worker.js'));
updateLocationLabel(); renderServices(); renderPlaces(); setupSupabase().finally(() => loadNearbyPlaces()); setInterval(renderServices, 60_000);
