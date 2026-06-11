'use strict';

const fs = require('fs');

/**
 * Safely delete a file — won't throw if already gone.
 * @param {string} filePath
 */
function deleteFile(filePath) {
  if (filePath && fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

/**
 * Returns an AbortSignal that fires after `ms` milliseconds,
 * plus a `clear()` to cancel the timer if the request finishes first.
 * @param {number} ms
 * @returns {{ signal: AbortSignal, clear: () => void }}
 */
function createTimeout(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  };
}

/**
 * Coerce any mark value to a non-negative integer.
 * Returns 0 for null / undefined / NaN.
 * @param {*} value
 * @returns {number}
 */
function normalizeMark(value) {
  if (typeof value === 'number' && !isNaN(value)) return value;
  if (value === null || value === undefined) return 0;
  const parsed = parseInt(String(value), 10);
  return isNaN(parsed) ? 0 : parsed;
}

/**
 * Strip <think>…</think> reasoning blocks emitted by models like
 * DeepSeek-V4-Flash and Gemma before JSON.parse() is called.
 * @param {string} text
 * @returns {string}
 */
function stripThinkingBlock(text) {
  return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

module.exports = { deleteFile, createTimeout, normalizeMark, stripThinkingBlock };
