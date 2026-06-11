'use strict';

// Must be first — loads .env and ensures the uploads directory exists
const { CONFIG } = require('./src/config');

const path    = require('path');
const express = require('express');
const cors    = require('cors');

const healthRouter          = require('./src/routes/health.route');
const { getLanIp }          = healthRouter;
const audioRouter   = require('./src/routes/audio.route');
const imageRouter   = require('./src/routes/image.route');
const uploadRouter  = require('./src/routes/upload.route');
const sessionRouter = require('./src/routes/session.route');

const app = express();

// ── View engine (EJS) ────────────────────────────────────────────────────────

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ── Middleware ───────────────────────────────────────────────────────────────

app.use(cors());
app.use(express.json({ limit: '50mb' })); // Large limit for base64 audio payloads

// ── Routes ───────────────────────────────────────────────────────────────────

app.use('/api/health',         healthRouter);

// GET /api/network-info — returns the server's LAN IP so the extension can
// build QR URLs that point to the real machine instead of localhost.
app.get('/api/network-info', (_req, res) => {
  const lanIp = getLanIp();
  res.json({ lanIp, port: CONFIG.port, baseUrl: `http://${lanIp}:${CONFIG.port}` });
});
app.use('/api/analyze-audio',  audioRouter);
app.use('/api/analyze-images', imageRouter);
app.use('/upload',             uploadRouter);   // GET /:uuid  |  POST /:uuid/images
app.use('/api/session',        sessionRouter);  // GET /:uuid  |  POST /:uuid/analyze

// ── Global error handler ─────────────────────────────────────────────────────

// Catches multer file-size errors and anything else that falls through
app.use((err, _req, res, _next) => {
  const message = err.code === 'LIMIT_FILE_SIZE'
    ? 'File too large (max 50 MB for audio, 10 MB per image)'
    : err.message || 'An unexpected error occurred';

  console.error('[Server] Unhandled error:', message);
  res.status(400).json({ error: message });
});

module.exports = app;
