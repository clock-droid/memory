import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const outputDirectory = dirname(fileURLToPath(import.meta.url));
const port = 4179;
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const finalName = 'exam-memorizer-cloze-promo-vertical-25s.mp4';

await mkdir(outputDirectory, { recursive: true });

let chrome;
let resolveFinished;
let rejectFinished;
const finished = new Promise((resolve, reject) => {
  resolveFinished = resolve;
  rejectFinished = reject;
});

function sendFile(response, filePath, contentType) {
  response.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
  createReadStream(filePath).pipe(response);
}

const server = createServer((request, response) => {
  const url = new URL(request.url, `http://127.0.0.1:${port}`);

  if (request.method === 'GET' && url.pathname === '/promo-v2.html') {
    sendFile(response, join(outputDirectory, 'promo-v2.html'), 'text/html; charset=utf-8');
    return;
  }

  if (request.method === 'POST' && url.pathname === '/save') {
    const name = url.searchParams.get('name') ?? '';
    if (!/^(preview-\d{2}\.png|exam-memorizer-cloze-promo-vertical-25s\.mp4)$/.test(name)) {
      response.writeHead(400).end('Invalid output name');
      return;
    }
    const outputPath = join(outputDirectory, name);
    const file = createWriteStream(outputPath);
    request.pipe(file);
    file.on('finish', () => {
      response.writeHead(200, { 'Content-Type': 'text/plain' }).end('saved');
      console.log(`saved ${outputPath}`);
      if (name === finalName) resolveFinished(outputPath);
    });
    file.on('error', rejectFinished);
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

await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
console.log(`renderer listening on http://127.0.0.1:${port}/promo-v2.html`);

chrome = spawn(chromePath, [
  '--headless=new',
  '--no-sandbox',
  '--autoplay-policy=no-user-gesture-required',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--hide-scrollbars',
  '--window-size=1080,1920',
  `--user-data-dir=/private/tmp/memory-promo-v2-chrome-${process.pid}`,
  `http://127.0.0.1:${port}/promo-v2.html`,
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
  await new Promise((resolve) => server.close(resolve));
}
