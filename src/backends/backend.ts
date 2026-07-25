export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  /** Base64-encoded image payloads, no data: URI prefix. */
  images?: string[];
}

export interface ChatOptions {
  model: string;
  timeoutMs: number;
  /**
   * Context window to request. Required, not optional: Ollama silently falls
   * back to a 4096-token default when the client omits it, which is far below
   * what these vision models support and smaller than a single screenshot.
   */
  numCtx: number;
}

/** The per-file deadline elapsed (FR-1.9). Maps to the TIMEOUT result code. */
export class TimeoutError extends Error {
  override readonly name = 'TimeoutError';
}

/**
 * A local multimodal inference backend. v1 ships only Ollama, but analyze/doctor
 * depend on this interface alone so LM Studio or an OpenAI-compatible endpoint
 * can be added without touching the command layer.
 */
export interface Backend {
  readonly name: string;
  readonly host: string;
  /** Resolves if reachable; throws BackendUnavailableError otherwise. */
  ping(): Promise<void>;
  listModels(): Promise<string[]>;
  /** Returns the assistant's raw reply text. */
  chat(messages: ChatMessage[], opts: ChatOptions): Promise<string>;
}
