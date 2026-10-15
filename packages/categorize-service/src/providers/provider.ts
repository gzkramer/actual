export type ProviderErrorReason = 'unavailable' | 'timeout' | 'error';

export class ProviderError extends Error {
  reason: ProviderErrorReason;

  constructor(reason: ProviderErrorReason, message: string) {
    super(message);
    this.reason = reason;
  }
}

/**
 * A model backend. `complete` sends one prompt and returns the model's raw
 * text reply, throwing a ProviderError on failure. `authToken` is the
 * caller's credential for the backend, used for that call only.
 */
export type Provider = {
  name: string;
  model: string;
  complete(
    prompt: string,
    timeoutMs: number,
    authToken?: string,
  ): Promise<string>;
  isReady(): Promise<boolean>;
};
