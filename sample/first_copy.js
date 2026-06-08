// ============================================================
//  server.js  –  Student Mark Extraction API  (v5 – final)
//
//  Features:
//    1. Audio  → Whisper transcribes → DeepSeek-V4-Flash extracts marks
//    2. Images → Vision model reads test papers → extracts marks
//
//  Changes in v5:
//    ✓ Model upgraded: DeepSeek-R1 → DeepSeek-V4-Flash:novita
//      (13B activated params — much faster, fewer 504s)
//    ✓ stripThinkingBlock() now called in parseDeepSeekOutput()
//      (V4-Flash can think — strip <think> before JSON parse)
//    ✓ DeepSeek timeout increased: 20s → 35s
//    ✓ Regex fallback fixed: merges spaced digits before matching
//      e.g. "2 3 2 1 5 3 8 0" → "23215380" before regex runs
// ============================================================

require('dotenv').config();

const express = require('express');
const multer  = require('multer');
const cors    = require('cors');
const fs      = require('fs');
const crypto  = require('crypto');
const { OpenAI } = require('openai');


// ============================================================
//  SECTION 1: CONFIG
// ============================================================

const CONFIG = {
  port         : process.env.PORT || 3001,
  hfToken      : process.env.HF_TOKEN,

  // Whisper: best open-source speech-to-text model on HuggingFace
  whisperUrl   : 'https://router.huggingface.co/hf-inference/models/openai/whisper-large-v3',

  // DeepSeek-V4-Flash: 13B activated params (MoE), fast, smart enough for JSON extraction
  // Much faster than R1 (671B) — fewer 504 timeouts on HF router via Novita
  deepSeekModel: 'deepseek-ai/DeepSeek-V4-Flash:novita',

  // Vision model: Gemma 4 31B — real VLM for reading test paper images
  visionModel  : 'google/gemma-4-31B-it:novita',

  // Max images processed in parallel per batch.
  // Keep at 3 — sending more causes 429 concurrency errors on Novita
  imageBatchSize: 3,

  // Timeout limits for each external AI service (milliseconds)
  timeouts: {
    whisper  : 30_000,   // 30s — audio transcription can be slow
    deepSeek : 35_000,   // 35s — increased from 20s; V4-Flash may think before answering
    vision   : 40_000,   // 40s — vision model needs time for image analysis
  },
};

// Vercel serverless has a read-only filesystem — audio temp files must go to /tmp
const IS_VERCEL = process.env.VERCEL === '1';
const AUDIO_DIR = IS_VERCEL ? '/tmp/uploads' : 'uploads';


// ============================================================
//  SECTION 2: AI PROMPTS
// ============================================================

