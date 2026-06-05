import type { SqliteDatabase } from "../../lib/db.js";
import type { ChannelIntelligenceOutput, SimilarChannelOutput } from "../../types/channelIntelligence.js";
import { detectLanguage } from "./languageDetector.js";
import { extractPublicEmail } from "./emailExtractor.js";
import { normalizeCountryCode } from "./countryMap.js";
import { uniqueByChannelId } from "./dedupe.js";
import { searchSimilarChannels, type YouTubeFetch } from "../youtube/youtubeService.js";

interface ChannelRow {
  channel_id: string;
  channel_title: string | null;
  channel_country: string | null;
  channel_description: string | null;
  channel_language: string | null;
  channel_normalized_country: string | null;
  channel_video_count: number;
  public_email: string | null;
  website_url: string | null;
  subscribers: number;
  similar_channels_json: string | null;
  video_titles_json: string;
}

export interface RunChannelIntelligenceInput {
  apiKey?: string | null;
  keyword: string;
  fetchImpl?: YouTubeFetch;
}

function channelUrl(channelId: string): string {
  return channelId ? `https://www.youtube.com/channel/${channelId}` : "";
}

function parseSimilarChannels(raw: string | null | undefined): SimilarChannelOutput[] {
  try {
    const parsed = JSON.parse(raw || "[]") as SimilarChannelOutput[];
    const seen = new Set<string>();
    return parsed
      .filter((item) => item?.channel_id && !seen.has(item.channel_id) && seen.add(item.channel_id))
      .slice(0, 5)
      .map((item) => ({
        channel_name: item.channel_name || "",
        channel_id: item.channel_id || ""
      }));
  } catch {
    return [];
  }
}

function parseVideoTitles(raw: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(raw || "[]") as string[];
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function normalizeLanguageLabel(input: string | null | undefined): string {
  const value = String(input ?? "").trim();
  if (!value || value.toLowerCase() === "unknown") return "Other";
  const key = value.toLowerCase();
  const prefix = key.split("-")[0] ?? key;
  const labels: Record<string, string> = {
    en: "English",
    zh: "Chinese",
    ja: "Japanese",
    ko: "Korean",
    es: "Spanish",
    fr: "French",
    de: "German",
    pt: "Portuguese",
    ru: "Russian"
  };
  return labels[key] ?? labels[prefix] ?? value;
}

function toOutput(row: ChannelRow): ChannelIntelligenceOutput {
  const channelId = row.channel_id || "";
  return {
    channel_name: row.channel_title || "",
    channel_id: channelId,
    channel_url: channelUrl(channelId),
    country: row.channel_normalized_country || normalizeCountryCode(row.channel_country) || "Other",
    language: normalizeLanguageLabel(row.channel_language),
    email: row.public_email || null,
    description: row.channel_description || "",
    subscriber_count: row.subscribers || 0,
    video_count: row.channel_video_count || 0,
    similar_channels: parseSimilarChannels(row.similar_channels_json)
  };
}

export function listChannelIntelligence(db: SqliteDatabase, jobId: string): ChannelIntelligenceOutput[] {
  try {
    const rows = db
      .prepare(
        `SELECT
          channel_id,
          MAX(channel_title) AS channel_title,
          MAX(channel_country) AS channel_country,
          MAX(channel_description) AS channel_description,
          MAX(channel_language) AS channel_language,
          MAX(channel_normalized_country) AS channel_normalized_country,
          MAX(channel_video_count) AS channel_video_count,
          MAX(public_email) AS public_email,
          MAX(website_url) AS website_url,
          MAX(subscribers) AS subscribers,
          MAX(similar_channels_json) AS similar_channels_json,
          json_group_array(COALESCE(title, '')) AS video_titles_json
        FROM results
        WHERE job_id = ? AND COALESCE(channel_id, '') <> ''
        GROUP BY channel_id
        ORDER BY MAX(pre_score) DESC, MIN(raw_search_rank) ASC`
      )
      .all(jobId) as unknown as ChannelRow[];

    return uniqueByChannelId(rows).map(toOutput);
  } catch {
    return [];
  }
}

export async function enrichChannelIntelligence(
  db: SqliteDatabase,
  jobId: string,
  input: RunChannelIntelligenceInput
): Promise<{ channel_count: number; similar_request_count: number }> {
  try {
    const rows = db
      .prepare(
        `SELECT
          channel_id,
          MAX(channel_title) AS channel_title,
          MAX(channel_country) AS channel_country,
          MAX(channel_description) AS channel_description,
          MAX(channel_language) AS channel_language,
          MAX(channel_normalized_country) AS channel_normalized_country,
          MAX(channel_video_count) AS channel_video_count,
          MAX(public_email) AS public_email,
          MAX(website_url) AS website_url,
          MAX(subscribers) AS subscribers,
          MAX(similar_channels_json) AS similar_channels_json,
          json_group_array(COALESCE(title, '')) AS video_titles_json
        FROM results
        WHERE job_id = ? AND COALESCE(channel_id, '') <> ''
        GROUP BY channel_id
        ORDER BY MIN(raw_search_rank) ASC`
      )
      .all(jobId) as unknown as ChannelRow[];

    let similarRequestCount = 0;
    for (const row of uniqueByChannelId(rows)) {
      const titles = parseVideoTitles(row.video_titles_json);
      const country = normalizeCountryCode(row.channel_country);
      const language = detectLanguage([row.channel_title, row.channel_description, ...titles]);
      const email =
        row.public_email ||
        (await extractPublicEmail({
          channelUrl: channelUrl(row.channel_id),
          description: row.channel_description,
          websiteUrl: row.website_url,
          fetchImpl: input.fetchImpl
        }));
      const similar = input.apiKey
        ? await searchSimilarChannels({
            apiKey: input.apiKey,
            channelId: row.channel_id,
            channelTitle: row.channel_title || "",
            keyword: input.keyword,
            fetchImpl: input.fetchImpl
          })
        : { channels: [], requests_made: 0 };
      similarRequestCount += similar.requests_made;
      const seen = new Set<string>();
      const similarChannels = similar.channels
        .filter((item) => item.channel_id !== row.channel_id && !seen.has(item.channel_id) && seen.add(item.channel_id))
        .slice(0, 5);

      db.prepare(
        `UPDATE results SET
          channel_normalized_country = ?,
          channel_language = ?,
          public_email = COALESCE(public_email, ?),
          similar_channels_json = ?,
          updated_at = datetime('now')
        WHERE job_id = ? AND channel_id = ?`
      ).run(country, language, email, JSON.stringify(similarChannels), jobId, row.channel_id);
    }

    return { channel_count: rows.length, similar_request_count: similarRequestCount };
  } catch {
    return { channel_count: 0, similar_request_count: 0 };
  }
}
