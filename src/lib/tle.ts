import * as satellite from 'satellite.js';

export const LOCAL_WARPCORE_CSV_URL = '/data/88_most_recent_satellites_LEO.csv';

export type TleSatellite = {
  name: string;
  line1: string;
  line2: string;
  satrec: satellite.SatRec;
  fields: {
    satelliteNumber: string;
    classification: string;
    internationalDesignator: string;
    epochIso: string;
    epochYear: number;
    epochDay: number;
    inclination: number;
    raan: number;
    eccentricity: number;
    argumentOfPerigee: number;
    meanAnomaly: number;
    meanMotion: number;
    revolutionsAtEpoch: number;
  };
};

type CsvRow = Record<string, string>;

async function fetchWarpcoreCsvAsTle(): Promise<string> {
  const response = await fetch(LOCAL_WARPCORE_CSV_URL, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Failed to fetch Warpcore data: ${response.status}`);
  }

  const rows = parseCsv(await response.text());
  return rows
    .map((row) => buildTleTripletFromRow(row))
    .filter((triplet) => triplet.every(Boolean))
    .map((triplet) => triplet.join('\n'))
    .join('\n');
}

export async function fetchActiveTle(): Promise<{ text: string; source: string }> {
  const text = await fetchWarpcoreCsvAsTle();
  return { text, source: 'Warpcore (Data)' };
}

export async function fetchActiveAndDebrisTle(): Promise<{
  activeText: string;
  debrisText: string;
  source: string;
}> {
  return {
    activeText: await fetchWarpcoreCsvAsTle(),
    debrisText: '',
    source: 'Warpcore (Data)'
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
    satellites.push({ name, line1, line2, satrec, fields: parseTleFields(line1, line2) });
  }

  return satellites;
}

function parseCsv(csvText: string): CsvRow[] {
  const normalized = csvText.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i];
    const next = normalized[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(field);
      field = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') {
        i += 1;
      }
      row.push(field);
      field = '';
      if (row.some((value) => value.length > 0)) {
        rows.push(row);
      }
      row = [];
      continue;
    }

    field += char;
  }

  row.push(field);
  if (row.some((value) => value.length > 0)) {
    rows.push(row);
  }

  if (!rows.length) {
    return [];
  }

  const [header, ...dataRows] = rows;
  return dataRows.map((values) =>
    Object.fromEntries(header.map((key, index) => [key, values[index] ?? '']))
  );
}

function buildTleTripletFromRow(row: CsvRow) {
  const satelliteNumber = row.satellite_number?.trim() || 'UNKNOWN';
  const designator = row.tle_international_designator?.trim() || row.tle_launch_piece?.trim() || 'UNKNOWN';
  return [
    `0 ${`NORAD ${satelliteNumber} | ${designator}`.slice(0, 24)}`,
    row.tle_line1?.trim() || '',
    row.tle_line2?.trim() || ''
  ];
}

function parseTleFields(line1: string, line2: string) {
  const epochYearShort = Number.parseInt(line1.slice(18, 20).trim(), 10);
  const epochDay = Number.parseFloat(line1.slice(20, 32).trim());
  const epochYear = epochYearShort < 57 ? 2000 + epochYearShort : 1900 + epochYearShort;
  const epochStart = new Date(Date.UTC(epochYear, 0, 1));
  const epochIso = new Date(epochStart.getTime() + (epochDay - 1) * 24 * 60 * 60 * 1000).toISOString();

  return {
    satelliteNumber: line1.slice(2, 7).trim(),
    classification: line1.slice(7, 8).trim() || 'U',
    internationalDesignator: line1.slice(9, 17).trim(),
    epochIso,
    epochYear,
    epochDay,
    inclination: Number.parseFloat(line2.slice(8, 16).trim()),
    raan: Number.parseFloat(line2.slice(17, 25).trim()),
    eccentricity: Number.parseFloat(`0.${line2.slice(26, 33).trim()}`),
    argumentOfPerigee: Number.parseFloat(line2.slice(34, 42).trim()),
    meanAnomaly: Number.parseFloat(line2.slice(43, 51).trim()),
    meanMotion: Number.parseFloat(line2.slice(52, 63).trim()),
    revolutionsAtEpoch: Number.parseInt(line2.slice(63, 68).trim(), 10)
  };
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
<<<<<<< HEAD
}
=======
}

export function propagateToEci(
  satrec: satellite.SatRec,
  date: Date
): { x: number; y: number; z: number } | null {
  const positionAndVelocity = satellite.propagate(satrec, date);
  if (!positionAndVelocity || !positionAndVelocity.position) return null;

  return {
    x: positionAndVelocity.position.x,
    y: positionAndVelocity.position.y,
    z: positionAndVelocity.position.z
  };
}
>>>>>>> d2690bf3e35508a9ba14fbe18b50a4131de75302
