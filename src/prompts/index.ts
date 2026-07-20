export type Mode = 'general' | 'ocr' | 'alt-text' | 'ui';

export const MODES: readonly Mode[] = ['general', 'ocr', 'alt-text', 'ui'];

export function isMode(value: string): value is Mode {
  return (MODES as readonly string[]).includes(value);
}

/** The output contract, restated to the model on every call. */
export const SCHEMA_INSTRUCTION = `Respond with a single JSON object and nothing else. It must have exactly these keys:

{
  "description": string  — one paragraph of natural language describing the image,
  "objects": array of { "name": string, "confidence": "high" | "medium" | "low" } — the notable objects, entities, or UI elements you can see,
  "text": string — every piece of text visible in the image, transcribed verbatim, or "" if there is none,
  "tags": array of 5 to 15 short lowercase keyword strings
}

Do not wrap the JSON in markdown code fences. Do not add commentary before or after it.`;

const MODE_INSTRUCTIONS: Record<Mode, string> = {
  general: `You are an image analysis engine. Examine the image and report what it contains: the setting, the subjects, notable details, and any text.`,

  ocr: `You are an OCR engine. Your priority is text extraction. Transcribe every piece of text in the image verbatim into the "text" field — preserve line breaks, spelling, casing, punctuation, numbers, and error codes exactly as they appear, and do not paraphrase or correct anything. Keep "description" to one or two sentences about where the text appears and what kind of document or screen it is.`,

  'alt-text': `You are writing accessibility alt text. Keep "description" to a single sentence under 125 characters that conveys what a sighted user would take away from the image — no "image of" or "picture of" preamble. Keep "objects" to the few things that matter for comprehension, and keep "tags" short.`,

  ui: `You are analyzing a screenshot of a software interface. In "description", cover the overall layout, what screen or application this appears to be, and the current state. In "objects", list the visible interactive controls — buttons, inputs, menus, tabs, dialogs — by their visible labels. Call out any error, warning, empty, or loading state explicitly in the description. In "text", transcribe visible labels, messages, and error codes verbatim.`,
};

export function buildPrompt(mode: Mode, customPrompt?: string): string {
  const sections = [MODE_INSTRUCTIONS[mode], SCHEMA_INSTRUCTION];
  const custom = customPrompt?.trim();
  if (custom) {
    sections.splice(1, 0, `Additional instruction from the caller — honor it, but still return the schema below exactly as specified:\n${custom}`);
  }
  return sections.join('\n\n');
}

/** Sent as a follow-up turn when the first response could not be parsed (FR-1.4). */
export const REPAIR_PROMPT = `That response could not be parsed as JSON. Reply again with only the JSON object described earlier — no prose, no commentary, no markdown code fences. Start your reply with { and end it with }.`;
