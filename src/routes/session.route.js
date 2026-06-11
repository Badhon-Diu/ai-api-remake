'use strict';

const fs   = require('fs');
const path = require('path');
const { Router } = require('express');
const { SESSIONS_DIR, CONFIG } = require('../config');
const { analyzeImage, parseImageOutput } = require('../services/image.service');

const router = Router();

// Allowed image extensions
const IMAGE_EXTS = /\.(jpe?g|png|webp|gif)$/i;

// Map file extension → MIME type
const MIME = {
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png':  'image/png',
  '.webp': 'image/webp',
  '.gif':  'image/gif',
};

function listSessionFiles(uuid) {
  const dir = path.join(SESSIONS_DIR, uuid);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => IMAGE_EXTS.test(f))
    .map(f => path.join(dir, f));
}

// ---------------------------------------------------------------------------
// GET /api/session/:uuid  — return count of images in this session
// Response: { uuid, count, files: [filenames] }
// ---------------------------------------------------------------------------

router.get('/:uuid', (req, res) => {
  const { uuid } = req.params;
  if (!/^[a-zA-Z0-9_-]{8,64}$/.test(uuid)) {
    return res.status(400).json({ error: 'Invalid session ID' });
  }

  const files = listSessionFiles(uuid);
  res.json({
    uuid,
    count: files.length,
    files: files.map(f => path.basename(f)),
  });
});

// ---------------------------------------------------------------------------
// POST /api/session/:uuid/analyze  — run image AI pipeline on session files
// Body (JSON): { students?: [{id, name}] }
// Response: same format as /api/analyze-images  → [{student id, mark}, ...]
// ---------------------------------------------------------------------------

router.post('/:uuid/analyze', async (req, res) => {
  const { uuid } = req.params;
  if (!/^[a-zA-Z0-9_-]{8,64}$/.test(uuid)) {
    return res.status(400).json({ error: 'Invalid session ID' });
  }

  const filePaths = listSessionFiles(uuid);
  if (filePaths.length === 0) {
    return res.status(400).json({ error: 'No images found for this session. Upload images first.' });
  }

  const students = Array.isArray(req.body.students) ? req.body.students : [];
  if (students.length > 0) {
    console.log(`[Session] ${uuid}: analyzing ${filePaths.length} image(s) with ${students.length} student(s) as context`);
  } else {
    console.log(`[Session] ${uuid}: analyzing ${filePaths.length} image(s)`);
  }

  const batchSize    = CONFIG.imageBatchSize;
  const totalBatches = Math.ceil(filePaths.length / batchSize);
  const allResults   = [];

  for (let i = 0; i < filePaths.length; i += batchSize) {
    const batch       = filePaths.slice(i, i + batchSize);
    const batchNumber = Math.floor(i / batchSize) + 1;
    console.log(`[Session] Batch ${batchNumber}/${totalBatches} — ${batch.length} image(s)`);

    const batchResults = await Promise.all(
      batch.map(async (filePath, idx) => {
        const globalIdx = i + idx + 1;
        const name      = path.basename(filePath);
        console.log(`[Session] Analyzing ${globalIdx}/${filePaths.length}: ${name}`);

        try {
          // Build a multer-compatible file object from disk
          const buffer   = fs.readFileSync(filePath);
          const ext      = path.extname(filePath).toLowerCase();
          const mimetype = MIME[ext] || 'image/jpeg';
          const file     = { buffer, mimetype, originalname: name };

          const rawOutput = await analyzeImage(file, students);
          console.log(`[Session] Raw for ${name}:\n${rawOutput}`);

          const parsed = parseImageOutput(rawOutput);
          console.log(`[Session] Parsed for ${name}:`, parsed);
          return parsed;
        } catch (err) {
          console.error(`[Session] Failed for ${name}: ${err.message}`);
          return [{ 'student id': 'N/A', mark: 0 }];
        }
      })
    );

    allResults.push(...batchResults.flat());
  }

  console.log(`[Session] ${uuid}: done. ${allResults.length} record(s) extracted.`);
  return res.json(allResults);
});

module.exports = router;
