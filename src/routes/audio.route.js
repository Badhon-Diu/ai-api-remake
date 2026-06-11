'use strict';

const fs   = require('fs');
const path = require('path');
const { Router } = require('express');
const { AUDIO_DIR } = require('../config');
const { transcribeAudio, extractMarksWithDeepSeek, parseDeepSeekOutput } = require('../services/audio.service');
const { deleteFile } = require('../utils/helpers');

const router = Router();

/**
 * POST /api/analyze-audio
 *
 * Accepts JSON body: { audio: "<base64 string>", assessment: "quiz1" }
 * The extension records audio in the browser, base64-encodes it, and POSTs JSON —
 * so we decode the base64 here and write a temp file for Whisper.
 *
 * Pipeline: base64 decode → temp file → Whisper → DeepSeek-V4-Flash → JSON marks
 *
 * Response:
 *   200  [{ "student id": "XXX-XX-XXX", mark: 15 }, ...]
 *   400  { error: "No audio data provided" }
 *   500  { error: "...", details: "..." }
 */
router.post('/', async (req, res) => {
  const { audio: base64Audio, assessment, students } = req.body;
  if (!base64Audio) return res.status(400).json({ error: 'No audio data provided' });

  console.log(`[Audio] Received base64 audio for assessment: ${assessment}`);

  // Decode base64 → binary and save to a temp file (Whisper reads from disk)
  const audioBuffer = Buffer.from(base64Audio, 'base64');
  const tempFile    = path.join(AUDIO_DIR, `audio-${Date.now()}.webm`);
  fs.writeFileSync(tempFile, audioBuffer);
  console.log(`[Audio] Saved temp file: ${tempFile} (${audioBuffer.length} bytes)`);

  try {
    console.log('[Audio] Sending to Whisper...');
    const transcript = await transcribeAudio(tempFile, 'audio/webm');
    console.log(`[Audio] Transcript: "${transcript}"`);

    if (!transcript || transcript.trim() === '') {
      return res.status(200).json({ results: [], transcript: '' });
    }

    console.log('[Audio] Sending transcript to DeepSeek-V4-Flash...');
    const rawOutput = await extractMarksWithDeepSeek(transcript, students);

    const results = parseDeepSeekOutput(rawOutput);
    console.log('[Audio] Final results:', results);

    res.status(200).json({ results, transcript });

  } catch (err) {
    console.error('[Audio] Error:', err.message);
    if (err.cause) console.error('[Audio] Cause:', err.cause);
    if (!res.headersSent) {
      res.status(500).json({
        error: 'Failed to analyze audio',
        details: err.message,
        cause: err.cause ? String(err.cause) : undefined,
      });
    }
  } finally {
    deleteFile(tempFile);
  }
});

module.exports = router;
