'use strict';

require('dotenv').config();
const fs = require('fs');

const IS_VERCEL    = process.env.VERCEL === '1';
const AUDIO_DIR    = IS_VERCEL ? '/tmp/uploads'          : 'uploads';
const SESSIONS_DIR = IS_VERCEL ? '/tmp/uploads/sessions' : 'uploads/sessions';

// Ensure upload directories exist at startup
if (!fs.existsSync(AUDIO_DIR))    fs.mkdirSync(AUDIO_DIR,    { recursive: true });
if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });

const CONFIG = {
  port: process.env.PORT || 3001,
  hfToken: process.env.HF_TOKEN,

  // Whisper: best open-source speech-to-text model on HuggingFace
  whisperUrl: 'https://router.huggingface.co/hf-inference/models/openai/whisper-large-v3',

  // DeepSeek-V4-Flash: 13B activated params (MoE), fast, smart enough for JSON extraction
  // Much faster than R1 (671B) — fewer 504 timeouts on HF router via Novita
  deepSeekModel: 'deepseek-ai/DeepSeek-V4-Flash:novita',

  // Vision model: Gemma 4 31B — real VLM for reading test paper images
  visionModel: 'google/gemma-4-31B-it:novita',

  // Max images processed in parallel per batch.
  // Keep at 3 — sending more causes 429 concurrency errors on Novita
  imageBatchSize: 3,

  // Timeout limits for each external AI service (milliseconds)
  timeouts: {
    whisper: 30_000,  // 30s — audio transcription can be slow
    vision: 40_000,   // 40s — vision model needs time for image analysis
  },
};

module.exports = { CONFIG, IS_VERCEL, AUDIO_DIR, SESSIONS_DIR };
