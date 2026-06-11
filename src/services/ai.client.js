'use strict';

const { OpenAI } = require('openai');
const { CONFIG } = require('../config');

/**
 * Single OpenAI-compatible client pointed at HuggingFace's API router.
 * Shared by both the audio and image service.
 */
const aiClient = new OpenAI({
  baseURL: 'https://router.huggingface.co/v1',
  apiKey: CONFIG.hfToken,
});

module.exports = { aiClient };
