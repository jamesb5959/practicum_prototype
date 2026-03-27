import { writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const DEFAULT_BASE_URLS = [
  'https://ghrc.nsstc.nasa.gov',
  'http://ghrc.nsstc.nasa.gov'
];

function getBaseUrls() {
  const envBase = process.env.GHRC_BASE_URL;
  if (envBase) {
    return [envBase.replace(/\/+$/, '')];
  }
  return DEFAULT_BASE_URLS;
}

function buildUrls() {
  const bases = getBaseUrls();
  return {
    satellites: bases.map((base) => `${base}/services/satellites/satellites.pl`),
    elements: bases.map((base) => `${base}/services/satellites/elements.pl`)
  };
}
const MAX_LEO_KM = 2000;
const MAX_LEO_PERIOD_MIN = 128;

function parseAttributes(attrText) {
  const attrs = {};
  const re = /([a-zA-Z_:-]+)="([^"]*)"/g;
  let match;
  while ((match = re.exec(attrText))) {
    attrs[match[1]] = match[2];
  }
  return attrs;
}

function safeNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function isLeo(attrs) {
  const altitude = safeNumber(attrs.altitude);
  const period = safeNumber(attrs.period);
  if (altitude !== null && altitude <= MAX_LEO_KM) return true;
  if (period !== null && period <= MAX_LEO_PERIOD_MIN) return true;
  return false;
}

function parseSatellites(xml) {
  const sats = [];
  const re = /<satellite\b([^>]*)\/>/g;
  let match;
  while ((match = re.exec(xml))) {
    const attrs = parseAttributes(match[1]);
    if (!attrs.id || !attrs.name) continue;
    if (isLeo(attrs)) {
      sats.push({ id: attrs.id, name: attrs.name });
    }
  }
  return sats;
}

function parseLatestTle(xml) {
  const elements = [];
  const re = /<element\b([^>]*)\/>/g;
  let match;
  while ((match = re.exec(xml))) {
    const attrs = parseAttributes(match[1]);
    if (attrs.one && attrs.two) {
      elements.push({ one: attrs.one.trim(), two: attrs.two.trim() });
    }
  }
  if (elements.length === 0) return null;
  return elements[elements.length - 1];
}

async function fetchText(url) {
  try {
    const maxTime = process.env.GHRC_TIMEOUT || '60';
    const { stdout } = await execFileAsync('curl', [
      '-L',
      '--fail',
      '--http1.1',
      '--retry-all-errors',
      '--retry',
      '5',
      '--connect-timeout',
      '10',
      '--max-time',
      maxTime,
      url
    ]);
    return stdout;
  } catch (curlErr) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      return await res.text();
    } catch (err) {
      const curlMsg = curlErr instanceof Error ? curlErr.message : String(curlErr);
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Fetch failed for ${url}: ${curlMsg}; ${msg}`);
    }
  }
}

async function fetchTextWithFallback(urls) {
  let lastErr;
  for (const url of urls) {
    try {
      return await fetchText(url);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('All fetch attempts failed.');
}

async function main() {
  const outPath = process.argv[2];
  if (!outPath) {
    console.error('Usage: node scripts/fetch_nasa_tle.mjs <output-file>');
    process.exit(1);
  }

  console.log('Fetching NASA GHRC satellite catalog...');
  const urls = buildUrls();
  const satXml = await fetchTextWithFallback(urls.satellites);
  const satellites = parseSatellites(satXml);
  console.log(`LEO satellites found: ${satellites.length}`);

  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const tleBlocks = [];

  for (let i = 0; i < satellites.length; i += 1) {
    const sat = satellites[i];
    const url = `${urls.elements[0]}?satid=${encodeURIComponent(
      sat.id
    )}&fromdate=${encodeURIComponent(now)}&thrudate=${encodeURIComponent(now)}`;
    let xml;
    try {
      xml = await fetchTextWithFallback([url, url.replace('https://', 'http://')]);
    } catch (err) {
      console.warn(`Skipping ${sat.name} (${sat.id}) - fetch failed`);
      continue;
    }
    const tle = parseLatestTle(xml);
    if (!tle) continue;
    tleBlocks.push(`${sat.name}\n${tle.one}\n${tle.two}`);

    if ((i + 1) % 20 === 0) {
      console.log(`Fetched ${i + 1}/${satellites.length} satellites...`);
    }
  }

  if (tleBlocks.length === 0) {
    throw new Error('No TLE data returned from GHRC.');
  }

  await writeFile(outPath, tleBlocks.join('\n'), 'utf8');
  console.log(`Wrote ${tleBlocks.length} TLEs to ${outPath}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
