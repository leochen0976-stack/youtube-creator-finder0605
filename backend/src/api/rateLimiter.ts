import type { YouTubeApiAction } from "./quotaManager.js";

interface QueueItem {
  run: () => void;
}

export class SlidingWindowRateLimiter {
  private readonly timestamps: number[] = [];
  private readonly queue: QueueItem[] = [];
  private running = false;

  constructor(
    private readonly maxRequests: number,
    private readonly windowMs: number
  ) {}

  schedule<T>(task: () => Promise<T>): Promise<T> {
    return new Promise((resolve) => {
      this.queue.push({
        run: () => {
          task()
            .then(resolve)
            .catch(() => resolve(undefined as T));
        }
      });
      this.drain();
    });
  }

  private drain(): void {
    if (this.running) return;
    this.running = true;
    void this.process();
  }

  private async process(): Promise<void> {
    while (this.queue.length) {
      const now = Date.now();
      while (this.timestamps.length && now - this.timestamps[0] >= this.windowMs) {
        this.timestamps.shift();
      }

      if (this.timestamps.length >= this.maxRequests) {
        const waitMs = Math.max(1, this.windowMs - (now - this.timestamps[0]));
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        continue;
      }

      const next = this.queue.shift();
      if (!next) continue;
      this.timestamps.push(Date.now());
      next.run();
    }
    this.running = false;
  }
}

const limiters: Record<YouTubeApiAction, SlidingWindowRateLimiter> = {
  "search.list": new SlidingWindowRateLimiter(1, 5000),
  "channels.list": new SlidingWindowRateLimiter(5, 1000),
  "videos.list": new SlidingWindowRateLimiter(10, 1000)
};

export function scheduleYouTubeApiRequest<T>(action: YouTubeApiAction, task: () => Promise<T>): Promise<T> {
  return limiters[action].schedule(task);
}
