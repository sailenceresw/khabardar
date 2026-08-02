/*
 * Minimal static server for the exported web build, with SPA fallback.
 *
 * Why this exists: `expo start --web` runs Metro in watch mode, and on Windows
 * without Watchman that watcher intermittently hangs (see README
 * "Troubleshooting"). `expo export --platform web` uses the same bundler with
 * no watcher, so exporting and serving the result is a deterministic way to
 * exercise the real app — useful for verification and CI screenshots.
 *
 * Run:  npm run web:static  (from apps/mobile)
 */

const http = require("http");
const fs = require("fs");
const path = require("path");

const DIST = path.resolve(__dirname, "../dist");
const PORT = Number(process.env.PORT || 8085);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".ttf": "font/ttf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

if (!fs.existsSync(DIST)) {
  console.error(`No build at ${DIST}. Run: npx expo export --platform web`);
  process.exit(1);
}

http
  .createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
    let filePath = path.join(DIST, urlPath);

    // Refuse to serve outside the build directory.
    if (!filePath.startsWith(DIST)) {
      res.writeHead(403);
      return res.end("Forbidden");
    }

    // SPA fallback: any path that is not a real file resolves to index.html so
    // client-side routes like /org and /feed/3 work on reload.
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(DIST, "index.html");
    }

    const body = fs.readFileSync(filePath);
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream",
    });
    res.end(body);
  })
  .listen(PORT, () => console.log(`Serving ${DIST} at http://localhost:${PORT}`));
