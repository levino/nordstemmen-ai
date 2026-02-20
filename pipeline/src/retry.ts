/**
 * Retry a function with exponential backoff.
 *
 * @param fn - Async function to retry
 * @param opts.retries - Max number of retries (default 5)
 * @param opts.baseDelay - Initial delay in ms (default 2000)
 * @param opts.shouldRetry - Predicate to decide if error is retryable
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: {
    retries?: number;
    baseDelay?: number;
    shouldRetry?: (error: unknown) => boolean;
  } = {},
): Promise<T> {
  const { retries = 5, baseDelay = 2000, shouldRetry = () => true } = opts;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt >= retries || !shouldRetry(error)) throw error;
      const delay = baseDelay * 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

/**
 * Run async tasks with limited concurrency (semaphore pattern).
 */
export async function withConcurrency<T>(tasks: Array<() => Promise<T>>, concurrency: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < tasks.length) {
      const index = nextIndex++;
      results[index] = await tasks[index]();
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
