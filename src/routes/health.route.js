'use strict';

const { Router } = require('express');
const { CONFIG } = require('../config');

const router = Router();

// GET /api/health
router.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    visionModel: CONFIG.visionModel,
    audioModel: CONFIG.deepSeekModel,
    batchSize: CONFIG.imageBatchSize,
  });
});

module.exports = router;
