'use strict';

const os  = require('os');
const app = require('./app');
const { CONFIG, IS_VERCEL } = require('./src/config');

/** Return the first non-internal IPv4 address on this machine. */
function getLanIp() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}

// Start the HTTP server when running locally.
// Bind to 0.0.0.0 so every network interface (LAN, Wi-Fi) is reachable.
// On Vercel the app is exported as a serverless function — no listen() needed.
if (!IS_VERCEL) {
  app.listen(CONFIG.port, '0.0.0.0', () => {
    const lan = getLanIp();
    console.log(`✓ Local  : http://localhost:${CONFIG.port}`);
    console.log(`✓ Network: http://${lan}:${CONFIG.port}  ← use this for QR codes`);
    console.log(`✓ Vision model : ${CONFIG.visionModel}`);
    console.log(`✓ Audio model  : ${CONFIG.deepSeekModel}`);
    console.log(`✓ Image batch  : ${CONFIG.imageBatchSize} per batch`);
  });
}

module.exports = app;
