'use strict';

// Must be first — loads .env and ensures the uploads directory exists
require('./src/config');

const express = require('express');
const cors    = require('cors');

const healthRouter = require('./src/routes/health.route');
const audioRouter  = require('./src/routes/audio.route');
const imageRouter  = require('./src/routes/image.route');

const app = express();

// ── Middleware ───────────────────────────────────────────────────────────────

app.use(cors());
app.use(express.json({ limit: '50mb' })); // Large limit for base64 audio payloads

// ── Routes ───────────────────────────────────────────────────────────────────

app.use('/api/health',         healthRouter);
app.use('/api/analyze-audio',  audioRouter);
app.use('/api/analyze-images', imageRouter);

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
