'use strict';

/**
 * Base prompt sent to the vision model.
 * Extracts student ID and obtained mark from a single test paper image.
 */
const IMAGE_PROMPT_BASE = `
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
- Format: {"student id": "value here", "mark": number here}
- Example: {"student id": "232-15-290", "mark": 17}
- If a value cannot be found, use null for that field.
- The JSON must start with { and end with }
`.trim();

/**
 * Build the full prompt, optionally appending the known student list as context.
 * @param {Array<{id: string, name: string}>} students
 * @returns {string}
 */
function buildImagePrompt(students = []) {
  if (!students || students.length === 0) return IMAGE_PROMPT_BASE;

  const list = students
    .map(s => `  ID: ${s.id}  Name: ${s.name || '(no name)'}`)
    .join('\n');

  return IMAGE_PROMPT_BASE + `

KNOWN STUDENTS IN THIS CLASS:
${list}

If the ID in the image is partially visible or unclear, match it to the closest entry above.
If only a name is visible, look it up in the list and use that student's ID.`;
}

module.exports = { buildImagePrompt };
