/**
 * Static on purpose: a config resolved on one machine must mean the same thing
 * on another. `doctor` is what adapts advice to local RAM (see models.ts).
 */
export const DEFAULT_MODEL = 'qwen3.5:4b';
export const DEFAULT_HOST = 'http://localhost:11434';
export const DEFAULT_TIMEOUT_MS = 120000;

export interface ConfigFlags {
  model?: string;
  host?: string;
  timeout?: number;
}

export interface ResolvedConfig {
  model: string;
  host: string;
  timeoutMs: number;
}

function normalizeHost(host: string): string {
  const withScheme = /^https?:\/\//i.test(host) ? host : `http://${host}`;
  return withScheme.replace(/\/+$/, '');
}

function positiveInt(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.floor(parsed);
}

/** An empty or whitespace-only env value is treated the same as unset. */
function nonEmpty(value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  return value;
}

export function resolveConfig(flags: ConfigFlags, env: NodeJS.ProcessEnv): ResolvedConfig {
  const host = flags.host ?? nonEmpty(env.OLLAMA_HOST) ?? DEFAULT_HOST;
  const timeoutMs =
    (flags.timeout !== undefined && flags.timeout > 0 ? Math.floor(flags.timeout) : undefined) ??
    positiveInt(env.OFFGRID_TIMEOUT) ??
    DEFAULT_TIMEOUT_MS;

  return {
    model: flags.model ?? nonEmpty(env.OFFGRID_MODEL) ?? DEFAULT_MODEL,
    host: normalizeHost(host),
    timeoutMs,
  };
}

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0']);

export function isLocalHost(host: string): boolean {
  try {
    const { hostname } = new URL(normalizeHost(host));
    return LOOPBACK_HOSTNAMES.has(hostname) || hostname.endsWith('.localhost');
  } catch {
    return false;
  }
}
