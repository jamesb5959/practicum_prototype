import * as satellite from 'satellite.js';

export const LOCAL_TLE_URL = '/data/nasa-leo.tle';
export const SAMPLE_TLE_URL = '/data/nasa-leo.sample.tle';
export const LOCAL_DEBRIS_TLE_URL = '/data/nasa-debris.tle';
export const SAMPLE_DEBRIS_TLE_URL = '/data/nasa-debris.sample.tle';

export type TleSatellite = {
  name: string;
  line1: string;
  line2: string;
  satrec: satellite.SatRec;
};

async function fetchTleWithFallback(
  localUrl: string,
  sampleUrl: string
): Promise<string> {
  try {
    const response = await fetch(localUrl, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Failed to fetch TLE data: ${response.status}`);
    }
    return await response.text();
  } catch {
    // Offline fallback so it still runs even if download failed.
    const response = await fetch(sampleUrl, { cache: 'no-store' });
    if (!response.ok) return '';
    return await response.text();
  }
}

export async function fetchActiveTle(): Promise<{ text: string; source: string }> {
  const text = await fetchTleWithFallback(LOCAL_TLE_URL, SAMPLE_TLE_URL);
  return { text, source: 'NASA' };
}

export async function fetchActiveAndDebrisTle(): Promise<{
  activeText: string;
  debrisText: string;
  source: string;
}> {
  const [activeText, debrisText] = await Promise.all([
    fetchTleWithFallback(LOCAL_TLE_URL, SAMPLE_TLE_URL),
    fetchTleWithFallback(LOCAL_DEBRIS_TLE_URL, SAMPLE_DEBRIS_TLE_URL)
  ]);

  return {
    activeText,
    debrisText,
    source: 'NASA'
  };
}

export function parseTle(tleText: string): TleSatellite[] {
  const lines = tleText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const satellites: TleSatellite[] = [];
  for (let i = 0; i < lines.length; i += 3) {
    const name = lines[i];
    const line1 = lines[i + 1];
    const line2 = lines[i + 2];
    if (!name || !line1 || !line2) continue;
    const satrec = satellite.twoline2satrec(line1, line2);
    satellites.push({ name, line1, line2, satrec });
  }

  return satellites;
}

export function propagateToGeodetic(
  satrec: satellite.SatRec,
  date: Date
): { lat: number; lon: number; altKm: number } | null {
  const positionAndVelocity = satellite.propagate(satrec, date);
  if (!positionAndVelocity || !positionAndVelocity.position) return null;

  const gmst = satellite.gstime(date);
  const geodetic = satellite.eciToGeodetic(positionAndVelocity.position, gmst);

  return {
    lat: satellite.degreesLat(geodetic.latitude),
    lon: satellite.degreesLong(geodetic.longitude),
    altKm: geodetic.height
  };
}