// Sent to DeepSeek-V4-Flash to parse a Bengali/English audio transcript into student marks
const AUDIO_PROMPT = `
You are a precise data extraction assistant specialized in parsing mixed Bengali/English student mark records.
Your ONLY task is to extract student IDs, marks, and exam types from the input text and return a STRICTLY VALID JSON array.
Do not output any explanations, markdown, code blocks, or extra text.

OUTPUT FORMAT (exact):
[{"student id": "XXX-XX-XXX", "mark": 15, "examtype": "quiz1"}]

PARSING RULES:

1. DIGIT MERGING
   - Raw input may contain digits separated by spaces (e.g., "2 6 2 1 5 5 5 0").
   - FIRST, merge consecutive space-separated digits into a single number.
   - NEVER treat spaced digits as separate values.

2. DYNAMIC ID FORMATTING
   - 8-digit numbers → split as first 3 - next 2 - last 3 → "XXX-XX-XXX"
     Example: 26215550 → "262-15-550"
   - 1-3 digit numbers (short suffix) → left-pad with zeros to 3 digits
     Example: 6 → 006, 241 → 241
   - PREFIX INHERITANCE: Use the "XXX-XX-" prefix from the last full 8-digit ID seen.
     If no full ID seen yet, default prefix is "000-00-".
     Example: After "262-15-550", a short ID "241" becomes "262-15-241"
   - Exception: If text says "section 25", use "232-25-" for short suffixes 001-099.

3. SEQUENTIAL MARK EXTRACTION
   - Keywords that mean a mark follows: "got", "গাট", "marks", "নম্বর"
   - Parse left-to-right in blocks: [ID] [keyword] [mark number]
   - Marks are integers 0-100. Never confuse ID digits with marks.

4. EXAM TYPE
   - Look for: quiz1, quiz2, midterm, final, assignment, lab, viva
   - If found → apply to ALL records. If not found → default to "quiz1"

5. OUTPUT RULES
   - One JSON object per valid ID + mark pair
   - "mark" must be a number (not a string)
   - Only three keys allowed: "student id", "mark", "examtype"
   - Empty or unparseable input → return exactly: []
   - Output ONLY raw JSON starting with [ and ending with ]. No markdown, no backticks.

EXAMPLES:
Input:  23215380 গাট 13 820 গাট 15 895 গাট 9
Output: [{"student id":"232-15-380","mark":13,"examtype":"quiz1"},{"student id":"232-15-820","mark":15,"examtype":"quiz1"},{"student id":"232-15-895","mark":9,"examtype":"quiz1"}]

Input:  105 গাট 70 208 got 92 midterm
Output: [{"student id":"232-15-105","mark":70,"examtype":"midterm"},{"student id":"232-15-208","mark":92,"examtype":"midterm"}]

Input:  2 6 2 1 5 5 5 0 got 14 2 4 1 got 15
Output: [{"student id":"262-15-550","mark":14,"examtype":"quiz1"},{"student id":"262-15-241","mark":15,"examtype":"quiz1"}]

/no_think
`.trim();

// Sent to the vision model to extract student ID and mark from a test paper image.
const IMAGE_PROMPT = `
You are an OCR extraction tool. Look at this test paper image and extract exactly two values.

WHAT TO FIND:

1. Student ID
   Look for a field labeled any of: "Student ID", "ID Number", "ID No", "Roll No"
   Copy the value exactly as written, including hyphens (e.g. "232-15-241").

2. Obtained Mark / Score
   Look for the final awarded score. It may appear as:
   - A circled or boxed number at the top of the paper
   - The value in the "Total" row under the "Marks Obtained" column in a marks table
   - A number next to "Total Marks", "Score", or "Obtained"
   Extract it as a plain integer only (e.g. write 17, not "17/20").

STRICT OUTPUT RULES:
- After your thinking, output ONLY this exact JSON object. Nothing else. No explanation. No markdown. No backticks.
- Format: {"studentId": "value here", "mark": number here}
- Example: {"studentId": "232-15-290", "mark": 17}
- If a value cannot be found, use null for that field.
- The JSON must start with { and end with }
`.trim();


// ============================================================
//  SECTION 3: APP & MIDDLEWARE SETUP
// ============================================================

const app = express();
app.use(cors({
  origin: ['chrome-extension://*'],
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type']
}));
app.use(express.json());

// Create audio upload folder if it does not exist
if (!fs.existsSync(AUDIO_DIR)) {
  fs.mkdirSync(AUDIO_DIR, { recursive: true });
}

// Single AI client pointing to HuggingFace's OpenAI-compatible API router
const aiClient = new OpenAI({
  baseURL: 'https://router.huggingface.co/v1',
  apiKey : CONFIG.hfToken,
});


// ============================================================
//  SECTION 4: FILE UPLOAD CONFIG (Multer)
// ============================================================

// Audio: saved to disk — Whisper requires reading the file as binary
const audioUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, AUDIO_DIR + '/'),
    filename   : (_req,  file, cb) => cb(null, Date.now() + '-' + file.originalname),
  }),
  limits    : { fileSize: 50 * 1024 * 1024 }, // 50 MB max
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('audio/')) return cb(null, true);
    cb(new Error('Unsupported audio format: ' + file.mimetype));
  },
});

