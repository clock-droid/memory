import { getStore } from '@netlify/blobs';
import { applyRoomRequest, emptyRoom, ensureRoom } from '../../shared/roomLogic.mjs';

const MAX_ATTEMPTS = 5;

function json(body, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
    },
  });
}

export default async function sync(request) {
  if (request.method === 'OPTIONS') return json({ ok: true });

  const url = new URL(request.url);
  const roomCode = String(url.searchParams.get('room') ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 48);
  const path = String(url.searchParams.get('path') ?? '/');
  if (!roomCode) return json({ error: 'Invalid room code' }, 400);

  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  const method = request.method;
  const body = method === 'GET' || method === 'DELETE' ? {} : await request.json().catch(() => ({}));
  const store = getStore('exam-memorizer-rooms');

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const entry = await store.getWithMetadata(roomCode, { type: 'json', consistency: 'strong' });
    const room = ensureRoom(entry?.data ?? emptyRoom());
    const result = applyRoomRequest({ room, method, parts, body });
    if (!result.write) return json(result.body, result.status);

    const write = entry?.etag
      ? await store.setJSON(roomCode, room, { onlyIfMatch: entry.etag })
      : await store.setJSON(roomCode, room, { onlyIfNew: true });
    if (write.modified) return json(result.body, result.status);
  }

  return json({ error: 'conflict' }, 409);
}
