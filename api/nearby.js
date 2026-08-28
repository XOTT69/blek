const TYPES = { cafe: ['Кафе', '☕'], fast_food: ['Заклад харчування', '☕'], restaurant: ['Ресторан', '☕'], pharmacy: ['Аптека', '✚'], library: ['Бібліотека', '▤'], fuel: ['АЗК', '⛽'], coworking: ['Коворкінг', '◒'] };

export default async function handler(request, response) {
  const lat = Number(request.query.lat);
  const lon = Number(request.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < 44 || lat > 53 || lon < 22 || lon > 41) return response.status(400).json({ error: 'Некоректна локація.' });
  const query = `[out:json][timeout:20];(nwr["amenity"~"^(cafe|fast_food|restaurant|pharmacy|library|fuel)$"](around:2500,${lat},${lon});nwr["office"="coworking"](around:2500,${lat},${lon}););out center tags 30;`;
  try {
    const apiResponse = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Poruch/1.0 (+https://github.com/XOTT69/blek)' }, body: new URLSearchParams({ data: query }) });
    if (!apiResponse.ok) throw new Error(`Overpass returned ${apiResponse.status}`);
    const payload = await apiResponse.json();
    const places = (payload.elements || []).map((element) => {
      const tags = element.tags || {};
      const amenity = tags.amenity || (tags.office === 'coworking' ? 'coworking' : '');
      const [type, icon] = TYPES[amenity] || ['Місце', '⌖'];
      return { name: tags['name:uk'] || tags.name || type, type, icon, openingHours: tags.opening_hours || null, website: tags.website || tags['contact:website'] || null, lat: element.lat || element.center?.lat, lon: element.lon || element.center?.lon };
    }).filter((place) => place.name).slice(0, 12);
    response.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=3600');
    return response.status(200).json({ places });
  } catch (error) {
    console.error('Nearby places failed', error.message);
    return response.status(502).json({ error: 'Не вдалося отримати місця поруч. Спробуйте пізніше.' });
  }
}
