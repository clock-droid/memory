import { build } from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  ASSET_NAME_TEMPLATE,
  CHUNK_NAME_TEMPLATE,
  ENTRY_NAME_TEMPLATE,
  injectRuntimeAssets,
  resolveBuildOutputs,
} from './build-output.mjs';
import { writeServiceWorker } from './service-worker.mjs';

const root = process.cwd();
const dist = path.join(root, 'dist');
const assets = path.join(dist, 'assets');
const entryPoint = path.join(root, 'src/main.tsx');

function readEnvFile(fileName) {
  const filePath = path.join(root, fileName);
  if (!existsSync(filePath)) return {};
  return Object.fromEntries(
    readFileSync(filePath, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const index = line.indexOf('=');
        const key = line.slice(0, index).trim();
        const value = line.slice(index + 1).trim().replace(/^["']|["']$/g, '');
        return [key, value];
      }),
  );
}

const env = { ...readEnvFile('.env'), ...process.env };
const firebaseKeys = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
];
const envKeys = [...firebaseKeys, 'VITE_SYNC_BASE'];

await rm(dist, { recursive: true, force: true });
await mkdir(assets, { recursive: true });
await cp(path.join(root, 'public'), dist, { recursive: true });

const buildResult = await build({
  entryPoints: [entryPoint],
  bundle: true,
  outdir: dist,
  entryNames: ENTRY_NAME_TEMPLATE,
  chunkNames: CHUNK_NAME_TEMPLATE,
  assetNames: ASSET_NAME_TEMPLATE,
  format: 'esm',
  target: ['chrome107', 'edge107', 'firefox104', 'safari16'],
  minify: true,
  metafile: true,
  sourcemap: false,
  loader: {
    '.ts': 'ts',
    '.tsx': 'tsx',
    '.css': 'css',
  },
  define: Object.fromEntries(
    envKeys.map((key) => [`import.meta.env.${key}`, JSON.stringify(env[key] ?? '')]),
  ),
});

const buildOutputs = resolveBuildOutputs({
  metafile: buildResult.metafile,
  root,
  dist,
  entryPoint,
});

const html = await readFile(path.join(root, 'index.html'), 'utf8');
await writeFile(
  path.join(dist, 'index.html'),
  injectRuntimeAssets(html, buildOutputs),
);

const serviceWorker = await writeServiceWorker({
  root,
  dist,
  builtAssetFiles: buildOutputs.assetFiles,
});

console.log(`Built dist with esbuild (app shell ${serviceWorker.version}).`);
