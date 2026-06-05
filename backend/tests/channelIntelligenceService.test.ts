import { describe, expect, it } from "vitest";
import { detectLanguage } from "../src/services/channelIntelligence/languageDetector.js";
import { normalizeCountryCode } from "../src/services/channelIntelligence/countryMap.js";
import { extractEmails, extractPublicEmail } from "../src/services/channelIntelligence/emailExtractor.js";
import { enrichChannelIntelligence, listChannelIntelligence } from "../src/services/channelIntelligence/channelIntelligenceService.js";
import { initializeDatabase, openDatabase } from "../src/lib/db.js";
import type { YouTubeFetch } from "../src/services/youtube/youtubeService.js";

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    json: async () => body,
    text: async () => String(body)
  } as Response;
}

describe("channel intelligence helpers", () => {
  it("detects language with safe unknown fallback", () => {
    expect(detectLanguage(["这是一个中文频道", "科技评测"])).toBe("zh");
    expect(detectLanguage(["Japanese title", "こんにちは レビュー"])).toBe("ja");
    expect(detectLanguage(["Best phone review and tutorial for creators"])).toBe("en");
    expect(detectLanguage([""])).toBe("unknown");
  });

  it("normalizes country codes without throwing", () => {
    expect(normalizeCountryCode("US")).toBe("United States");
    expect(normalizeCountryCode("UK")).toBe("United Kingdom");
    expect(normalizeCountryCode("ZZ")).toBe("ZZ");
    expect(normalizeCountryCode(null)).toBe("");
  });

  it("extracts public email from description before remote fallbacks", async () => {
    expect(extractEmails("Contact: Hello@Example.COM.")).toEqual(["hello@example.com"]);
    const email = await extractPublicEmail({ description: "business@test.com" });
    expect(email).toBe("business@test.com");
  });
});

describe("channel intelligence output", () => {
  it("returns channel-level deduped output and defaults when API data is empty", async () => {
    const db = openDatabase(":memory:");
    try {
      initializeDatabase(db);
      db.prepare(
        `INSERT INTO jobs (
          id, keyword, lookback_days, subscriber_min, subscriber_max, max_candidates, shortlist_size,
          minimum_pre_score, status, stage, config_json, error_message, created_at, updated_at
        ) VALUES ('job_1', 'phone', 30, 3000, 50000, 10, 5, 55, 'draft', 'created', '{}', NULL, '2026-04-14T00:00:00.000Z', '2026-04-14T00:00:00.000Z')`
      ).run();
      db.prepare(
        `INSERT INTO results (
          id, job_id, keyword, video_id, video_url, title, published_at, raw_search_rank, search_page,
          search_source, views, likes, comments, subscribers, channel_id, channel_title, channel_description,
          channel_country, status, created_at, updated_at
        ) VALUES (?, 'job_1', 'phone', ?, ?, ?, '2026-04-10T00:00:00.000Z', ?, 1, 'youtube_api_search', 1000, 10, 2, 12000, 'channel_1', 'Phone Lab', 'Contact team@phonelab.test for business', 'US', 'enriched', '2026-04-14T00:00:00.000Z', '2026-04-14T00:00:00.000Z')`
      ).run("r1", "v1", "https://www.youtube.com/watch?v=v1", "Best phone review", 1);
      db.prepare(
        `INSERT INTO results (
          id, job_id, keyword, video_id, video_url, title, published_at, raw_search_rank, search_page,
          search_source, views, likes, comments, subscribers, channel_id, channel_title, channel_description,
          channel_country, status, created_at, updated_at
        ) VALUES (?, 'job_1', 'phone', ?, ?, ?, '2026-04-11T00:00:00.000Z', ?, 1, 'youtube_api_search', 800, 9, 1, 12000, 'channel_1', 'Phone Lab', '', 'US', 'enriched', '2026-04-14T00:00:00.000Z', '2026-04-14T00:00:00.000Z')`
      ).run("r2", "v2", "https://www.youtube.com/watch?v=v2", "Camera test", 2);

      const fetchImpl: YouTubeFetch = async () =>
        jsonResponse({
          items: [
            { id: { channelId: "channel_1" }, snippet: { title: "Current" } },
            { id: { channelId: "channel_2" }, snippet: { title: "Similar A" } },
            { id: { channelId: "channel_2" }, snippet: { title: "Duplicate" } },
            { id: { channelId: "channel_3" }, snippet: { title: "Similar B" } }
          ]
        });

      const run = await enrichChannelIntelligence(db, "job_1", { apiKey: "key", keyword: "phone", fetchImpl });
      const channels = listChannelIntelligence(db, "job_1");
      expect(run.channel_count).toBe(1);
      expect(channels).toHaveLength(1);
      expect(channels[0]).toMatchObject({
        channel_id: "channel_1",
        channel_url: "https://www.youtube.com/channel/channel_1",
        country: "United States",
        email: "team@phonelab.test"
      });
      expect(channels[0]?.similar_channels).toEqual([
        { channel_id: "channel_2", channel_name: "Similar A" },
        { channel_id: "channel_3", channel_name: "Similar B" }
      ]);
    } finally {
      db.close();
    }
  });
});
