export default async function handler(request, response) {
  const lat = Number(request.query.lat);
  const lon = Number(request.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < 44 || lat > 53 || lon < 22 || lon > 41) return response.status(400).json({ error: 'Не вдалося визначити локацію в межах України.' });

  const params = new URLSearchParams({ lat: String(lat), lon: String(lon), format: 'jsonv2', addressdetails: '1', 'accept-language': 'uk' });
  try {
    const result = await fetch(`https://nominatim.openstreetmap.org/reverse?${params}`, { headers: { 'User-Agent': 'Poruch/1.0 (+https://github.com/XOTT69/blek)', 'Accept-Language': 'uk' } });
    if (!result.ok) throw new Error(`Nominatim returned ${result.status}`);
    const place = await result.json();
    if (!place?.display_name) return response.status(404).json({ error: 'Не вдалося знайти адресу для цієї точки.' });
    response.setHeader('Cache-Control', 'private, no-store');
    return response.status(200).json({ result: { displayName: place.display_name, address: place.address || {}, lat: place.lat, lon: place.lon } });
  } catch (error) {
    console.error('Reverse geocoding failed', error.message);
    return response.status(502).json({ error: 'Не вдалося визначити адресу. Спробуйте пошук вручну.' });
  }
}
