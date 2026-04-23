import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const source = resolve(root, 'node_modules', 'cesium', 'Build', 'Cesium');
const target = resolve(root, 'static', 'cesium');

if (!existsSync(source)) {
  console.error(`Cesium build assets not found at ${source}`);
  process.exit(1);
}

mkdirSync(resolve(root, 'static'), { recursive: true });
rmSync(target, { recursive: true, force: true });
cpSync(source, target, { recursive: true });

console.log(`Synced Cesium assets to ${target}`);
