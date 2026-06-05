import { describe, expect, it } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { initializeDatabase, openDatabase } from "../src/lib/db.js";
import { handleSimilarCreatorsRoute } from "../src/routes/similarCreators.js";

function createRequest(url: string): IncomingMessage {
  return {
    method: "GET",
    url
  } as IncomingMessage;
}

function createResponse(): ServerResponse & { statusCodeValue?: number; body?: string } {
  return {
    writeHead(statusCode: number) {
      this.statusCodeValue = statusCode;
      return this;
    },
    end(chunk?: unknown) {
      this.body = String(chunk ?? "");
      return this;
    }
  } as ServerResponse & { statusCodeValue?: number; body?: string };
}

describe("similar creators route", () => {
  it("returns scored similar creators without recommending the current channel", async () => {
    const db = openDatabase(":memory:");
    try {
      initializeDatabase(db);
      db.prepare(
        `INSERT INTO jobs (
          id, keyword, lookback_days, subscriber_min, subscriber_max, max_candidates, shortlist_size,
          minimum_pre_score, content_type, region, language, status, stage, config_json, error_message, created_at, updated_at
        ) VALUES
          ('job_1', 'Slime RNG', 30, 0, 0, 10, 5, 0, 'all', '', '', 'draft', 'pre_score', '{}', NULL, '2026-04-14T00:00:00.000Z', '2026-04-14T00:00:00.000Z'),
          ('job_2', 'Slime RNG', 30, 0, 0, 10, 5, 0, 'all', '', '', 'draft', 'pre_score', '{}', NULL, '2026-04-14T00:00:00.000Z', '2026-04-14T00:00:00.000Z')`
      ).run();

      const insert = db.prepare(
        `INSERT INTO results (
          id, job_id, keyword, video_id, video_url, title, published_at, raw_search_rank, search_page,
          search_source, views, likes, comments, subscribers, channel_id, channel_title, channel_description,
          channel_country, channel_normalized_country, channel_language, channel_video_count,
          engagement_rate, view_sub_ratio, pre_score, status, created_at, updated_at
        ) VALUES (?, ?, 'Slime RNG', ?, ?, ?, '2026-04-10T00:00:00.000Z', ?, 1, 'youtube_api_search',
          1000, 20, 4, ?, ?, ?, ?, 'US', 'United States', 'en', 12, 0.024, 0.2, ?, 'pre_scored',
          '2026-04-14T00:00:00.000Z', '2026-04-14T00:00:00.000Z')`
      );
      insert.run("target", "job_1", "v1", "https://www.youtube.com/watch?v=v1", "Target", 1, 5000, "channel_target", "Target Creator", "Business target@example.com", 80);
      insert.run("similar", "job_2", "v2", "https://www.youtube.com/watch?v=v2", "Similar", 2, 5200, "channel_similar", "Similar Creator", "Business similar@example.com", 90);
      insert.run("same_channel", "job_2", "v3", "https://www.youtube.com/watch?v=v3", "Same", 3, 5100, "channel_target", "Target Duplicate", "", 99);

      const response = createResponse();
      await handleSimilarCreatorsRoute(createRequest("/api/similar-creators?id=target&limit=6"), response, "/api/similar-creators", db);

      expect(response.statusCodeValue).toBe(200);
      const body = JSON.parse(response.body || "{}") as { items: Array<{ channel_id: string; similarity_score: number; email: string | null }> };
      expect(body.items).toHaveLength(1);
      expect(body.items[0]?.channel_id).toBe("channel_similar");
      expect(body.items[0]?.similarity_score).toBeGreaterThan(80);
      expect(body.items[0]?.email).toBe("similar@example.com");
    } finally {
      db.close();
    }
  });
});
