import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { json } from '@sveltejs/kit';

function cleanValue(value: unknown) {
  return String(value ?? 'unknown').replace(/[\r\n]/g, ' ').trim();
}

export async function POST({ request }) {
  const body = await request.json().catch(() => ({}));
  const timestamp = new Date().toISOString();
  const highPerformance = body.highPerformance === true;
  const source = cleanValue(body.source);
  const vendor = cleanValue(body.vendor);
  const renderer = cleanValue(body.renderer);

  const content = [
    `timestamp=${timestamp}`,
    `high-performance ${highPerformance ? 'true' : 'false'}`,
    `source=${source}`,
    `vendor=${vendor}`,
    `renderer=${renderer}`,
    ''
  ].join('\n');

  await writeFile(resolve(process.cwd(), 'test.txt'), content, 'utf8');

  return json({
    ok: true,
    timestamp,
    highPerformance
  });
}
