// Parsley Time — Node.js host (local development, tests, or any Node server).
// For Cloudflare, src/worker.js is used instead; both share src/app.js.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './src/app.js';
import { openNodeDb } from './src/node-db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.ico': 'image/x-icon' };

export function createServer({ dataDir = process.env.DATA_DIR || path.join(__dirname, 'data'), timezone = process.env.APP_TIMEZONE || 'Asia/Taipei', adminPassword = process.env.ADMIN_PASSWORD } = {}) {
  const db = openNodeDb(dataDir);
  const app = createApp({ db, timezone, adminPassword });

  const server = http.createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = chunks.length && req.method !== 'GET' && req.method !== 'HEAD' ? Buffer.concat(chunks) : undefined;
      const proto = req.headers['x-forwarded-proto'] || 'http';
      const request = new Request(`${proto}://${req.headers.host || 'localhost'}${req.url}`, { method: req.method, headers: req.headers, body });
      const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
      const response = await app.handle(request, { ip });
      if (response) {
        res.writeHead(response.status, Object.fromEntries(response.headers));
        return res.end(Buffer.from(await response.arrayBuffer()));
      }
      serveStatic(req, res);
    } catch (err) {
      console.error(err);
      if (!res.headersSent) { res.writeHead(500); res.end('Server error'); }
    }
  });
  return { server, app, db };
}

function serveStatic(req, res) {
  let pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (pathname === '/') pathname = '/index.html';
  if (pathname === '/admin' || pathname === '/admin/') pathname = '/admin.html';
  const file = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' }); return fs.createReadStream(path.join(PUBLIC_DIR, '404.html')).pipe(res); }
    const ext = path.extname(file);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': ext === '.html' || pathname === '/sw.js' ? 'no-cache' : 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff' });
    fs.createReadStream(file).pipe(res);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  const { server, app } = createServer();
  await app.ready();
  server.listen(port, () => console.log(`[parsley] Time tracker on http://localhost:${port}  (admin: /admin)`));
}
