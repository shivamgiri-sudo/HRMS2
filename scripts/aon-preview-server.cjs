/**
 * Local preview server: serves the production build and proxies the API.
 *
 * One process on 127.0.0.1:8080 that
 *   - serves ./dist (the real `vite build` output, so what you see is what ships), with the
 *     SPA fallback every client-side route needs, and
 *   - forwards /api/* to the deployed backend.
 *
 * Why not `vite` dev: on this machine the dev server hangs at "Re-optimizing dependencies"
 * and never starts listening - reproduced with the project's own unmodified vite.config.ts,
 * so it is environmental rather than caused by any config here. `vite build` is unaffected.
 *
 * Why not run backend/src/server.ts: booting it starts the whole production runtime locally
 * (around forty schedulers and workers - payroll recalc drainer, leave credit, attendance
 * reconciliation, mobility transfer, COSEC sync) and backend/.env points at the live
 * mas_hrms. No flag starts the API without them, so a local boot would run a second copy of
 * production's crons against production data, and runPendingMigrations() runs at startup by
 * default.
 *
 * READ-ONLY BY INTENT: a local UI pointed at live data. Viewing is safe; anything that
 * writes in this session writes to production.
 *
 * Usage:  node scripts/aon-preview-server.cjs      then open http://localhost:8080
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const TARGET = process.env.AON_PREVIEW_API || 'mcnhrms.teammas.in';
/**
 * Optional: connect straight to this IP instead of resolving TARGET.
 *
 * The TLS handshake still presents TARGET as the SNI servername and the Host header still
 * says TARGET, so the certificate validates normally - pinning the address changes only
 * which socket is opened, not what the server thinks it is being asked for. Without the SNI
 * override, dialling an IP over HTTPS fails certificate validation against the hostname.
 */
const TARGET_IP = process.env.AON_PREVIEW_API_IP || '';
const PORT = Number(process.env.AON_PREVIEW_PORT || 8080);
const DIST = path.resolve(__dirname, '..', 'dist');

if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error(`[preview] no build found at ${DIST} - run "npx vite build" first`);
  process.exit(1);
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.map': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
};

function proxyApi(req, res) {
  const headers = { ...req.headers, host: TARGET };
  // Hop-by-hop headers must not be forwarded, and an inherited accept-encoding would come
  // back compressed for a body we pass straight through.
  delete headers['accept-encoding'];
  delete headers.connection;
  // Strip conditional-request headers so upstream always answers 200 with a full body.
  //
  // Without this the browser revalidates against its own cache and upstream replies 304 Not
  // Modified, which by definition carries NO body. That is correct HTTP and fine for a
  // normal same-origin app, but through this preview proxy it produced pages of empty cards:
  // the client received a bodyless response and had nothing to parse. Forcing 200s costs a
  // little bandwidth on a local preview and removes a whole class of confusing blank-UI.
  delete headers['if-none-match'];
  delete headers['if-modified-since'];

  const started = Date.now();
  const upstream = https.request(
    {
      hostname: TARGET_IP || TARGET,
      servername: TARGET,            // SNI + cert validation stay on the hostname
      port: 443,
      path: req.url,
      method: req.method,
      headers,                       // headers.host is already TARGET
    },
    (up) => {
      // Log every API call with its upstream status. Without this the only way to tell a
      // working page from one silently rendering empty cards is to look over someone's
      // shoulder - and a 200 that returns zero rows looks identical to a 500 from here.
      const status = up.statusCode || 0;
      const mark = status >= 500 ? '!!' : status >= 400 ? ' !' : '  ';
      res.writeHead(status || 502, up.headers);

      // Count the bytes and, for report calls, the row count. A 200 carrying zero rows looks
      // identical to a healthy one from the status line alone, and "empty boxes" is exactly
      // what that produces on screen - so measure the payload rather than infer it.
      let bytes = 0;
      let body = '';
      const isReport = /\/api\/reports\/suite\//.test(req.url || '');
      up.on('data', (chunk) => {
        bytes += chunk.length;
        if (isReport && body.length < 400000) body += chunk.toString('utf8');
      });
      up.on('end', () => {
        let detail = `${bytes}B`;
        if (isReport && body) {
          try {
            const parsed = JSON.parse(body);
            const rows = parsed?.data?.rows ?? parsed?.rows ?? parsed?.data;
            if (Array.isArray(rows)) detail += `, rows=${rows.length}`;
            else detail += `, keys=[${Object.keys(parsed || {}).slice(0, 6).join(',')}]`;
          } catch { detail += ', unparseable'; }
        }
        console.log(`[api]${mark} ${status} ${req.method} ${req.url} (${Date.now() - started}ms, ${detail})`);
      });
      up.pipe(res);
    }
  );
  upstream.on('error', (err) => {
    console.error(`[preview] ${req.method} ${req.url} -> ${err.message}`);
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: 'upstream unreachable', detail: err.message }));
  });
  req.pipe(upstream);
}

function sendFile(res, filePath) {
  res.writeHead(200, {
    'content-type': TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
    'cache-control': 'no-store',
  });
  fs.createReadStream(filePath).pipe(res);
}

http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  if (url.startsWith('/api/')) return proxyApi(req, res);

  // Resolve inside DIST only - a traversal like /../.env must not escape the build folder.
  const candidate = path.resolve(DIST, '.' + decodeURIComponent(url));
  if (!candidate.startsWith(DIST)) { res.writeHead(403); return res.end('forbidden'); }

  if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return sendFile(res, candidate);

  // SPA fallback: every client-side route (/workforce/aon-analytics included) is index.html.
  return sendFile(res, path.join(DIST, 'index.html'));
}).listen(PORT, '127.0.0.1', () => {
  console.log(
    `[preview] http://localhost:${PORT}  (serving dist, /api -> https://${TARGET}` +
    `${TARGET_IP ? ` via ${TARGET_IP}` : ''})`
  );
  console.log(`[preview] AON page: http://localhost:${PORT}/workforce/aon-analytics`);
});
