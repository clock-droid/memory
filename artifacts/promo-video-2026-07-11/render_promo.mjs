import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, '../..');
const outputDirectory = scriptDirectory;
const port = 4178;
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const assets = new Map([
  ['/assets/home.png', join(projectRoot, 'artifacts/ux-audit-2026-07-11/08-home-mobile.png')],
  ['/assets/add.png', join(projectRoot, 'artifacts/ux-audit-2026-07-11/10-add-entry-mobile.png')],
  ['/assets/hidden.png', join(projectRoot, 'artifacts/ux-audit-2026-07-11/06-study-hidden.png')],
  ['/assets/revealed.png', join(projectRoot, 'artifacts/ux-audit-2026-07-11/07-study-revealed.png')],
]);

await mkdir(outputDirectory, { recursive: true });

let chrome;
let resolveFinished;
let rejectFinished;
const finished = new Promise((resolvePromise, rejectPromise) => {
  resolveFinished = resolvePromise;
  rejectFinished = rejectPromise;
});

function sendFile(response, filePath, contentType) {
  response.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
  createReadStream(filePath).pipe(response);
}

const server = createServer((request, response) => {
  const url = new URL(request.url, `http://127.0.0.1:${port}`);

  if (request.method === 'GET' && url.pathname === '/promo.html') {
    sendFile(response, join(scriptDirectory, 'promo.html'), 'text/html; charset=utf-8');
    return;
  }

  if (request.method === 'GET' && assets.has(url.pathname)) {
    sendFile(response, assets.get(url.pathname), 'image/png');
    return;
  }

  if (request.method === 'POST' && url.pathname === '/save') {
    const name = url.searchParams.get('name') ?? '';
    if (!/^(preview-\d{2}\.png|exam-memorizer-promo-vertical-30s\.mp4)$/.test(name)) {
      response.writeHead(400).end('Invalid output name');
      return;
    }
    const outputPath = join(outputDirectory, name);
    const file = createWriteStream(outputPath);
    request.pipe(file);
    file.on('finish', () => {
      response.writeHead(200, { 'Content-Type': 'text/plain' }).end('saved');
      console.log(`saved ${outputPath}`);
      if (name.endsWith('.mp4')) resolveFinished(outputPath);
    });
    file.on('error', (error) => rejectFinished(error));
    return;
  }

  if (request.method === 'POST' && url.pathname === '/error') {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const message = Buffer.concat(chunks).toString('utf8');
      response.writeHead(200).end('reported');
      rejectFinished(new Error(message));
    });
    return;
  }

  response.writeHead(404).end('Not found');
});

await new Promise((resolvePromise) => server.listen(port, '127.0.0.1', resolvePromise));
console.log(`renderer listening on http://127.0.0.1:${port}/promo.html`);

const chromeProfile = `/private/tmp/memory-promo-chrome-${process.pid}`;
chrome = spawn(chromePath, [
  '--headless=new',
  '--no-sandbox',
  '--autoplay-policy=no-user-gesture-required',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--hide-scrollbars',
  '--window-size=1080,1920',
  `--user-data-dir=${chromeProfile}`,
  `http://127.0.0.1:${port}/promo.html`,
], { stdio: ['ignore', 'inherit', 'inherit'] });

chrome.on('error', rejectFinished);
chrome.on('exit', (code) => {
  if (code && code !== 0) rejectFinished(new Error(`Chrome exited with code ${code}`));
});

try {
  const outputPath = await finished;
  console.log(`render complete: ${outputPath}`);
} finally {
  chrome?.kill('SIGTERM');
  await new Promise((resolvePromise) => server.close(resolvePromise));
}
