/* global supabase */
const DEMO_SERVICES = {
  electricity: { label: 'Світло', value: 'Є', confirmations: 24, updated: Date.now() - 2 * 60_000 },
  water: { label: 'Вода', value: 'Є', confirmations: 18, updated: Date.now() - 6 * 60_000 },
  internet: { label: 'Мобільний інтернет', value: 'Нестабільний', confirmations: 9, updated: Date.now() - 10 * 60_000 },
};
const DEMO_PLACES = [
  { name: 'Хлебний', detail: 'Зарядка · Wi‑Fi · відкрито', distance: '4 хв', icon: '⚡', tags: ['charge', 'wifi'] },
  { name: 'Бібліотека на Подолі', detail: 'Тепло · вода · 12 місць', distance: '7 хв', icon: '⌁', tags: ['water', 'charge'] },
  { name: 'Coworking «Підвал»', detail: 'Генератор · стабільний Wi‑Fi', distance: '9 хв', icon: '◒', tags: ['wifi', 'charge'] },
];
const DEMO_PLACE_NAMES = new Set(DEMO_PLACES.map((place) => place.name));
const $ = (selector) => document.querySelector(selector);
let savedLocation = null;
try { savedLocation = JSON.parse(localStorage.getItem('poruch-location') || 'null'); } catch { localStorage.removeItem('poruch-location'); }
let locationState = savedLocation || { city: 'Київ', district: 'Поділ' };
let services = JSON.parse(localStorage.getItem('poruch-demo-services') || 'null') || structuredClone(DEMO_SERVICES);
let places = DEMO_PLACES;
let db = null;
let realtimeChannel = null;
let selectedReport = {};
let selectedSearchResult = null;

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
function renderPlaces(filter = document.querySelector('.filter.active')?.dataset.filter || 'all') {
  $('#placeList').innerHTML = places.filter((p) => filter === 'all' || p.tags.includes(filter)).map((p) => `<article class="place"><span class="place-icon">${placeIcon(p)}</span><div class="place-info"><h3>${p.name}</h3><p>${p.detail}</p></div><span class="place-distance">${p.distance || 'Поруч'}</span></article>`).join('') || '<p class="empty">Поки що немає підтверджених місць.</p>';
}
function toast(message) { const el = $('#toast'); el.textContent = message; el.classList.add('show'); clearTimeout(window.toastTimer); window.toastTimer = setTimeout(() => el.classList.remove('show'), 3200); }
function updateLocationLabel() { $('#locationName').textContent = `${locationState.city} · ${locationState.district}`; renderMapContext(); }
function renderMapContext() {
  $('#mapCityLabel').textContent = locationState.city;
  $('#mapDistrictLabel').textContent = locationState.district;
  const live = Boolean(db);
  $('#mapCard').classList.toggle('live-map', live);
  $('#mapCaption').textContent = live ? (places.length ? 'Лише верифіковані точки; точні адреси людей не показуються' : 'У цій локації ще немає верифікованих точок') : 'Демоточок не використовуйте як реальні адреси';
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
  if (!placesResult.error) { places = (placesResult.data || []).filter((place) => !DEMO_PLACE_NAMES.has(place.name)).map((p) => ({ name: p.name, detail: p.details, tags: p.capabilities || [], distance: p.distance_label || 'Поруч' })); renderPlaces(); renderMapContext(); }
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
  const { error } = await db.from('status_reports').insert({ city: locationState.city, district: locationState.district, service, status });
  if (error) { toast('Не вдалося зберегти повідомлення. Спробуйте ще раз.'); console.error(error); return; }
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
function showSearchResults(results) {
  $('#searchResults').innerHTML = results.map((place, index) => `<button type="button" class="search-result" data-search-result="${index}"><strong>${escapeHtml(place.displayName.split(',').slice(0, 2).join(', '))}</strong><span>${escapeHtml(place.displayName)}</span></button>`).join('');
  document.querySelectorAll('[data-search-result]').forEach((button) => button.addEventListener('click', () => {
    selectedSearchResult = parseSearchResult(results[Number(button.dataset.searchResult)]);
    $('#selectedLocation').textContent = `Обрано: ${selectedSearchResult.label}`;
    $('#selectedLocation').hidden = false;
    $('#saveLocation').disabled = false;
    $('#searchFeedback').textContent = `Звіти будуть об’єднані для: ${selectedSearchResult.city} · ${selectedSearchResult.district}`;
  }));
}
async function loadNearbyPlaces() {
  if (!locationState.lat || !locationState.lon) { $('#nearbyFeedback').textContent = 'Спершу знайдіть та оберіть адресу через кнопку з локацією вгорі.'; return; }
  $('#nearbyButton').disabled = true; $('#nearbyButton').textContent = 'Шукаємо поруч…'; $('#nearbyFeedback').textContent = 'Отримуємо об’єкти з OpenStreetMap…';
  try {
    const response = await fetch(`/api/nearby?lat=${encodeURIComponent(locationState.lat)}&lon=${encodeURIComponent(locationState.lon)}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error);
    places = (payload.places || []).map((place) => ({ name: place.name, detail: [place.type, place.openingHours ? `Години: ${place.openingHours}` : 'Режим роботи не вказано'].join(' · '), tags: [], icon: place.icon, distance: 'OSM' }));
    renderPlaces(); renderMapContext();
    $('#nearbyFeedback').textContent = places.length ? `Знайдено ${places.length} реальних об’єктів. Дані про режим роботи можуть бути неактуальними — перевіряйте перед візитом.` : 'Поруч не знайдено об’єктів з потрібними тегами OpenStreetMap.';
  } catch (error) { $('#nearbyFeedback').textContent = error.message || 'Пошук місць тимчасово недоступний.'; }
  finally { $('#nearbyButton').disabled = false; $('#nearbyButton').textContent = 'Знайти реальні місця поруч'; }
}
async function findLocation() {
  const query = $('#locationSearch').value.trim();
  if (query.length < 3) { $('#searchFeedback').textContent = 'Введіть щонайменше 3 символи.'; return; }
  $('#searchFeedback').textContent = 'Шукаємо в OpenStreetMap…'; $('#searchResults').innerHTML = '';
  try {
    const response = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error);
    if (!payload.results?.length) { $('#searchFeedback').textContent = 'Нічого не знайдено. Спробуйте повнішу назву або додайте місто.'; return; }
    $('#searchFeedback').textContent = 'Оберіть точний варіант:';
    showSearchResults(payload.results);
  } catch (error) { $('#searchFeedback').textContent = error.message || 'Пошук тимчасово недоступний.'; }
}

document.querySelectorAll('.report-actions button').forEach((button) => button.addEventListener('click', () => sendReport(button.dataset.service, button.dataset.status === 'yes' ? 'available' : 'unavailable')));
$('#locationButton').addEventListener('click', () => { selectedSearchResult = null; $('#locationSearch').value = ''; $('#searchResults').innerHTML = ''; $('#selectedLocation').hidden = true; $('#saveLocation').disabled = true; $('#searchFeedback').textContent = 'Пошук вручну — до 6 точних варіантів.'; $('#locationDialog').showModal(); });
$('#locationSearchButton').addEventListener('click', findLocation);
$('#locationSearch').addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); findLocation(); } });
$('#locationDialog').addEventListener('close', async () => { if ($('#locationDialog').returnValue !== 'save' || !selectedSearchResult) return; locationState = selectedSearchResult; localStorage.setItem('poruch-location', JSON.stringify(locationState)); updateLocationLabel(); $('#nearbyFeedback').textContent = 'Локацію оновлено. Натисніть «Знайти реальні місця поруч». '; await refreshLiveData().catch(console.error); if (db) subscribeToUpdates(); toast('Локацію оновлено'); });
$('#filterButton').addEventListener('click', () => { $('#filterRow').hidden = !$('#filterRow').hidden; });
document.querySelectorAll('.filter').forEach((button) => button.addEventListener('click', () => { document.querySelector('.filter.active').classList.remove('active'); button.classList.add('active'); renderPlaces(button.dataset.filter); }));
document.querySelectorAll('.map-pin').forEach((pin) => pin.addEventListener('click', () => { const place = DEMO_PLACES[pin.dataset.place]; toast(`${place.name}: ${place.detail}`); }));
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
updateLocationLabel(); renderServices(); renderPlaces(); setupSupabase(); setInterval(renderServices, 60_000);
