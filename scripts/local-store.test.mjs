import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readJsonFileOrDefault, writeJsonFileAtomic } from './local-store.mjs';

const temporaryDirectories = [];

async function temporaryFile() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'memory-store-'));
  temporaryDirectories.push(directory);
  return { directory, file: path.join(directory, 'rooms.json') };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('local JSON store durability', () => {
  it('uses an empty store only when the file does not exist', async () => {
    const { file } = await temporaryFile();
    await expect(readJsonFileOrDefault(file, () => ({ rooms: {} }))).resolves.toEqual({ rooms: {} });
  });

  it('fails closed on corrupt JSON instead of replacing it with an empty store', async () => {
    const { file } = await temporaryFile();
    await writeFile(file, '{"rooms":', 'utf8');

    await expect(readJsonFileOrDefault(file, () => ({ rooms: {} }))).rejects.toThrow();
    await expect(readFile(file, 'utf8')).resolves.toBe('{"rooms":');
  });

  it('atomically replaces the JSON file without leaving temporary files', async () => {
    const { directory, file } = await temporaryFile();
    await writeJsonFileAtomic(file, { rooms: { A: { revision: 1 } } });

    await expect(readJsonFileOrDefault(file, () => null)).resolves.toEqual({ rooms: { A: { revision: 1 } } });
    await expect(readdir(directory)).resolves.toEqual(['rooms.json']);
  });
});
