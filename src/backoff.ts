export interface BackoffOptions {
  baseMs: number;
  capMs: number;
}

/**
 * Exponential backoff with "equal jitter": half fixed, half random.
 * Jitter stops many failed deliveries from retrying at the same instant (retry storms).
 * attempt is the number of attempts already made (1 after the first failure).
 */
export function backoffMs(attempt: number, opts: BackoffOptions, random: () => number = Math.random): number {
  const exp = Math.min(opts.capMs, opts.baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.round(exp / 2 + random() * (exp / 2));
}
