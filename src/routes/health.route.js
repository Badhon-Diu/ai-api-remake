'use strict';

const os = require('os');
const { Router } = require('express');
const { CONFIG } = require('../config');

const router = Router();

/** Return the first non-internal IPv4 address on this machine. */
function getLanIp() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}

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
module.exports.getLanIp = getLanIp;
