'use strict';

const fs   = require('fs');
const path = require('path');
const { Router } = require('express');
const multer = require('multer');
const { SESSIONS_DIR } = require('../config');

const router = Router();

// ---------------------------------------------------------------------------
// Multer: disk storage under uploads/sessions/:uuid/
// ---------------------------------------------------------------------------

function makeSessionStorage(uuid) {
  return multer.diskStorage({
    destination(req, file, cb) {
      const dir = path.join(SESSIONS_DIR, uuid);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename(req, file, cb) {
      const ext = path.extname(file.originalname) || '.jpg';
      cb(null, `img-${Date.now()}-${Math.random().toString(36).slice(2, 7)}${ext}`);
    },
  });
}

// ---------------------------------------------------------------------------
// GET /upload/:uuid  — serve the mobile EJS upload page
// ---------------------------------------------------------------------------

router.get('/:uuid', (req, res) => {
  const { uuid } = req.params;
  // Basic UUID-like validation (prevent path traversal)
  if (!/^[a-zA-Z0-9_-]{8,64}$/.test(uuid)) {
    return res.status(400).send('Invalid session ID');
  }
  res.render('upload', { uuid });
});

// ---------------------------------------------------------------------------
// POST /upload/:uuid/images  — accept images from mobile, store to disk
// Returns { success: true, uploaded: N, total: N }
// ---------------------------------------------------------------------------

router.post('/:uuid/images', (req, res) => {
  const { uuid } = req.params;
  if (!/^[a-zA-Z0-9_-]{8,64}$/.test(uuid)) {
    return res.status(400).json({ error: 'Invalid session ID' });
  }

  const upload = multer({
    storage: makeSessionStorage(uuid),
    limits: { fileSize: 15 * 1024 * 1024, files: 30 },
    fileFilter(req, file, cb) {
      if (file.mimetype.startsWith('image/')) cb(null, true);
      else cb(new Error('Only image files are accepted'));
    },
  }).array('images', 30);

  upload(req, res, (err) => {
    if (err) {
      console.error(`[Upload] ${uuid}:`, err.message);
      return res.status(400).json({ error: err.message });
    }

    const uploaded = req.files ? req.files.length : 0;
    const sessionDir = path.join(SESSIONS_DIR, uuid);
    const total = fs.existsSync(sessionDir)
      ? fs.readdirSync(sessionDir).filter(f => /\.(jpe?g|png|webp|gif)$/i.test(f)).length
      : 0;

    console.log(`[Upload] ${uuid}: +${uploaded} images (total ${total})`);
    res.json({ success: true, uploaded, total });
  });
});

module.exports = router;