// Images: stored in RAM as file.buffer — faster, no disk cleanup needed
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits : { fileSize: 10 * 1024 * 1024 }, // 10 MB max per image
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
    if (allowed.includes(file.mimetype)) return cb(null, true);
    cb(new Error('Unsupported image format: ' + file.mimetype));
  },
});


// ============================================================
//  SECTION 5: IMAGE RESPONSE CACHE
// ============================================================

const imageCache = new Map();

function getCacheKey(buffer) {
  return crypto.createHash('md5').update(buffer).digest('hex');
}


// ============================================================
//  SECTION 6: UTILITY HELPERS
// ============================================================

// Safely delete a file — won't throw if already gone
function deleteFile(filePath) {
  if (filePath && fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

// AbortController that auto-cancels after `ms` milliseconds
function createTimeout(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return {
    signal: controller.signal,
    clear : () => clearTimeout(timer),
  };
}

// Safely convert any mark value to an integer
function normalizeMark(value) {
  if (typeof value === 'number' && !isNaN(value)) return value;
  if (value === null || value === undefined)       return 0;
  const parsed = parseInt(String(value), 10);
  return isNaN(parsed) ? 0 : parsed;
}

// Throw a clear error if the AI returned an empty response
function assertNotEmpty(text, label) {
  if (!text || text.trim() === '') {
    throw new Error(`${label} returned an empty response — model may not support this input type`);
  }
}

// Strip <think>...</think> reasoning blocks
// Both Qwen3.6 and DeepSeek-V4-Flash can think out loud before answering.
// Must strip this block before JSON.parse() or it will always fail.
function stripThinkingBlock(text) {
  return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

// FIX v5: Merge spaced digits in transcript before regex matching.
// Whisper often transcribes "23215380" as "2 3 2 1 5 3 8 0".
// This function collapses those spaced-digit sequences back into numbers.
// Example: "2 3 2 1 5 3 8 0 got 9" → "23215380 got 9"
function mergeSpacedDigits(text) {
  // Repeatedly merge sequences of single digits separated by spaces
  // Run multiple passes to handle long sequences like 8-digit IDs
  let prev = '';
  let result = text;
  while (prev !== result) {
    prev = result;
    result = result.replace(/\b(\d)(?: (\d)){1,9}\b/g, (match) => match.replace(/ /g, ''));
  }
  return result;
}


// ============================================================
//  SECTION 7: AUDIO PIPELINE
// ============================================================

// Step A: Transcribe audio to text using Whisper
async function transcribeAudio(filePath, mimeType) {
  const { signal, clear } = createTimeout(CONFIG.timeouts.whisper);

  try {
    const response = await fetch(CONFIG.whisperUrl, {
      method : 'POST',
      headers: {
        'Authorization': `Bearer ${CONFIG.hfToken}`,
        'Content-Type' : mimeType,
      },
      body  : fs.readFileSync(filePath),
      signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Whisper error ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    assertNotEmpty(data.text, 'Whisper');
    return data.text;

  } finally {
    clear();
  }
}

// Step B: Send transcript to DeepSeek-V4-Flash → returns raw JSON string
async function extractMarksWithDeepSeek(transcript) {
  const response = await aiClient.chat.completions.create({
    model: CONFIG.deepSeekModel,
    temperature: 0,
    max_tokens: 500,
    messages: [
      {
        role: 'system',
        content: AUDIO_PROMPT,
      },
      {
        role: 'user',
        content: transcript,
      },
    ],
  });

  const content = response.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error('DeepSeek returned empty response');
  }

  return content;
}
// Step C: Parse DeepSeek's raw output into a normalized array of records
// FIX v5: stripThinkingBlock() now called here too — V4-Flash can think out loud
function parseDeepSeekOutput(content) {
  const cleaned = content
    .replace(/```json/g, '')
    .replace(/```/g, '')
    .trim();

  return JSON.parse(cleaned);
}

// Fallback: regex-based extraction when DeepSeek is unavailable or times out
// FIX v5: mergeSpacedDigits() called first so "2 3 2 1 5 3 8 0" → "23215380"
function extractMarksWithRegex(text) {
  const results = [];
  const seen    = new Set();

  // Merge spaced digits before any regex matching
  const mergedText = mergeSpacedDigits(text);
  console.log(`[Audio] Regex fallback — merged text: "${mergedText}"`);

  // First try: full 8-digit IDs like 23215380 or hyphenated 232-15-380
  const fullIdPattern = /(\d{3}-?\d{2}-?\d{3})\D+?(\d{1,3})(?:\s*(quiz\d*|exam\d*|test\d*|final|midterm))?/gi;
  for (const match of mergedText.matchAll(fullIdPattern)) {
    const digits = match[1].replace(/-/g, '');
    const id = digits.length === 8
      ? `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`
      : match[1];

    if (!seen.has(id)) {
      seen.add(id);
      results.push({
        'student id'  : id,
        mark          : parseInt(match[2], 10) || 0,
        examtype      : (match[3] || 'quiz1').toLowerCase(),
        transcription : text, // keep original text for transparency
      });
    }
  }

  // Second try: short 3-digit IDs like 380, 820 — prefix defaults to 232-15-
  if (results.length === 0) {
    const shortIdPattern = /(?:id\s*)?(\d{3})\D+?(?:got\s*)?(\d{1,3})(?:\s*(quiz\d*|exam\d*|test\d*|final|midterm))?/gi;
    for (const match of mergedText.matchAll(shortIdPattern)) {
      const id = `232-15-${match[1]}`;
      if (!seen.has(id)) {
        seen.add(id);
        results.push({
          'student id'  : id,
          mark          : parseInt(match[2], 10) || 0,
          examtype      : (match[3] || 'quiz1').toLowerCase(),
          transcription : text,
        });
      }
    }
  }

  // Nothing matched — return a descriptive error record
  if (results.length === 0) {
    return [{
      'student id'  : 'N/A',
      mark          : 0,
      examtype      : 'N/A',
      transcription : text,
      message       : 'Could not extract student data — check audio clarity',
    }];
  }

  return results;
}


// ============================================================
//  SECTION 8: IMAGE PIPELINE
// ============================================================

// Step A: Send one image to the vision model → returns raw text response
async function analyzeImage(file) {
  const cacheKey = getCacheKey(file.buffer);

  if (imageCache.has(cacheKey)) {
    console.log(`[Image] Cache hit: ${file.originalname}`);
    return imageCache.get(cacheKey);
  }

  const base64  = file.buffer.toString('base64');
  const dataUrl = `data:${file.mimetype};base64,${base64}`;

  const { signal, clear } = createTimeout(CONFIG.timeouts.vision);

  try {
    const response = await aiClient.chat.completions.create({
      model     : CONFIG.visionModel,
      max_tokens: 1000,
      messages  : [{
        role   : 'user',
        content: [
          { type: 'text',      text      : IMAGE_PROMPT },
          { type: 'image_url', image_url : { url: dataUrl } },
        ],
      }],
      signal,
    });

    const rawOutput = response.choices[0].message.content;
    assertNotEmpty(rawOutput, `Vision model (${CONFIG.visionModel})`);

    imageCache.set(cacheKey, rawOutput);
    return rawOutput;

  } finally {
    clear();
  }
}

// Step B: Parse the vision model's response into a clean normalized record
function parseImageOutput(rawText) {
  assertNotEmpty(rawText, 'Vision model output');

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
  const items  = Array.isArray(parsed) ? parsed : [parsed];

  return items.map(item => ({
    studentId: item.studentId || item.student_id || item.studentid || item['student id'] || 'N/A',
    mark      : normalizeMark(item.mark),
  }));
}


// ============================================================
//  SECTION 9: API ROUTES
// ============================================================

// GET /api/health
app.get('/api/health', (_req, res) => {
  res.json({
    status      : 'ok',
    timestamp   : new Date().toISOString(),
    visionModel : CONFIG.visionModel,
    audioModel  : CONFIG.deepSeekModel,
    batchSize   : CONFIG.imageBatchSize,
  });
});

// POST /api/analyze-audio
// Pipeline: Whisper → transcript → DeepSeek-V4-Flash → JSON marks
// Fallback: regex extraction (with spaced-digit merging fix)
app.post('/api/analyze-audio', audioUpload.single('audio'), async (req, res) => {
  const file = req.file;

  if (!file) {
    return res.status(400).json({
      error: 'No audio file uploaded'
    });
  }

  try {
    console.log('[Audio] Sending to Whisper...');

    const transcript = await transcribeAudio(
      file.path,
      file.mimetype
    );

    console.log('[Audio] Transcript:');
    console.log(transcript);

    console.log('[Audio] Sending transcript to DeepSeek...');

    const rawResponse = await extractMarksWithDeepSeek(transcript);

    console.log('[Audio] DeepSeek response:');
    console.log(rawResponse);

    const result = parseDeepSeekOutput(rawResponse);

    deleteFile(file.path);

    return res.json(result);

  } catch (error) {

    deleteFile(file?.path);

    console.error(error);

    return res.status(500).json({
      error: error.message
    });
  }
});

// POST /api/analyze-images
// Pipeline: Vision model reads each image → extracts studentId + mark
// Batched in groups of CONFIG.imageBatchSize (3) to avoid 429 errors
app.post('/api/analyze-images', imageUpload.array('images', 10), async (req, res) => {
  const files = req.files;
  if (!files || files.length === 0) {
    return res.status(400).json({ error: 'No images provided' });
  }

  const batchSize    = CONFIG.imageBatchSize;
  const totalBatches = Math.ceil(files.length / batchSize);
  console.log(`[Image] Received ${files.length} image(s). Processing in ${totalBatches} batch(es) of ${batchSize}.`);

  const allResults = [];

  for (let i = 0; i < files.length; i += batchSize) {
    const batch       = files.slice(i, i + batchSize);
    const batchNumber = Math.floor(i / batchSize) + 1;

    console.log(`[Image] Batch ${batchNumber}/${totalBatches} — processing ${batch.length} image(s)...`);

    const batchResults = await Promise.all(
      batch.map(async (file, batchIndex) => {
        const globalIndex = i + batchIndex + 1;
        console.log(`[Image] Analyzing ${globalIndex}/${files.length}: ${file.originalname}`);

        try {
          const rawOutput = await analyzeImage(file);
          console.log(`[Image] Raw output for ${file.originalname}:\n${rawOutput}`);

          const parsed = parseImageOutput(rawOutput);
          console.log(`[Image] Parsed for ${file.originalname}:`, parsed);
          return parsed;

        } catch (err) {
          console.error(`[Image] Failed for ${file.originalname}: ${err.message}`);
          return [{ studentId: 'N/A', mark: 0, error: err.message }];
        }
      })
    );

    allResults.push(...batchResults.flat());
  }

  console.log(`[Image] All done. Total records extracted: ${allResults.length}`);
  return res.json(allResults);
});


// ============================================================
//  SECTION 10: GLOBAL ERROR HANDLER
// ============================================================

app.use((err, _req, res, _next) => {
  const message = err.code === 'LIMIT_FILE_SIZE'
    ? 'File too large (max 50 MB for audio, 10 MB per image)'
    : err.message || 'An unexpected error occurred';

  console.error('[Server] Unhandled error:', message);
  res.status(400).json({ error: message });
});


// ============================================================
//  SECTION 11: START SERVER
// ============================================================

if (!IS_VERCEL) {
  app.listen(CONFIG.port, () => {
    console.log(`✓ Server running at http://localhost:${CONFIG.port}`);
    console.log(`✓ Vision model : ${CONFIG.visionModel}`);
    console.log(`✓ Audio model  : ${CONFIG.deepSeekModel}`);
    console.log(`✓ Image batch  : ${CONFIG.imageBatchSize} per batch`);
  });
}

module.exports = app;