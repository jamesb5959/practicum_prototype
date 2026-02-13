import * as satellite from 'satellite.js';

export const LOCAL_TLE_URL = '/data/nasa-leo.tle';
export const SAMPLE_TLE_URL = '/data/nasa-leo.sample.tle';

export type TleSatellite = {
  name: string;
  line1: string;
  line2: string;
  satrec: satellite.SatRec;
};

export async function fetchActiveTle(): Promise<{ text: string; source: string }> {
  try {
    const response = await fetch(LOCAL_TLE_URL, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Failed to fetch TLE data: ${response.status}`);
    }
    const text = await response.text();
    return { text, source: 'NASA' };
  } catch (err) {
    // Offline fallback so it still runs even if download failed. 
    const response = await fetch(SAMPLE_TLE_URL, { cache: 'no-store' });
    const text = await response.text();
    return { text, source: 'NASA' };
  }
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
