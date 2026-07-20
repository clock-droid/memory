import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const STATIC_APP_SHELL_FILES = [
  'index.html',
  'manifest.webmanifest',
  'icon.svg',
  'icon-180.png',
  'icon-192.png',
  'icon-512.png',
  'icon-512-maskable.png',
];

const VERSION_PLACEHOLDER = '__BUILD_VERSION__';
const URLS_PLACEHOLDER = '__PRECACHE_URLS__';

function assertSinglePlaceholder(template, placeholder) {
  const occurrences = template.split(placeholder).length - 1;
  if (occurrences !== 1) {
    throw new Error(`Expected exactly one ${placeholder} placeholder, found ${occurrences}.`);
  }
}

export function renderServiceWorker(template, assets) {
  assertSinglePlaceholder(template, VERSION_PLACEHOLDER);
  assertSinglePlaceholder(template, URLS_PLACEHOLDER);

  const hash = createHash('sha256');
  // A worker-only change must also receive a fresh cache. Otherwise a failed
  // installation could delete the cache still used by the previous worker.
  hash.update('service-worker-template');
  hash.update('\0');
  hash.update(template);
  hash.update('\0');
  for (const { url, contents } of assets) {
    hash.update(url);
    hash.update('\0');
    hash.update(contents);
    hash.update('\0');
  }

  const version = hash.digest('hex').slice(0, 16);
  const urls = assets.map(({ url }) => url);
  const source = template
    .replace(VERSION_PLACEHOLDER, version)
    .replace(URLS_PLACEHOLDER, JSON.stringify(urls));

  return { source, version, urls };
}

export async function writeServiceWorker({ root, dist, builtAssetFiles }) {
  const template = await readFile(path.join(root, 'public', 'sw.js'), 'utf8');
  const appShellFiles = [
    STATIC_APP_SHELL_FILES[0],
    ...builtAssetFiles,
    ...STATIC_APP_SHELL_FILES.slice(1),
  ];
  const assets = await Promise.all(
    appShellFiles.map(async (fileName) => ({
      url: `/${fileName}`,
      contents: await readFile(path.join(dist, fileName)),
    })),
  );
  const rendered = renderServiceWorker(template, assets);
  await writeFile(path.join(dist, 'sw.js'), rendered.source, 'utf8');
  return rendered;
}
