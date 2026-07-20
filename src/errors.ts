export const EXIT = {
  SUCCESS: 0,
  RUNTIME: 1,
  USAGE: 2,
  BACKEND: 3,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

export type ErrorCode =
  | 'TIMEOUT'
  | 'PARSE_ERROR'
  | 'BACKEND_UNAVAILABLE'
  | 'UNSUPPORTED_FORMAT'
  | 'IO_ERROR';

/** Bad flags or arguments. Exits with code 2. */
export class UsageError extends Error {
  override readonly name = 'UsageError';
}

/** Ollama unreachable or the model is missing. Exits with code 3. */
export class BackendUnavailableError extends Error {
  override readonly name = 'BackendUnavailableError';

  /** Multi-line, actionable remediation shown to the user verbatim. */
  readonly remediation: string;

  constructor(message: string, remediation: string) {
    super(message);
    this.remediation = remediation;
  }
}
