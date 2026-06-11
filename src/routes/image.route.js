'use strict';

const { Router } = require('express');
const { CONFIG } = require('../config');
const { imageUpload } = require('../middleware/upload');
const { analyzeImage, parseImageOutput } = require('../services/image.service');

const router = Router();

/**
 * POST /api/analyze-images
 *
 * Accepts up to 10 images as multipart/form-data (field name: "images").
 * Batched in groups of CONFIG.imageBatchSize (default 3) to avoid 429 errors from Novita.
 *
 * Response:
 *   200  [{ "student id": "XXX-XX-XXX", mark: 15 }, ...]
 *   400  { error: "No images provided" }
 */
router.post('/', imageUpload.array('images', 10), async (req, res) => {
  const files = req.files;
  if (!files || files.length === 0) {
    return res.status(400).json({ error: 'No images provided' });
  }

  // Parse optional student context sent by the extension
  let students = [];
  if (req.body.students) {
    try { students = JSON.parse(req.body.students); } catch { /* ignore bad JSON */ }
  }
  if (students.length > 0) {
    console.log(`[Image] Student context received: ${students.length} student(s)`);
  }

  const batchSize = CONFIG.imageBatchSize;
  const totalBatches = Math.ceil(files.length / batchSize);
  console.log(`[Image] Received ${files.length} image(s). Processing in ${totalBatches} batch(es) of ${batchSize}.`);

  const allResults = [];

  for (let i = 0; i < files.length; i += batchSize) {
    const batch = files.slice(i, i + batchSize);
    const batchNumber = Math.floor(i / batchSize) + 1;

    console.log(`[Image] Batch ${batchNumber}/${totalBatches} — processing ${batch.length} image(s)...`);

    const batchResults = await Promise.all(
      batch.map(async (file, batchIndex) => {
        const globalIndex = i + batchIndex + 1;
        console.log(`[Image] Analyzing ${globalIndex}/${files.length}: ${file.originalname}`);

        try {
          const rawOutput = await analyzeImage(file, students);
          console.log(`[Image] Raw output for ${file.originalname}:\n${rawOutput}`);

          const parsed = parseImageOutput(rawOutput);
          console.log(`[Image] Parsed for ${file.originalname}:`, parsed);
          return parsed;

        } catch (err) {
          console.error(`[Image] Failed for ${file.originalname}: ${err.message}`);
          return [{ 'student id': 'N/A', mark: 0 }];
        }
      })
    );

    allResults.push(...batchResults.flat());
  }

  console.log(`[Image] All done. Total records extracted: ${allResults.length}`);
  return res.json(allResults);
});

module.exports = router;
