import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

function normalizeHeader(header: string) {
  return header.trim().toLowerCase();
}

function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const input = text.replace(/^[\uFEFF]/, '');
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    const next = input[i + 1];
    if (ch === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === ',' && !inQuotes) {
      row.push(field);
      field = '';
      continue;
    }
    if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && next === '\n') i += 1;
      row.push(field);
      field = '';
      if (row.some((v) => v.length > 0)) rows.push(row);
      row = [];
      continue;
    }
    field += ch;
  }
  row.push(field);
  if (row.some((v) => v.length > 0)) rows.push(row);

  if (!rows.length) return { headers: [], rows: [] };
  const [headers, ...data] = rows;
  return { headers, rows: data };
}

function toObject(headers: string[], values: string[]) {
  const obj: Record<string, string> = {};
  for (let i = 0; i < headers.length; i += 1) {
    obj[headers[i]] = values[i] ?? '';
  }
  return obj;
}

function isDebrisFromType(typeRaw: string | undefined) {
  const t = (typeRaw || '').toLowerCase();
  if (!t) return false;
  return /debris|fragment|rocket\s*body|r\/?b|spent|stage/.test(t);
}

function buildName(row: Record<string, string>) {
  const name = row['Satellite Name'] || row['satellite name'] || row['name'];
  const satNum = row['satellite_number'] || row['satellite number'] || row['norad_cat_id'] || row['norad'];
  return name?.trim() || (satNum ? `NORAD ${satNum}` : 'UNKNOWN');
}

export const GET: RequestHandler = async () => {
  try {
    const filePath = resolve(process.cwd(), 'TLE_Prediction', 'data', 'enriched_with_missions.csv');
    const csvText = await readFile(filePath, 'utf8');
    const { headers, rows } = parseCsv(csvText);
    if (!headers.length) return json({ activeText: '', debrisText: '', source: 'Enriched Missions CSV' });

    // Provide case-insensitive access by duplicating keys into a normalized map
    const activeTriplets: string[] = [];
    const debrisTriplets: string[] = [];

    for (const values of rows) {
      const raw = toObject(headers, values);
      const normalized = Object.fromEntries(
        Object.entries(raw).map(([k, v]) => [normalizeHeader(k), v])
      ) as Record<string, string>;

      const line1 = (normalized['tle_line1'] || raw['tle_line1'] || '').trim();
      const line2 = (normalized['tle_line2'] || raw['tle_line2'] || '').trim();
      if (!line1 || !line2) continue;

      const name = buildName(raw);
      const isDebris = isDebrisFromType(raw['Type'] || normalized['type']);

      const triplet = [name, line1, line2].join('\n');
      if (isDebris) debrisTriplets.push(triplet);
      else activeTriplets.push(triplet);
    }

    return json({
      activeText: activeTriplets.join('\n'),
      debrisText: debrisTriplets.join('\n'),
      source: 'Enriched Missions CSV'
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load TLE data.';
    return json({ error: message }, { status: 500 });
  }
};
