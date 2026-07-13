import { createServer } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { applyRoomRequest, emptyRoom as createEmptyRoom, ensureRoom as ensureSharedRoom } from '../shared/roomLogic.mjs';

const root = process.cwd();
const dist = path.join(root, 'dist');
const dataDir = path.join(root, 'data');
const dataFile = path.join(dataDir, 'rooms.json');
const port = Number(process.env.PORT ?? 5173);
const host = process.env.HOST ?? '0.0.0.0';

const mimeTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'],
]);

function safePath(url) {
  const decoded = decodeURIComponent(url.split('?')[0] ?? '/');
  const normalized = path.normalize(decoded).replace(/^(\.\.[/\\])+/, '');
  return path.join(dist, normalized === '/' ? 'index.html' : normalized);
}

function emptyStore() {
  return { rooms: {} };
}

async function readStore() {
  try {
    return JSON.parse(await readFile(dataFile, 'utf8'));
  } catch {
    return emptyStore();
  }
}

async function writeStore(store) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(dataFile, JSON.stringify(store, null, 2), 'utf8');
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function sendJson(response, value, status = 200) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(value));
}

// The client talks to the same `/.netlify/functions/sync` endpoint in every
// mode; request handling is shared with the deployed function via roomLogic.mjs.
async function handleSync(request, response, url) {
  if (request.method === 'OPTIONS') return sendJson(response, { ok: true });

  const roomCode = String(url.searchParams.get('room') ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 48);
  const requestPath = String(url.searchParams.get('path') ?? '/');
  if (!roomCode) return sendJson(response, { error: 'Invalid room code' }, 400);

  const method = request.method ?? 'GET';
  const parts = requestPath.split('/').filter(Boolean).map(decodeURIComponent);
  const body = method === 'GET' || method === 'DELETE' ? {} : await readBody(request).catch(() => ({}));
  const store = await readStore();
  store.rooms ??= {};
  const room = ensureSharedRoom(store.rooms[roomCode] ?? createEmptyRoom());
  store.rooms[roomCode] = room;
  const result = applyRoomRequest({ room, method, parts, body });

  if (result.write) {
    await writeStore(store);
  }
  return sendJson(response, result.body, result.status);
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`);
    if (url.pathname === '/.netlify/functions/sync') {
      await handleSync(request, response, url);
      return;
    }

    const requested = safePath(request.url ?? '/');
    const filePath = existsSync(requested) && (await stat(requested)).isFile()
      ? requested
      : path.join(dist, 'index.html');
    const ext = path.extname(filePath);

    response.writeHead(200, {
      'Content-Type': mimeTypes.get(ext) ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    createReadStream(filePath).pipe(response);
  } catch (error) {
    sendJson(response, { error: error instanceof Error ? error.message : 'Server error' }, 500);
  }
});

server.listen(port, host, () => {
  console.log(`Serving http://127.0.0.1:${port}`);
});
