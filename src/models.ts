/**
 * Vision-model sizing, keyed on total system RAM.
 *
 * Advice only: `doctor` reads this to tell the user which model fits their
 * machine. `resolveConfig()` deliberately does not — DEFAULT_MODEL stays a
 * single static constant so a config resolved on one machine means the same
 * thing on another.
 *
 * This module imports nothing. `doctor.ts` already imports `backends/ollama.ts`,
 * so both of them reaching in here is the only arrangement that avoids a cycle.
 */

/** os.totalmem() reports bytes; every threshold below is binary GiB. */
export const GIB = 1024 ** 3;

export interface ModelTier {
  /** Inclusive lower bound, in whole GiB of total RAM. */
  readonly minGib: number;
  /** A real, vision-capable Ollama tag. */
  readonly model: string;
  /** Download size, so the cost is visible before pulling. */
  readonly download: string;
  /** Human label for the RAM band, reused in help and remediation text. */
  readonly ram: string;
}

/** Ordered smallest-first; the first entry starts at 0 so lookup is total. */
export const MODEL_TIERS: readonly ModelTier[] = [
  { minGib: 0, model: 'qwen3.5:2b', download: '2.7 GB', ram: 'under 8 GB' },
  { minGib: 8, model: 'qwen3.5:4b', download: '3.4 GB', ram: '8-24 GB' },
  { minGib: 24, model: 'gemma4:12b', download: '7.6 GB', ram: '24 GB or more' },
];

/** Ollama reports untagged models as "name:latest"; treat a bare name as that. */
export function normalizeTag(name: string): string {
  return name.includes(':') ? name : `${name}:latest`;
}

/**
 * The heaviest tier this machine can carry, or null when RAM is undetectable.
 *
 * Rounds to whole GiB before comparing: Linux MemTotal excludes firmware- and
 * kernel-reserved memory, so a nominal 8 GB machine commonly reports ~7.7 GiB
 * and must still count as 8.
 */
export function recommendModel(totalMemBytes: number): ModelTier | null {
  if (!Number.isFinite(totalMemBytes) || totalMemBytes <= 0) return null;
  const gib = Math.round(totalMemBytes / GIB);
  let match: ModelTier | null = null;
  for (const tier of MODEL_TIERS) {
    if (gib >= tier.minGib) match = tier;
  }
  return match;
}

/** Displayed as GB — what the OS tells users — though computed in GiB. */
export function formatGb(totalMemBytes: number): string {
  return `${(totalMemBytes / GIB).toFixed(1)} GB`;
}

/** Position of `model` in MODEL_TIERS, or -1 when it is not a tier model. */
export function tierIndexOf(model: string): number {
  const wanted = normalizeTag(model);
  return MODEL_TIERS.findIndex((tier) => normalizeTag(tier.model) === wanted);
}

/** The `detail` line for doctor's "System memory" check. */
export function memoryAdvice(totalMemBytes: number, model: string): string {
  const tier = recommendModel(totalMemBytes);
  if (!tier) return 'total RAM could not be detected — see the model sizing table in the README';

  const size = formatGb(totalMemBytes);
  const configured = tierIndexOf(model);
  const recommended = tierIndexOf(tier.model);

  if (configured === -1) {
    return `${size} total RAM — recommended vision model: ${tier.model} (${tier.download} download)`;
  }
  if (configured === recommended) {
    return `${size} total RAM — ${model} is the right size for this machine`;
  }
  if (configured > recommended) {
    const heavy = MODEL_TIERS[configured];
    return `${size} total RAM — ${model} is sized for ${heavy?.ram ?? 'a larger machine'}; ${tier.model} (${tier.download} download) fits this machine better`;
  }
  return `${size} total RAM — ${model} will run, but this machine can handle ${tier.model} (${tier.download} download)`;
}

/**
 * The sizing paragraph inside a "model is missing" remediation. Empty when RAM
 * is undetectable, so the caller simply drops the section.
 */
export function sizingLines(totalMemBytes: number, model: string): string[] {
  const tier = recommendModel(totalMemBytes);
  if (!tier) return [];

  const size = formatGb(totalMemBytes);
  if (normalizeTag(tier.model) === normalizeTag(model)) {
    return ['', `This machine has ${size} of RAM; ${model} is the right size for it.`];
  }
  return [
    '',
    `This machine has ${size} of RAM. The best fit for it is ${tier.model} (${tier.download} download):`,
    `  ollama pull ${tier.model}`,
    `  offgrid-vision analyze <file> --model ${tier.model}   (or set OFFGRID_MODEL=${tier.model})`,
  ];
}

/**
 * The whole tier table, for the unreachable-host remediation — that path runs
 * inside the backend, which knows a host but not this machine's RAM.
 */
export function tierTableLines(indent: string): string[] {
  const width = Math.max(...MODEL_TIERS.map((tier) => tier.ram.length));
  return MODEL_TIERS.map(
    (tier) => `${indent}${tier.ram.padEnd(width)}   ollama pull ${tier.model}   (${tier.download} download)`,
  );
}
