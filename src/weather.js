// Real weather where someone is, from Open-Meteo (free, no key). Only coarse
// coordinates are ever sent or stored: about 10 km of precision.

// WMO weather codes → the few kinds the world knows how to draw.
export function kindOf(code) {
  if (code <= 1) return 'clear';
  if (code === 2) return 'cloudy';
  if (code === 3) return 'overcast';
  if (code === 45 || code === 48) return 'fog';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95) return 'storm';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  return 'cloudy';
}

export const coarse = (n) => Math.round(Number(n) * 10) / 10;

export async function openMeteo(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=weather_code,temperature_2m`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`open-meteo ${res.status}`);
  const { current } = await res.json();
  return { kind: kindOf(current.weather_code), temp: Math.round(current.temperature_2m) };
}
