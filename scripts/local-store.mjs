import { mkdir, open, readFile, rename } from 'node:fs/promises';
import path from 'node:path';

export async function readJsonFileOrDefault(filePath, createDefault) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return createDefault();
    // Corrupt JSON and transient I/O failures must fail closed. Treating them
    // as an empty store would let the next mutation overwrite recoverable data.
    throw error;
  }
}

export async function writeJsonFileAtomic(filePath, value) {
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true });
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const temporaryPath = path.join(directory, `.${path.basename(filePath)}.${suffix}.tmp`);
  const file = await open(temporaryPath, 'wx');
  try {
    await file.writeFile(JSON.stringify(value, null, 2), 'utf8');
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(temporaryPath, filePath);
  // Persist the directory entry as well as the file contents. If this sync is
  // unsupported, surface the failure; the idempotent request can be retried.
  const directoryHandle = await open(directory, 'r');
  try {
    await directoryHandle.sync();
  } finally {
    await directoryHandle.close();
  }
}
