const MIN_REQUEST_INTERVAL_MS = 1000;
let lastRequestAt = 0;

export default async function handler(request, response) {
  const query = String(request.query.q || '').trim();
  if (query.length < 3 || query.length > 180) return response.status(400).json({ error: 'Введіть щонайменше 3 символи.' });
  if (Date.now() - lastRequestAt < MIN_REQUEST_INTERVAL_MS) return response.status(429).json({ error: 'Зачекайте секунду перед наступним пошуком.' });
  lastRequestAt = Date.now();
  const params = new URLSearchParams({ q: query, format: 'jsonv2', addressdetails: '1', countrycodes: 'ua', limit: '6', 'accept-language': 'uk' });
  try {
    const result = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, { headers: { 'User-Agent': 'Poruch/1.0 (+https://github.com/XOTT69/blek)', 'Accept-Language': 'uk' } });
    if (!result.ok) throw new Error(`Nominatim returned ${result.status}`);
    const data = await result.json();
    response.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
    return response.status(200).json({ results: data.map((place) => ({ displayName: place.display_name, address: place.address || {}, lat: place.lat, lon: place.lon, osmType: place.osm_type, osmId: place.osm_id })) });
  } catch (error) {
    console.error('Geocoding failed', error.message);
    return response.status(502).json({ error: 'Пошук тимчасово недоступний. Спробуйте пізніше.' });
  }
}
