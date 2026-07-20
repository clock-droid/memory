import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { renderServiceWorker } from './service-worker.mjs';

const root = process.cwd();

async function renderTestWorker(overrides = {}) {
  const template = await readFile(path.join(root, 'public', 'sw.js'), 'utf8');
  return renderServiceWorker(template, [
    { url: '/index.html', contents: Buffer.from(overrides.html ?? '<main>app</main>') },
    { url: '/assets/main-A1B2C3D4.js', contents: Buffer.from(overrides.javascript ?? 'startApp()') },
    { url: '/assets/main-E5F6G7H8.css', contents: Buffer.from('body{}') },
  ]);
}

function runWorker(source, { fetchImpl = vi.fn(), cacheOverrides = {} } = {}) {
  const listeners = new Map();
  const cache = {
    addAll: vi.fn(async () => undefined),
    match: vi.fn(async () => undefined),
    ...cacheOverrides,
  };
  const caches = {
    open: vi.fn(async () => cache),
    keys: vi.fn(async () => []),
    delete: vi.fn(async () => true),
  };
  const self = {
    location: { origin: 'https://memory.test' },
    clients: { claim: vi.fn(async () => undefined) },
    skipWaiting: vi.fn(async () => undefined),
    addEventListener: vi.fn((type, listener) => listeners.set(type, listener)),
  };

  vm.runInNewContext(source, {
    URL,
    Request,
    caches,
    fetch: fetchImpl,
    self,
    Set,
  });

  return { cache, caches, listeners, self };
}

describe('service worker generation', () => {
  it('injects a deterministic content version and the complete asset list', async () => {
    const first = await renderTestWorker();
    const second = await renderTestWorker();

    expect(first.version).toMatch(/^[a-f0-9]{16}$/);
    expect(second.version).toBe(first.version);
    expect(first.urls).toEqual([
      '/index.html',
      '/assets/main-A1B2C3D4.js',
      '/assets/main-E5F6G7H8.css',
    ]);
    expect(first.source).not.toContain('__BUILD_VERSION__');
    expect(first.source).not.toContain('__PRECACHE_URLS__');
  });

  it('changes the cache version whenever a built asset changes', async () => {
    const previous = await renderTestWorker({ javascript: 'startApp()' });
    const next = await renderTestWorker({ javascript: 'startUpdatedApp()' });

    expect(next.version).not.toBe(previous.version);
  });

  it('changes the cache version whenever worker behavior changes', async () => {
    const template = await readFile(path.join(root, 'public', 'sw.js'), 'utf8');
    const assets = [{ url: '/index.html', contents: Buffer.from('<main>app</main>') }];
    const previous = renderServiceWorker(template, assets);
    const next = renderServiceWorker(`${template}\n// lifecycle behavior changed`, assets);

    expect(next.version).not.toBe(previous.version);
  });
});

