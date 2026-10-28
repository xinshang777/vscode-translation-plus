/** 对应 util/RateLimiter.kt + translator.intervalLimit：同一引擎两次请求的最小间隔。 */
import { delay } from './util';

const lastCall = new Map<string, number>();

export async function waitForSlot(engineId: string, minIntervalMs: number): Promise<void> {
  if (!minIntervalMs || minIntervalMs <= 0) {
    return;
  }
  const previous = lastCall.get(engineId) ?? 0;
  const wait = previous + minIntervalMs - Date.now();
  if (wait > 0) {
    await delay(wait);
  }
  lastCall.set(engineId, Date.now());
}

export function resetRateLimiter(): void {
  lastCall.clear();
}
