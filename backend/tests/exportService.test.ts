import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { createExportRows, exportColumns, writeCsvExport, writeXlsxExport } from "../src/services/export/exportService.js";
import type { CreatorResult } from "../src/types/result.js";

const tempFiles: string[] = [];

function createResult(overrides: Partial<CreatorResult> = {}): CreatorResult {
  return {
    id: "result-1",
    job_id: "job-1",
    keyword: "iphone accessories",
    video_id: "abc123",
    video_url: "https://www.youtube.com/watch?v=abc123",
    title: "Test Video",
    published_at: "2026-04-10T00:00:00.000Z",
    raw_search_rank: 1,
    search_page: 1,
    search_source: "youtube_api_search",
    views: 10000,
    likes: 300,
    comments: 50,
    subscribers: 12000,
    channel_id: "channel-1",
    channel_title: "Creator One",
    channel_description: null,
    channel_language: null,
    channel_normalized_country: null,
    channel_video_count: 0,
    similar_channels_json: null,
    channel_avatar_url: null,
    channel_country: null,
    days_since_publish: 4,
    engagement_rate: 0.04,
    comment_rate: 0.005,
    view_sub_ratio: 0.833,
    relative_velocity: 0.208,
    sub_fit_score: 1,
    view_sub_score: 1,
    engagement_score: 0.8,
    comment_score: 1,
    relative_velocity_score: 1,
    pre_score: 96,
    pre_score_breakdown_json: "{}",
    avg_views: 18000,
    avg_views_score: 70,
    creator_engagement_score: 80,
    subscriber_score: 68,
    creator_score: 72.6,
    creator_score_breakdown_json: "{}",
    opportunity_tier: "A",
    public_email: null,
    social_links_json: null,
    website_url: null,
    contactability_score: null,
    contact_status: null,
    raw_comet_output: null,
    comet_video_summary: null,
    comet_comments_summary: null,
    minimax_content_type: null,
    minimax_content_fit_score: null,
    minimax_audience_fit_score: null,
    minimax_brand_safety_score: null,
    minimax_commercial_intent_score: null,
    minimax_reason: null,
    minimax_status: null,
    minimax_error: null,
    final_score: null,
    final_score_breakdown_json: null,
    outreach_priority: null,
    status: "shortlisted",
    created_at: "2026-04-14T00:00:00.000Z",
    updated_at: "2026-04-14T00:00:00.000Z",
    ...overrides
  };
}

afterEach(() => {
  for (const file of tempFiles.splice(0)) {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
});

describe("export service", () => {
  it("creates export rows with explicit lightweight columns", () => {
    const rows = createExportRows([createResult()]);
    const labels = exportColumns.map((column) => column.label);
    expect(Object.keys(rows[0])).toEqual(labels);
    expect(rows[0][labels[0]]).toBe("Creator One");
    expect(rows[0][labels[1]]).toBe("https://www.youtube.com/channel/channel-1");
    expect(rows[0][labels[5]]).toBe("12K");
    expect(labels).not.toContain("互动率");
    expect(labels).not.toContain("平均播放量");
    expect(labels).not.toContain("播粉比");
    expect(labels).not.toContain("Creator Score");
    expect(labels).not.toContain("Pre Score");
  });

  it("formats subscriber counts with K/M units", () => {
    const rows = createExportRows([
      createResult({ subscribers: 999 }),
      createResult({ subscribers: 12500 }),
      createResult({ subscribers: 2300000 })
    ]);
    const subscriberLabel = exportColumns[5].label;
    expect(rows[0][subscriberLabel]).toBe("999");
    expect(rows[1][subscriberLabel]).toBe("12.5K");
    expect(rows[2][subscriberLabel]).toBe("2.3M");
  });

  it("writes CSV and XLSX exports that include the expected headers", () => {
    const rows = createExportRows([createResult()]);
    const csvPath = path.join(os.tmpdir(), `creator-pipeline-${Date.now()}.csv`);
    const xlsxPath = path.join(os.tmpdir(), `creator-pipeline-${Date.now()}.xlsx`);
    tempFiles.push(csvPath, xlsxPath);

    writeCsvExport(csvPath, rows);
    writeXlsxExport(xlsxPath, rows);

    const csvContent = fs.readFileSync(csvPath, "utf8");
    expect(csvContent).toContain(exportColumns[0].label);
    expect(csvContent).toContain("Creator One");
    expect(fs.existsSync(xlsxPath)).toBe(true);
    expect(fs.statSync(xlsxPath).size).toBeGreaterThan(0);
  });
});
