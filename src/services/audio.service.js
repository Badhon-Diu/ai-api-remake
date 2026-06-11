'use strict';

const fs = require('fs');
const { CONFIG } = require('../config');
const { AUDIO_PROMPT } = require('../prompts/audio.prompt');
const { aiClient } = require('./ai.client');
const { createTimeout, normalizeMark, stripThinkingBlock } = require('../utils/helpers');

// ---------------------------------------------------------------------------
// Step A — Transcribe audio via Whisper
// ---------------------------------------------------------------------------

/**
 * Send an audio file to Whisper on HuggingFace and return the transcript string.
 * @param {string} filePath  Absolute path to the saved audio file
 * @param {string} mimeType  e.g. "audio/webm"
 * @returns {Promise<string>}
 */
async function transcribeAudio(filePath, mimeType) {
  if (!CONFIG.hfToken) throw new Error('HF_TOKEN is not set in environment');

  console.log(`[Audio] Whisper URL  : ${CONFIG.whisperUrl}`);
  console.log(`[Audio] HF token set : ${CONFIG.hfToken ? 'yes (' + CONFIG.hfToken.slice(0, 8) + '...)' : 'NO'}`);

  const { signal, clear } = createTimeout(CONFIG.timeouts?.whisper ?? 120_000);
  try {
    const response = await fetch(CONFIG.whisperUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${CONFIG.hfToken}`,
        'Content-Type': mimeType,
      },
      body: fs.readFileSync(filePath),
      signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Whisper error ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    return data.text;
  } finally {
    clear();
  }
}

// ---------------------------------------------------------------------------
// Step B — Extract marks from transcript via DeepSeek-V4-Flash
// ---------------------------------------------------------------------------

/**
 * Send the Whisper transcript to DeepSeek-V4-Flash and return the raw response string.
 * @param {string} transcriptText
 * @returns {Promise<string>}
 */
async function extractMarksWithDeepSeek(transcriptText, students = []) {
  let userContent = `Extract student marks from this text: "${transcriptText}"`;

  if (Array.isArray(students) && students.length > 0) {
    userContent += '\n\nKNOWN STUDENTS IN THIS CLASS (use to resolve partial IDs and name references):\n';
    userContent += students.map(s => `  ID: ${s.id}  Name: ${s.name || '(no name)'}`).join('\n');
    userContent += '\n\nIf any spoken ID is partial or unclear, match it to the closest ID in the list above.';
    userContent += '\nIf a student is referred to by name, look them up in the list and output their ID.';
  }

  const response = await aiClient.chat.completions.create({
    model: CONFIG.deepSeekModel,
    stream: false,
    messages: [
      { role: 'system', content: AUDIO_PROMPT },
      { role: 'user', content: userContent },
    ],
  });

  const content = response.choices[0]?.message?.content || '';
  console.log('[Audio] DeepSeek raw response:', content);
  return content;
}

// ---------------------------------------------------------------------------
// Step C — Parse DeepSeek's raw output into a normalised record array
// ---------------------------------------------------------------------------

/**
 * Parse the raw JSON string returned by DeepSeek into a clean array of
 * `{ "student id": string, mark: number }` objects.
 * Handles <think> blocks and markdown fences automatically.
 * @param {string} rawJson
 * @returns {Array<{ "student id": string, mark: number }>}
 */
function parseDeepSeekOutput(rawJson) {
  // Strip <think>...</think> — V4-Flash may think before answering
  let cleaned = stripThinkingBlock(rawJson);

  // Strip markdown fences
  cleaned = cleaned.replace(/```(?:json)?|```/g, '').trim();

  // Extract JSON array
  const jsonString = cleaned.match(/\[[\s\S]*\]/)?.[0] ?? cleaned;
  const parsed = JSON.parse(jsonString);

  function normalizeRecord(item) {
    return {
      'student id': item['student id'] || item.studentId || item.student_id || 'N/A',
      mark: normalizeMark(item.mark),
    };
  }

  if (Array.isArray(parsed)) return parsed.map(normalizeRecord);
  if (typeof parsed === 'object') return [normalizeRecord(parsed)];

  throw new Error('Unexpected format in DeepSeek response');
}

module.exports = { transcribeAudio, extractMarksWithDeepSeek, parseDeepSeekOutput };
