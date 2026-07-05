import { build } from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const dist = path.join(root, 'dist');
const assets = path.join(dist, 'assets');

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

await build({
  entryPoints: [path.join(root, 'src/main.tsx')],
  bundle: true,
  outfile: path.join(assets, 'main.js'),
  format: 'esm',
  target: ['chrome107', 'edge107', 'firefox104', 'safari16'],
  minify: true,
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

const html = await readFile(path.join(root, 'index.html'), 'utf8');
await writeFile(
  path.join(dist, 'index.html'),
  html.replace(
    '<script type="module" src="/src/main.tsx"></script>',
    '<link rel="stylesheet" href="/assets/main.css" />\n    <script type="module" src="/assets/main.js"></script>',
  ),
);

console.log('Built dist with esbuild.');
