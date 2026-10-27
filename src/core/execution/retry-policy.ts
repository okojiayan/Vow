export interface RetryPolicy {
  maxAttempts: number;
  retryOn: (error: unknown) => boolean;
}

export const defaultRetryPolicy: RetryPolicy = {
  maxAttempts: 2,
  retryOn: (error) => {
    const message = error instanceof Error ? error.message : String(error);
    return /timeout|temporar|busy|econnreset/i.test(message);
  },
};

export async function withRetries<T>(policy: RetryPolicy, fn: (attempt: number) => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= policy.maxAttempts || !policy.retryOn(error)) {
        throw error;
      }
    }
  }
  throw lastError;
}
