import { describe, expect, it } from "vitest";
import { clearCacheForTests } from "../src/api/cacheLayer.js";
import { checkQuotaBudget, resetQuotaForTests } from "../src/api/quotaManager.js";
import { SlidingWindowRateLimiter } from "../src/api/rateLimiter.js";
import { youtubeApiRequest, type YouTubeFetch } from "../src/api/youtubeApiWrapper.js";
import { enrichChannelMetrics } from "../src/services/youtube/youtubeService.js";

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => body,
    text: async () => JSON.stringify(body)
  } as Response;
}

describe("quota-safe YouTube API controls", () => {
  it("queues high-frequency search-style work instead of failing", async () => {
    const limiter = new SlidingWindowRateLimiter(1, 20);
    const started: number[] = [];
    await Promise.all([
      limiter.schedule(async () => started.push(Date.now())),
      limiter.schedule(async () => started.push(Date.now()))
    ]);

    expect(started).toHaveLength(2);
    expect(started[1] - started[0]).toBeGreaterThanOrEqual(15);
  });

  it("disables search.list when remaining quota is below 200 units", () => {
    resetQuotaForTests(9850);
    const searchDecision = checkQuotaBudget("search.list");
    const channelDecision = checkQuotaBudget("channels.list");
    resetQuotaForTests(0);

    expect(searchDecision.allowed).toBe(false);
    expect(searchDecision.reason).toContain("below 200");
    expect(channelDecision.allowed).toBe(true);
  });

  it("serves cached channel requests without repeating API calls", async () => {
    clearCacheForTests();
    resetQuotaForTests(0);
    let calls = 0;
    const fetchImpl: YouTubeFetch = async () => {
      calls += 1;
      return jsonResponse({ items: [{ id: "c1" }] });
    };

    const input = {
      action: "channels.list" as const,
      path: "channels",
      params: { part: "snippet,statistics", id: "c1", maxResults: 50 },
      apiKey: "key",
      cacheNamespace: "channel" as const,
      cacheTtlMs: 86_400_000,
      fallback: { items: [] },
      fetchImpl
    };

    const first = await youtubeApiRequest(input);
    const second = await youtubeApiRequest(input);

    expect(first.apiCalled).toBe(true);
    expect(second.fromCache).toBe(true);
    expect(calls).toBe(1);
  });

  it("batches channel enrichment into groups of at most 50 ids", async () => {
    clearCacheForTests();
    resetQuotaForTests(0);
    const requestedIds: string[] = [];
    const fetchImpl: YouTubeFetch = async (input) => {
      const url = input instanceof URL ? input : new URL(String(input));
      requestedIds.push(url.searchParams.get("id") || "");
      return jsonResponse({ items: [] });
    };

    const ids = Array.from({ length: 60 }, (_, index) => `channel_${index}`);
    const result = await enrichChannelMetrics("key", ids, fetchImpl);

    expect(result.requests_made).toBe(2);
    expect(requestedIds[0].split(",")).toHaveLength(50);
    expect(requestedIds[1].split(",")).toHaveLength(10);
  });
});