describe('service worker request handling', () => {
  it('bypasses the HTTP cache while precaching every build asset', async () => {
    const { source, urls } = await renderTestWorker();
    const { cache, listeners, self } = runWorker(source);
    const waitUntil = vi.fn();

    listeners.get('install')({ waitUntil });
    await waitUntil.mock.calls[0][0];

    expect(cache.addAll).toHaveBeenCalledOnce();
    const requests = cache.addAll.mock.calls[0][0];
    expect(requests.map((request) => new URL(request.url).pathname)).toEqual(urls);
    expect(requests.every((request) => request.cache === 'reload')).toBe(true);
    expect(self.skipWaiting).toHaveBeenCalledOnce();
  });

  it('falls back to cached HTML only for navigation requests', async () => {
    const { source } = await renderTestWorker();
    const offline = new Error('offline');
    const fallback = { kind: 'cached-index' };
    const fetchImpl = vi.fn(async () => { throw offline; });
    const { cache, listeners } = runWorker(source, {
      fetchImpl,
      cacheOverrides: {
        match: vi.fn(async (request) => (request === '/index.html' ? fallback : undefined)),
      },
    });
    const respondWith = vi.fn();

    listeners.get('fetch')({
      request: {
        method: 'GET',
        mode: 'navigate',
        url: 'https://memory.test/decks/current',
      },
      respondWith,
    });

    expect(respondWith).toHaveBeenCalledOnce();
    await expect(respondWith.mock.calls[0][0]).resolves.toBe(fallback);
    expect(cache.match).toHaveBeenCalledWith('/index.html', { ignoreSearch: true });
  });

  it('uses the cached shell when the host returns a temporary server error', async () => {
    const { source } = await renderTestWorker();
    const fallback = { kind: 'cached-index' };
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 503 }));
    const { listeners } = runWorker(source, {
      fetchImpl,
      cacheOverrides: {
        match: vi.fn(async (request) => (request === '/index.html' ? fallback : undefined)),
      },
    });
    const respondWith = vi.fn();

    listeners.get('fetch')({
      request: { method: 'GET', mode: 'navigate', url: 'https://memory.test/' },
      respondWith,
    });

    await expect(respondWith.mock.calls[0][0]).resolves.toBe(fallback);
  });

  it('preserves a genuine navigation 404 instead of hiding it behind the app shell', async () => {
    const { source } = await renderTestWorker();
    const notFound = { ok: false, status: 404 };
    const fetchImpl = vi.fn(async () => notFound);
    const { cache, listeners } = runWorker(source, { fetchImpl });
    const respondWith = vi.fn();

    listeners.get('fetch')({
      request: { method: 'GET', mode: 'navigate', url: 'https://memory.test/missing' },
      respondWith,
    });

    await expect(respondWith.mock.calls[0][0]).resolves.toBe(notFound);
    expect(cache.match).not.toHaveBeenCalled();
  });

  it('does not replace unknown static-asset or API failures with HTML', async () => {
    const { source } = await renderTestWorker();
    const { listeners } = runWorker(source);

    for (const request of [
      { method: 'GET', mode: 'cors', url: 'https://memory.test/assets/main.js' },
      { method: 'GET', mode: 'cors', url: 'https://memory.test/assets/missing.js' },
      { method: 'GET', mode: 'cors', url: 'https://memory.test/.netlify/functions/sync' },
    ]) {
      const respondWith = vi.fn();
      listeners.get('fetch')({ request, respondWith });
      expect(respondWith).not.toHaveBeenCalled();
    }
  });

  it('serves known build assets from the current version cache', async () => {
    const { source } = await renderTestWorker();
    const cachedAsset = { kind: 'cached-main-js' };
    const { cache, listeners } = runWorker(source, {
      cacheOverrides: { match: vi.fn(async () => cachedAsset) },
    });
    const request = {
      method: 'GET',
      mode: 'cors',
      url: 'https://memory.test/assets/main-A1B2C3D4.js?cache-bust=1',
    };
    const respondWith = vi.fn();

    listeners.get('fetch')({ request, respondWith });

    expect(respondWith).toHaveBeenCalledOnce();
    await expect(respondWith.mock.calls[0][0]).resolves.toBe(cachedAsset);
    expect(cache.match).toHaveBeenCalledWith(request, { ignoreSearch: true });
  });

  it('keeps the previous worker active when precaching fails', async () => {
    const { source } = await renderTestWorker();
    const installError = new Error('asset unavailable');
    const { caches, listeners, self } = runWorker(source, {
      cacheOverrides: { addAll: vi.fn(async () => { throw installError; }) },
    });
    const waitUntil = vi.fn();

    listeners.get('install')({ waitUntil });

    await expect(waitUntil.mock.calls[0][0]).rejects.toThrow('asset unavailable');
    expect(caches.delete).toHaveBeenCalledOnce();
    expect(self.skipWaiting).not.toHaveBeenCalled();
  });

  it('removes only obsolete caches owned by this app', async () => {
    const { source, version } = await renderTestWorker();
    const current = `exam-memorizer-${version}`;
    const { caches, listeners, self } = runWorker(source);
    caches.keys.mockResolvedValue([current, 'exam-memorizer-v3', 'another-app-cache']);
    const waitUntil = vi.fn();

    listeners.get('activate')({ waitUntil });
    await waitUntil.mock.calls[0][0];

    expect(caches.delete).toHaveBeenCalledTimes(1);
    expect(caches.delete).toHaveBeenCalledWith('exam-memorizer-v3');
    expect(self.clients.claim).toHaveBeenCalledOnce();
  });
});
