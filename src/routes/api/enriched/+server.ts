import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

type EnrichedRow = {
  raw: Record<string, string>;
  satelliteNumber?: string;
  name?: string;
  fieldsFromName: Array<{ label: string; value: string }>;
};

let cache: { rows: EnrichedRow[]; mtimeMs: number } | null = null;

function normalizeHeader(header: string) {
  return header.trim().toLowerCase();
}

function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const input = text.replace(/^\uFEFF/, '');
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

async function loadEnriched(): Promise<EnrichedRow[]> {
  const filePath = resolve(process.cwd(), 'TLE_Prediction', 'data', 'enriched_with_missions.csv');

  // Basic mtime-based cache to avoid re-parsing on every request
  try {
    const stat = await import('node:fs/promises').then((m) => m.stat(filePath));
    if (cache && cache.mtimeMs === stat.mtimeMs) {
      return cache.rows;
    }
  } catch {
    // ignore stat errors, attempt read below which will surface appropriate error
  }

  const text = await readFile(filePath, 'utf8');
  const { headers, rows } = parseCsv(text);
  if (!headers.length) return [];

  const headerIndex: Record<string, number> = {};
  headers.forEach((h, i) => (headerIndex[normalizeHeader(h)] = i));
  const idxFromName = headers.findIndex((h) => normalizeHeader(h) === 'satellite name');

  const items: EnrichedRow[] = rows.map((values) => {
    const raw = toObject(headers, values);
    const normalized = Object.fromEntries(
      Object.entries(raw).map(([k, v]) => [normalizeHeader(k), v])
    ) as Record<string, string>;

    // Common variants for satellite number and name across datasets
    const satNum =
      normalized['satellite number'] ||
      normalized['satellite_number'] ||
      normalized['norad_cat_id'] ||
      normalized['norad id'] ||
      normalized['norad'] ||
      '';

    const name = normalized['satellite name'] || normalized['name'] || '';

    const start = idxFromName >= 0 ? idxFromName : 0;
    const fieldsFromName: Array<{ label: string; value: string }> = headers
      .slice(start)
      .map((label, i) => ({ label, value: values[start + i] ?? '' }))
      .filter((pair) => pair.label && (pair.value ?? '').toString().length > 0);

    return { raw, satelliteNumber: satNum?.trim() || undefined, name: name?.trim() || undefined, fieldsFromName };
  });

  try {
    const stat = await import('node:fs/promises').then((m) => m.stat(filePath));
    cache = { rows: items, mtimeMs: stat.mtimeMs };
  } catch {
    cache = { rows: items, mtimeMs: Date.now() };
  }

  return items;
}

export const GET: RequestHandler = async ({ url }) => {
  try {
    const all = await loadEnriched();
    const qSatNum = (url.searchParams.get('satelliteNumber') || '').trim();
    const qName = (url.searchParams.get('name') || '').trim().toLowerCase();

    let results = all;
    if (qSatNum) {
      results = all.filter((r) => (r.satelliteNumber || '').replace(/^0+/, '') === qSatNum.replace(/^0+/, ''));
    } else if (qName) {
      results = all.filter((r) => (r.name || '').toLowerCase() === qName);
    }

    if (qSatNum || qName) {
      const first = results[0];
      if (!first) return json({ fields: [] });
      return json({ fields: first.fieldsFromName });
    }

    // No filter: return only headers-from-name as keys for discovery plus row count
    const sample = all[0];
    return json({ count: all.length, sample: sample?.fieldsFromName ?? [] });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load enriched data.';
    return json({ error: message }, { status: 500 });
  }
};
