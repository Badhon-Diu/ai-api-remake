'use strict';

const multer = require('multer');
const { AUDIO_DIR } = require('../config');

/**
 * Audio upload — files are saved to disk.
 * Whisper requires reading the file as raw binary, so memory storage won't work here.
 * Max size: 50 MB.
 */
const audioUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, AUDIO_DIR + '/'),
    filename: (_req, file, cb) => cb(null, Date.now() + '-' + file.originalname),
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('audio/')) return cb(null, true);
    cb(new Error('Unsupported audio format: ' + file.mimetype));
  },
});

/**
 * Image upload — files are kept in RAM as file.buffer.
 * Faster than disk I/O; no cleanup step required.
 * Max size: 10 MB per image; up to 10 images per request.
 */
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
    if (allowed.includes(file.mimetype)) return cb(null, true);
    cb(new Error('Unsupported image format: ' + file.mimetype));
  },
});

module.exports = { audioUpload, imageUpload };
