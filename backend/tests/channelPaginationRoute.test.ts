import { describe, expect, it } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { initializeDatabase, openDatabase } from "../src/lib/db.js";
import { handleJobsRoute } from "../src/routes/jobs.js";

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

describe("channel pagination route", () => {
  it("filters and paginates channel rows on the backend", async () => {
    const db = openDatabase(":memory:");
    try {
      initializeDatabase(db);
      db.prepare(
        `INSERT INTO jobs (
          id, keyword, lookback_days, subscriber_min, subscriber_max, max_candidates, shortlist_size,
          minimum_pre_score, content_type, region, language, status, stage, config_json, error_message, created_at, updated_at
        ) VALUES ('job_1', 'phone', 30, 0, 0, 10, 5, 0, 'all', '', '', 'draft', 'pre_score', '{}', NULL, '2026-04-14T00:00:00.000Z', '2026-04-14T00:00:00.000Z')`
      ).run();
      db.prepare(
        `INSERT INTO results (
          id, job_id, keyword, video_id, video_url, title, published_at, raw_search_rank, search_page,
          search_source, views, likes, comments, subscribers, channel_id, channel_title, channel_description,
          channel_country, channel_normalized_country, channel_language, channel_video_count, days_since_publish,
          engagement_rate, view_sub_ratio, pre_score, status, created_at, updated_at
        ) VALUES (?, 'job_1', 'phone', ?, ?, ?, '2026-04-10T00:00:00.000Z', ?, 1, 'youtube_api_search',
          1000, 20, 4, ?, ?, ?, '', ?, ?, ?, 12, ?, 0.024, 0.2, ?, 'pre_scored',
          '2026-04-14T00:00:00.000Z', '2026-04-14T00:00:00.000Z')`
      ).run("r1", "v1", "https://www.youtube.com/watch?v=v1", "US phone", 1, 5000, "channel_1", "Creator US", "US", "United States", "en", 5, 80);
      db.prepare(
        `INSERT INTO results (
          id, job_id, keyword, video_id, video_url, title, published_at, raw_search_rank, search_page,
          search_source, views, likes, comments, subscribers, channel_id, channel_title, channel_description,
          channel_country, channel_normalized_country, channel_language, channel_video_count, days_since_publish,
          engagement_rate, view_sub_ratio, pre_score, status, created_at, updated_at
        ) VALUES (?, 'job_1', 'phone', ?, ?, ?, '2026-04-10T00:00:00.000Z', ?, 1, 'youtube_api_search',
          1000, 20, 4, ?, ?, ?, '', ?, ?, ?, 12, ?, 0.024, 0.2, ?, 'pre_scored',
          '2026-04-14T00:00:00.000Z', '2026-04-14T00:00:00.000Z')`
      ).run("r2", "v2", "https://www.youtube.com/watch?v=v2", "JP phone", 2, 6000, "channel_2", "Creator JP", "JP", "Japan", "ja", 5, 90);

      const response = createResponse();
      await handleJobsRoute(
        createRequest("/api/jobs/job_1/channels?region=US&language=en&minFollowers=1000&maxFollowers=10000&age=30&page=1&pageSize=1"),
        response,
        "/api/jobs/job_1/channels",
        db
      );

      expect(response.statusCodeValue).toBe(200);
      const body = JSON.parse(response.body || "{}") as { total: number; items: Array<{ channel_id: string; country: string; language: string }> };
      expect(body.total).toBe(1);
      expect(body.items).toHaveLength(1);
      expect(body.items[0]).toMatchObject({
        channel_id: "channel_1",
        country: "United States",
        language: "English"
      });
    } finally {
      db.close();
    }
  });
});
