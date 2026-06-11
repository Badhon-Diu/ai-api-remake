'use strict';

const crypto = require('crypto');
const { CONFIG } = require('../config');
const { buildImagePrompt } = require('../prompts/image.prompt');
const { aiClient } = require('./ai.client');
const { createTimeout, normalizeMark, stripThinkingBlock } = require('../utils/helpers');

// ---------------------------------------------------------------------------
// In-memory response cache  (keyed by MD5 hash of image buffer)
// ---------------------------------------------------------------------------

const imageCache = new Map();

/**
 * Derive a deterministic cache key from raw image bytes + student list.
 * Including students means different class contexts produce separate cache entries.
 * @param {Buffer} buffer
 * @param {Array} students
 * @returns {string}
 */
function getCacheKey(buffer, students = []) {
  const imgHash = crypto.createHash('md5').update(buffer).digest('hex');
  if (!students.length) return imgHash;
  const ctx = crypto.createHash('md5').update(JSON.stringify(students)).digest('hex').slice(0, 8);
  return `${imgHash}-${ctx}`;
}

// ---------------------------------------------------------------------------
// Step A — Analyse a single image via the vision model
// ---------------------------------------------------------------------------

/**
 * Send one image to the vision model and return its raw text response.
 * Results are cached by image hash so identical uploads are never re-sent.
 * @param {{ buffer: Buffer, mimetype: string, originalname: string }} file
 * @returns {Promise<string>}
 */
async function analyzeImage(file, students = []) {
  const cacheKey = getCacheKey(file.buffer, students);

  if (imageCache.has(cacheKey)) {
    console.log(`[Image] Cache hit: ${file.originalname}`);
    return imageCache.get(cacheKey);
  }

  const base64  = file.buffer.toString('base64');
  const dataUrl = `data:${file.mimetype};base64,${base64}`;
  const prompt  = buildImagePrompt(students);

  const { signal, clear } = createTimeout(CONFIG.timeouts.vision);

  try {
    const response = await aiClient.chat.completions.create({
      model: CONFIG.visionModel,
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      }],
      signal,
    });

    const rawOutput = response.choices[0].message.content;
    if (!rawOutput || rawOutput.trim() === '') {
      throw new Error(`Vision model (${CONFIG.visionModel}) returned an empty response`);
    }

    imageCache.set(cacheKey, rawOutput);
    return rawOutput;

  } finally {
    clear();
  }
}

// ---------------------------------------------------------------------------
// Step B — Parse the vision model's response into a normalised record
// ---------------------------------------------------------------------------

/**
 * Parse raw vision model output into a clean array of
 * `{ "student id": string, mark: number }` objects.
 * Handles <think> blocks and markdown fences automatically.
 * @param {string} rawText
 * @returns {Array<{ "student id": string, mark: number }>}
 */
function parseImageOutput(rawText) {
  if (!rawText || rawText.trim() === '') {
    throw new Error('Vision model output was empty');
  }

  // Strip <think>...</think> block (Gemma / Qwen think before answering)
  let cleanJson = stripThinkingBlock(rawText);

  // Strip markdown code fences
  const fenceMatch = cleanJson.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    cleanJson = fenceMatch[1].trim();
  }

  // Extract just the JSON object
  const objectMatch = cleanJson.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    cleanJson = objectMatch[0];
  }

  const parsed = JSON.parse(cleanJson);
  const items = Array.isArray(parsed) ? parsed : [parsed];

  return items.map(item => ({
    'student id': item['student id'] || item.studentId || item.student_id || item.studentid || 'N/A',
    mark: normalizeMark(item.mark),
  }));
}

module.exports = { analyzeImage, parseImageOutput };
