'use strict';

const app = require('./app');
const { CONFIG, IS_VERCEL } = require('./src/config');

// Start the HTTP server when running locally.
// On Vercel the app is exported as a serverless function — no listen() needed.
if (!IS_VERCEL) {
  app.listen(CONFIG.port, () => {
    console.log(`✓ Server running at http://localhost:${CONFIG.port}`);
    console.log(`✓ Vision model : ${CONFIG.visionModel}`);
    console.log(`✓ Audio model  : ${CONFIG.deepSeekModel}`);
    console.log(`✓ Image batch  : ${CONFIG.imageBatchSize} per batch`);
  });
}

module.exports = app;
