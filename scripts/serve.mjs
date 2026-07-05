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
const clientsByRoom = new Map();

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

function id(prefix) {
  return `${prefix}_${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
}

function defaultSection(now = Date.now()) {
  return { id: 'default', name: '기본', sourceText: '', createdAt: now, updatedAt: now };
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

function ensureRoom(store, roomCode) {
  const now = Date.now();
  store.rooms[roomCode] ??= { decks: [], cardsByDeck: {}, sectionsByDeck: {} };
  const room = store.rooms[roomCode];
  room.cardsByDeck ??= {};
  room.sectionsByDeck ??= {};
  if (!room.decks.some((deck) => deck.id === 'default')) {
    room.decks.push({ id: 'default', name: '기본 암기장', createdAt: now, updatedAt: now });
  }
  room.cardsByDeck.default ??= [];
  if (!room.sectionsByDeck.default?.length) {
    room.sectionsByDeck.default = [defaultSection(now)];
  }
  return room;
}

function ensureDeck(room, deckId) {
  room.cardsByDeck[deckId] ??= [];
  if (!room.sectionsByDeck[deckId]?.length) {
    room.sectionsByDeck[deckId] = [defaultSection()];
  }
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

function sendNotFound(response) {
  sendJson(response, { error: 'Not found' }, 404);
}

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
    notify(roomCode);
  }
  return sendJson(response, result.body, result.status);
}

function notify(roomCode) {
  const clients = clientsByRoom.get(roomCode);
  if (!clients) return;
  const payload = `event: change\ndata: ${Date.now()}\n\n`;
  for (const response of clients) response.write(payload);
}

async function handleApi(request, response, url) {
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (url.pathname === '/api/health') return sendJson(response, { ok: true });
  if (parts[0] !== 'api' || parts[1] !== 'rooms' || !parts[2]) return sendNotFound(response);

  const roomCode = parts[2].replace(/[^A-Za-z0-9_-]/g, '').slice(0, 48);
  if (!roomCode) return sendJson(response, { error: 'Invalid room code' }, 400);

  if (parts[3] === 'events') {
    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    response.write('event: change\ndata: connected\n\n');
    const clients = clientsByRoom.get(roomCode) ?? new Set();
    clients.add(response);
    clientsByRoom.set(roomCode, clients);
    request.on('close', () => clients.delete(response));
    return;
  }

  const store = await readStore();
  const room = ensureRoom(store, roomCode);
  const method = request.method ?? 'GET';
  const deckId = parts[4];
  const sectionId = parts[6];

  if (method === 'POST' && parts[3] === 'ensure') {
    await writeStore(store);
    notify(roomCode);
    return sendJson(response, { ok: true });
  }

  if (method === 'GET' && parts[3] === 'decks' && parts.length === 4) {
    return sendJson(response, room.decks);
  }

  if (method === 'POST' && parts[3] === 'decks' && parts.length === 4) {
    const body = await readBody(request);
    const now = Date.now();
    const nextDeck = { id: id('deck'), name: String(body.name || '새 암기장'), createdAt: now, updatedAt: now };
    room.decks.push(nextDeck);
    room.cardsByDeck[nextDeck.id] = [];
    room.sectionsByDeck[nextDeck.id] = [defaultSection(now)];
    await writeStore(store);
    notify(roomCode);
    return sendJson(response, { id: nextDeck.id });
  }

  if (parts[3] === 'decks' && deckId && parts.length === 5) {
    if (method === 'PATCH') {
      const body = await readBody(request);
      room.decks = room.decks.map((deck) =>
        deck.id === deckId ? { ...deck, name: String(body.name || deck.name), updatedAt: Date.now() } : deck,
      );
      await writeStore(store);
      notify(roomCode);
      return sendJson(response, { ok: true });
    }
    if (method === 'DELETE') {
      room.decks = room.decks.filter((deck) => deck.id !== deckId);
      delete room.cardsByDeck[deckId];
      delete room.sectionsByDeck[deckId];
      await writeStore(store);
      notify(roomCode);
      return sendJson(response, { ok: true });
    }
  }

  if (parts[3] === 'decks' && deckId && parts[5] === 'cards') {
    ensureDeck(room, deckId);
    if (method === 'GET' && parts.length === 6) return sendJson(response, room.cardsByDeck[deckId]);
    if (method === 'PATCH' && parts[6]) {
      const body = await readBody(request);
      const hasStarred = Object.prototype.hasOwnProperty.call(body, 'starred');
      const hasMastered = Object.prototype.hasOwnProperty.call(body, 'mastered');
      room.cardsByDeck[deckId] = room.cardsByDeck[deckId].map((card) =>
        card.id === parts[6]
          ? {
              ...card,
              ...(hasStarred ? { starred: Boolean(body.starred), mastered: body.starred ? false : card.mastered } : {}),
              ...(hasMastered ? { mastered: Boolean(body.mastered), starred: body.mastered ? false : card.starred } : {}),
              updatedAt: Date.now(),
            }
          : card,
      );
      await writeStore(store);
      notify(roomCode);
      return sendJson(response, { ok: true });
    }
  }

  if (parts[3] === 'decks' && deckId && parts[5] === 'sections') {
    ensureDeck(room, deckId);
    if (method === 'GET' && parts.length === 6) return sendJson(response, room.sectionsByDeck[deckId]);
    if (method === 'POST' && parts.length === 6) {
      const body = await readBody(request);
      const now = Date.now();
      const nextSection = {
        id: id('section'),
        name: String(body.name || '새 세부 목록'),
        sourceText: '',
        createdAt: now,
        updatedAt: now,
      };
      room.sectionsByDeck[deckId].push(nextSection);
      await writeStore(store);
      notify(roomCode);
      return sendJson(response, { id: nextSection.id });
    }
    if (sectionId && method === 'PATCH' && parts.length === 7) {
      const body = await readBody(request);
      room.sectionsByDeck[deckId] = room.sectionsByDeck[deckId].map((section) =>
        section.id === sectionId ? { ...section, name: String(body.name || section.name), updatedAt: Date.now() } : section,
      );
      await writeStore(store);
      notify(roomCode);
      return sendJson(response, { ok: true });
    }
    if (sectionId && method === 'DELETE' && parts.length === 7) {
      room.sectionsByDeck[deckId] = room.sectionsByDeck[deckId].filter((section) => section.id !== sectionId);
      room.cardsByDeck[deckId] = room.cardsByDeck[deckId].filter((card) => (card.sectionId ?? 'default') !== sectionId);
      await writeStore(store);
      notify(roomCode);
      return sendJson(response, { ok: true });
    }
    if (sectionId && method === 'PUT' && parts[7] === 'content') {
      const body = await readBody(request);
      const now = Date.now();
      const sourceText = String(body.sourceText ?? '');
      const cards = Array.isArray(body.cards) ? body.cards : [];
      room.sectionsByDeck[deckId] = room.sectionsByDeck[deckId].map((section) =>
        section.id === sectionId ? { ...section, sourceText, updatedAt: now } : section,
      );
      room.cardsByDeck[deckId] = [
        ...room.cardsByDeck[deckId].filter((card) => (card.sectionId ?? 'default') !== sectionId),
        ...cards.map((card) => ({ ...card, sectionId, id: id('card'), createdAt: now, updatedAt: now })),
      ];
      await writeStore(store);
      notify(roomCode);
      return sendJson(response, { ok: true });
    }
  }

  return sendNotFound(response);
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`);
    if (url.pathname === '/.netlify/functions/sync') {
      await handleSync(request, response, url);
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      await handleApi(request, response, url);
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
