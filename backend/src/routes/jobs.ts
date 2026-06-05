import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { env } from "../config/env.js";
import type { SqliteDatabase } from "../lib/db.js";
import { stringifyJson } from "../lib/json.js";
import { nowIso } from "../lib/time.js";
import { createJobSchema } from "../schemas/jobSchemas.js";
import { runExportSchema } from "../schemas/exportSchemas.js";
import type { JobRecord } from "../types/job.js";
import type { CreatorResult } from "../types/result.js";
import type { ExportRecord } from "../types/export.js";
import {
  enrichChannelMetrics,
  enrichVideoMetrics,
  searchCandidates,
  YouTubeApiError,
  type YouTubeChannelMetric,
  type YouTubeSearchCandidate,
  type YouTubeVideoMetric
} from "../services/youtube/youtubeService.js";
import { getQuotaSummary, recordQuotaUsage } from "../services/youtube/quotaService.js";
import { computeCreatorScore, computePreScore } from "../services/scoring/scoringService.js";
import { createExportFile } from "../services/export/exportService.js";
import {
  enrichChannelIntelligence,
  listChannelIntelligence
} from "../services/channelEnrichmentService.js";
import { normalizeCountryCode } from "../services/channelIntelligence/countryMap.js";
import { getRegionCountryCodes, isRegionValue } from "../services/channelIntelligence/regionMap.js";
import { detectLanguage } from "../services/channelIntelligence/languageDetector.js";
import { extractEmails } from "../services/channelIntelligence/emailExtractor.js";
import type { ChannelIntelligenceOutput, SimilarChannelOutput } from "../types/channelIntelligence.js";

export interface RouteResult {
  handled: boolean;
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function methodNotAllowed(res: ServerResponse): RouteResult {
  sendJson(res, 405, { ok: false, error: "Method not allowed" });
  return { handled: true };
}

function notFound(res: ServerResponse, message = "Not found"): RouteResult {
  sendJson(res, 404, { ok: false, error: message });
  return { handled: true };
}

function structuredError(error: unknown): Record<string, unknown> {
  if (error instanceof YouTubeApiError) {
    return {
      type: "youtube_api_error",
      message: error.message,
      status_code: error.statusCode,
      api_status: error.apiStatus
    };
  }
  return {
    type: "internal_error",
    message: error instanceof Error ? error.message : "Unknown error"
  };
}

function getJob(db: SqliteDatabase, jobId: string): JobRecord | null {
  return (
    (db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId) as JobRecord | undefined) || null
  );
}

function listResultsForJob(db: SqliteDatabase, jobId: string): CreatorResult[] {
  return db.prepare("SELECT * FROM results WHERE job_id = ? ORDER BY raw_search_rank ASC").all(jobId) as unknown as CreatorResult[];
}

function listExportsForJob(db: SqliteDatabase, jobId: string): ExportRecord[] {
  return db
    .prepare("SELECT * FROM exports WHERE job_id = ? ORDER BY created_at DESC")
    .all(jobId) as unknown as ExportRecord[];
}

interface ChannelListRow extends CreatorResult {
  total_filtered: number;
}

interface ChannelListQuery {
  contentType: "all" | "video" | "short" | "live";
  region: string;
  regions: string[];
  minFollowers: number;
  maxFollowers: number;
  language: string;
  languages: string[];
  age: number;
  minEngagementRate: number;
  minAvgViews: number;
  recentActivityDays: number;
  minUploadFrequency: number;
  page: number;
  pageSize: number;
  sortKey: string;
  sortDirection: "asc" | "desc";
}

interface ChannelListItem extends ChannelIntelligenceOutput {
  representative: CreatorResult | null;
}

function parsePositiveInt(value: string | null, fallback: number, max = Number.MAX_SAFE_INTEGER): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.trunc(parsed), max);
}

function parseNonnegativeInt(value: string | null, fallback = 0): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.trunc(parsed);
}

function parseNonnegativeFloat(value: string | null, fallback = 0): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

function parseCsv(value: string | null): string[] {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseChannelListQuery(req: IncomingMessage): ChannelListQuery {
  const url = new URL(req.url || "/", "http://localhost");
  const contentType = url.searchParams.get("contentType");
  const sortDirection = url.searchParams.get("sortDirection") === "asc" ? "asc" : "desc";
  return {
    contentType: contentType === "video" || contentType === "short" || contentType === "live" ? contentType : "all",
    region: (url.searchParams.get("region") || "").trim(),
    regions: parseCsv(url.searchParams.get("regions")),
    minFollowers: parseNonnegativeInt(url.searchParams.get("minFollowers")),
    maxFollowers: parseNonnegativeInt(url.searchParams.get("maxFollowers")),
    language: (url.searchParams.get("language") || "").trim(),
    languages: parseCsv(url.searchParams.get("languages")),
    age: parseNonnegativeInt(url.searchParams.get("age")),
    minEngagementRate: parseNonnegativeFloat(url.searchParams.get("minEngagementRate")),
    minAvgViews: parseNonnegativeFloat(url.searchParams.get("minAvgViews")),
    recentActivityDays: parseNonnegativeInt(url.searchParams.get("recentActivityDays")),
    minUploadFrequency: parseNonnegativeInt(url.searchParams.get("minUploadFrequency")),
    page: parsePositiveInt(url.searchParams.get("page"), 1),
    pageSize: parsePositiveInt(url.searchParams.get("pageSize"), 25, 100),
    sortKey: (url.searchParams.get("sortKey") || "creator_score").trim(),
    sortDirection
  };
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

function channelUrl(channelId: string | null): string {
  return channelId ? `https://www.youtube.com/channel/${channelId}` : "";
}

function toChannelListItem(row: CreatorResult): ChannelListItem {
  const country = normalizeCountryCode(row.channel_normalized_country || row.channel_country) || "Other";
  const quickLanguage = row.channel_language || detectLanguage([row.channel_title, row.channel_description, row.title]);
  const quickEmail = row.public_email || extractEmails(row.channel_description)[0] || null;
  const representative = { ...row } as CreatorResult;
  delete (representative as unknown as Record<string, unknown>).row_rank;
  delete (representative as unknown as Record<string, unknown>).total_filtered;
  return {
    channel_name: row.channel_title || "",
    channel_id: row.channel_id || "",
    channel_url: channelUrl(row.channel_id),
    country,
    language: normalizeLanguageLabel(quickLanguage),
    email: quickEmail,
    description: row.channel_description || "",
    subscriber_count: row.subscribers || 0,
    video_count: row.channel_video_count || 0,
    similar_channels: parseSimilarChannels(row.similar_channels_json),
    representative
  };
}

function listChannelsPage(db: SqliteDatabase, jobId: string, query: ChannelListQuery): {
  items: ChannelListItem[];
  total: number;
  page: number;
  pageSize: number;
} {
  const offset = (query.page - 1) * query.pageSize;
  const normalizedCountry = normalizeCountryCode(query.region);
  const requestedRegions = query.regions.length ? query.regions : query.region ? [query.region] : [];
  const countryFilterValues = requestedRegions
    .flatMap((region) => {
      const countries = getRegionCountryCodes(region);
      return countries.length ? countries : [region];
    })
    .flatMap((country) => [country, normalizeCountryCode(country)])
    .filter(Boolean);
  const countryFilters = countryFilterValues.length ? [...new Set(countryFilterValues)] : normalizedCountry ? [query.region, normalizedCountry].filter(Boolean) : [];
  const countryFilterJson = stringifyJson(countryFilters);
  const requestedLanguages = query.languages.length ? query.languages : query.language ? [query.language] : [];
  const languageFilters = requestedLanguages.flatMap((value) => {
    const language = value.toLowerCase();
    const languageLabel = normalizeLanguageLabel(value).toLowerCase();
    const languagePrefix = language.split("-")[0] ?? language;
    return [language, languageLabel, languagePrefix].filter(Boolean);
  });
  const languageFilterJson = stringifyJson([...new Set(languageFilters)]);
  const sortColumns: Record<string, string> = {
    channel_title: "LOWER(COALESCE(channel_title, ''))",
    subscribers: "subscribers",
    engagement_rate: "COALESCE(engagement_rate, -1)",
    view_sub_ratio: "COALESCE(view_sub_ratio, -1)",
    avg_views: "COALESCE(avg_views, -1)",
    creator_score: "COALESCE(creator_score, -1)",
    pre_score: "COALESCE(pre_score, -1)"
  };
  const orderColumn = sortColumns[query.sortKey] ?? sortColumns.creator_score;
  const orderDirection = query.sortDirection === "asc" ? "ASC" : "DESC";
  const rows = db
    .prepare(
      `WITH ranked AS (
        SELECT
          results.*,
          ROW_NUMBER() OVER (
            PARTITION BY channel_id
            ORDER BY
              CASE WHEN status = 'shortlisted' THEN 0 ELSE 1 END,
              COALESCE(creator_score, -1) DESC,
              COALESCE(pre_score, -1) DESC,
              COALESCE(raw_search_rank, 999999) ASC
          ) AS row_rank
        FROM results
        WHERE job_id = ? AND COALESCE(channel_id, '') <> ''
      ),
      filtered AS (
        SELECT *
        FROM ranked
        WHERE row_rank = 1
          AND (? = 0 OR subscribers >= ?)
          AND (? = 0 OR subscribers <= ?)
          AND (? = 0 OR COALESCE(days_since_publish, 999999) <= ?)
          AND (? = 0 OR COALESCE(days_since_publish, 999999) <= ?)
          AND (? = 0 OR COALESCE(engagement_rate, 0) >= ?)
          AND (? = 0 OR COALESCE(avg_views, views, 0) >= ?)
          AND (? = 0 OR channel_video_count >= ?)
          AND (
            json_array_length(?) = 0
            OR channel_normalized_country IN (SELECT value FROM json_each(?))
            OR UPPER(COALESCE(channel_country, '')) IN (SELECT UPPER(value) FROM json_each(?))
          )
          AND (
            json_array_length(?) = 0
            OR LOWER(COALESCE(channel_language, '')) IN (SELECT value FROM json_each(?))
            OR LOWER(substr(COALESCE(channel_language, ''), 1, 2)) IN (SELECT value FROM json_each(?))
          )
      )
      SELECT filtered.*, COUNT(*) OVER () AS total_filtered
      FROM filtered
      ORDER BY ${orderColumn} ${orderDirection}, COALESCE(creator_score, -1) DESC, COALESCE(pre_score, -1) DESC, COALESCE(raw_search_rank, 999999) ASC
      LIMIT ? OFFSET ?`
    )
    .all(
      jobId,
      query.minFollowers,
      query.minFollowers,
      query.maxFollowers,
      query.maxFollowers,
      query.age,
      query.age,
      query.recentActivityDays,
      query.recentActivityDays,
      query.minEngagementRate,
      query.minEngagementRate,
      query.minAvgViews,
      query.minAvgViews,
      query.minUploadFrequency,
      query.minUploadFrequency,
      countryFilterJson,
      countryFilterJson,
      countryFilterJson,
      languageFilterJson,
      languageFilterJson,
      languageFilterJson,
      query.pageSize,
      offset
    ) as unknown as ChannelListRow[];

  return {
    items: rows.map(toChannelListItem),
    total: rows[0]?.total_filtered ?? 0,
    page: query.page,
    pageSize: query.pageSize
  };
}

function getJobSummary(db: SqliteDatabase, jobId: string): {
  channel_count: number;
  shortlisted_count: number;
  average_creator_score: number | null;
  average_pre_score: number | null;
} {
  const row = db
    .prepare(
      `WITH ranked AS (
        SELECT
          channel_id,
          status,
          creator_score,
          pre_score,
          ROW_NUMBER() OVER (
            PARTITION BY channel_id
            ORDER BY
              CASE WHEN status = 'shortlisted' THEN 0 ELSE 1 END,
              COALESCE(creator_score, -1) DESC,
              COALESCE(pre_score, -1) DESC,
              COALESCE(raw_search_rank, 999999) ASC
          ) AS row_rank
        FROM results
        WHERE job_id = ? AND COALESCE(channel_id, '') <> ''
      )
      SELECT
        COUNT(*) AS channel_count,
        SUM(CASE WHEN status = 'shortlisted' THEN 1 ELSE 0 END) AS shortlisted_count,
        AVG(creator_score) AS average_creator_score,
        AVG(pre_score) AS average_pre_score
      FROM ranked
      WHERE row_rank = 1`
    )
    .get(jobId) as
    | {
        channel_count: number;
        shortlisted_count: number | null;
        average_creator_score: number | null;
        average_pre_score: number | null;
      }
    | undefined;

  return {
    channel_count: row?.channel_count ?? 0,
    shortlisted_count: row?.shortlisted_count ?? 0,
    average_creator_score: row?.average_creator_score ?? null,
    average_pre_score: row?.average_pre_score ?? null
  };
}

function runInTransaction<T>(db: SqliteDatabase, fn: () => T): T {
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function buildRecentAverageViewsByChannel(rows: CreatorResult[], maxVideos = 20): Map<string, number> {
  const grouped = new Map<string, CreatorResult[]>();

  for (const row of rows) {
    if (!row.channel_id) continue;
    const current = grouped.get(row.channel_id) ?? [];
    current.push(row);
    grouped.set(row.channel_id, current);
  }

  const averages = new Map<string, number>();
  for (const [channelId, channelRows] of grouped) {
    const recentRows = channelRows
      .filter((row) => row.views >= 0)
      .sort((left, right) => {
        const rightTime = right.published_at ? new Date(right.published_at).getTime() : 0;
        const leftTime = left.published_at ? new Date(left.published_at).getTime() : 0;
        return rightTime - leftTime;
      })
      .slice(0, maxVideos);
    const totalViews = recentRows.reduce((sum, row) => sum + row.views, 0);
    averages.set(channelId, recentRows.length ? totalViews / recentRows.length : 0);
  }

  return averages;
}

function updateJobStage(db: SqliteDatabase, jobId: string, stage: JobRecord["stage"], errorMessage: string | null = null): void {
  db.prepare("UPDATE jobs SET stage = ?, error_message = ?, updated_at = ? WHERE id = ?").run(
    stage,
    errorMessage,
    nowIso(),
    jobId
  );
}

function insertJob(db: SqliteDatabase, job: JobRecord): void {
  db.prepare(
    `INSERT INTO jobs (
      id, keyword, lookback_days, subscriber_min, subscriber_max, max_candidates, shortlist_size,
      minimum_pre_score, content_type, region, language, status, stage, config_json, error_message, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    job.id,
    job.keyword,
    job.lookback_days,
    job.subscriber_min,
    job.subscriber_max,
    job.max_candidates,
    job.shortlist_size,
    job.minimum_pre_score,
    job.content_type,
    job.region,
    job.language,
    job.status,
    job.stage,
    job.config_json,
    job.error_message,
    job.created_at,
    job.updated_at
  );
}

function upsertSearchCandidate(db: SqliteDatabase, job: JobRecord, candidate: YouTubeSearchCandidate): void {
  const timestamp = nowIso();
  db.prepare(
    `INSERT INTO results (
      id, job_id, keyword, video_id, video_url, title, published_at, raw_search_rank, search_page,
      search_source, channel_id, channel_title, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'candidate', ?, ?)
    ON CONFLICT(job_id, video_id) DO UPDATE SET
      title = excluded.title,
      published_at = excluded.published_at,
      raw_search_rank = excluded.raw_search_rank,
      search_page = excluded.search_page,
      search_source = excluded.search_source,
      channel_id = excluded.channel_id,
      channel_title = excluded.channel_title,
      updated_at = excluded.updated_at`
  ).run(
    randomUUID(),
    job.id,
    job.keyword,
    candidate.video_id,
    candidate.video_url,
    candidate.title,
    candidate.published_at,
    candidate.raw_search_rank,
    candidate.search_page,
    candidate.search_source,
    candidate.channel_id,
    candidate.channel_title,
    timestamp,
    timestamp
  );
}

function applyVideoMetric(db: SqliteDatabase, jobId: string, metric: YouTubeVideoMetric): void {
  db.prepare(
    `UPDATE results SET
      title = COALESCE(NULLIF(?, ''), title),
      published_at = COALESCE(NULLIF(?, ''), published_at),
      views = ?,
      likes = ?,
      comments = ?,
      channel_id = COALESCE(NULLIF(?, ''), channel_id),
      channel_title = COALESCE(NULLIF(?, ''), channel_title),
      status = 'enriched',
      updated_at = ?
    WHERE job_id = ? AND video_id = ?`
  ).run(
    metric.title,
    metric.published_at,
    metric.views,
    metric.likes,
    metric.comments,
    metric.channel_id,
    metric.channel_title,
    nowIso(),
    jobId,
    metric.video_id
  );
}

function applyChannelMetric(db: SqliteDatabase, jobId: string, metric: YouTubeChannelMetric): void {
  const quickLanguage = detectLanguage([metric.channel_title, metric.channel_description]);
  const quickEmail = extractEmails(metric.channel_description)[0] || null;
  db.prepare(
    `UPDATE results SET
      subscribers = ?,
      channel_title = COALESCE(NULLIF(?, ''), channel_title),
      channel_description = COALESCE(NULLIF(?, ''), channel_description),
      channel_video_count = ?,
      channel_avatar_url = COALESCE(NULLIF(?, ''), channel_avatar_url),
      channel_country = COALESCE(NULLIF(?, ''), channel_country),
      channel_language = COALESCE(NULLIF(channel_language, ''), ?),
      public_email = COALESCE(public_email, ?),
      updated_at = ?
    WHERE job_id = ? AND channel_id = ?`
  ).run(
    metric.subscribers,
    metric.channel_title,
    metric.channel_description,
    metric.video_count,
    metric.channel_avatar_url,
    metric.channel_country,
    quickLanguage,
    quickEmail,
    nowIso(),
    jobId,
    metric.channel_id
  );
}

async function runSearch(db: SqliteDatabase, job: JobRecord): Promise<{ candidate_count: number }> {
  if (!env.YOUTUBE_API_KEY) throw new Error("Missing YOUTUBE_API_KEY");
  const searchResult = await searchCandidates({
    apiKey: env.YOUTUBE_API_KEY,
    keyword: job.keyword,
    lookbackDays: job.lookback_days,
    maxCandidates: job.max_candidates,
    contentType: job.content_type,
    region: isRegionValue(job.region) ? "" : job.region,
    language: job.language
  });
  runInTransaction(db, () => {
    for (const candidate of searchResult.candidates) upsertSearchCandidate(db, job, candidate);
    if (searchResult.pages_fetched > 0) {
      recordQuotaUsage(db, {
        jobId: job.id,
        actionType: "search.list",
        units: searchResult.pages_fetched * 100,
        detail: {
          keyword: job.keyword,
          pages_fetched: searchResult.pages_fetched,
          candidate_count: searchResult.candidates.length
        }
      });
    }
    updateJobStage(db, job.id, "search");
  });
  return { candidate_count: searchResult.candidates.length };
}

async function runEnrichment(db: SqliteDatabase, job: JobRecord): Promise<{
  video_metric_count: number;
  channel_metric_count: number;
}> {
  if (!env.YOUTUBE_API_KEY) throw new Error("Missing YOUTUBE_API_KEY");
  const beforeRows = listResultsForJob(db, job.id);
  const videoIds = beforeRows.map((row) => row.video_id);
  const videoResult = await enrichVideoMetrics(env.YOUTUBE_API_KEY, videoIds);
  const videoMetrics = videoResult.metrics;
  const videoChannelIds = videoMetrics.map((metric) => metric.channel_id);
  const fallbackChannelIds = beforeRows.map((row) => row.channel_id || "");
  const channelIds = [...new Set([...videoChannelIds, ...fallbackChannelIds].filter(Boolean))];
  const channelResult = await enrichChannelMetrics(env.YOUTUBE_API_KEY, channelIds);
  const channelMetrics = channelResult.metrics;

  runInTransaction(db, () => {
    for (const metric of videoMetrics) applyVideoMetric(db, job.id, metric);
    for (const metric of channelMetrics) applyChannelMetric(db, job.id, metric);
    if (videoResult.requests_made > 0) {
      recordQuotaUsage(db, {
        jobId: job.id,
        actionType: "videos.list",
        units: videoResult.requests_made,
        detail: {
          requests_made: videoResult.requests_made,
          video_metric_count: videoMetrics.length
        }
      });
    }
    if (channelResult.requests_made > 0) {
      recordQuotaUsage(db, {
        jobId: job.id,
        actionType: "channels.list",
        units: channelResult.requests_made,
        detail: {
          requests_made: channelResult.requests_made,
          channel_metric_count: channelMetrics.length
        }
      });
    }
    updateJobStage(db, job.id, "enrichment");
  });

  return {
    video_metric_count: videoMetrics.length,
    channel_metric_count: channelMetrics.length
  };
}

async function runChannelIntelligence(db: SqliteDatabase, job: JobRecord): Promise<{
  channel_count: number;
  similar_request_count: number;
}> {
  try {
    return await enrichChannelIntelligence(db, job.id, {
      apiKey: env.YOUTUBE_API_KEY,
      keyword: job.keyword
    });
  } catch {
    return { channel_count: 0, similar_request_count: 0 };
  }
}

function runPreScore(db: SqliteDatabase, job: JobRecord): { scored_count: number; skipped_count: number } {
  const rows = listResultsForJob(db, job.id);
  const averageViewsByChannel = buildRecentAverageViewsByChannel(rows);
  let scoredCount = 0;
  let skippedCount = 0;

  runInTransaction(db, () => {
    for (const row of rows) {
      if (!row.published_at) {
        skippedCount += 1;
        continue;
      }

      const score = computePreScore({
        views: row.views,
        likes: row.likes,
        comments: row.comments,
        subscribers: row.subscribers,
        published_at: row.published_at
      });
      const avgViews = row.channel_id ? averageViewsByChannel.get(row.channel_id) ?? row.views : row.views;
      const creatorScore = computeCreatorScore({
        avg_views: avgViews,
        engagement_rate: score.engagement_rate,
        subscribers: row.subscribers
      });

      db.prepare(
        `UPDATE results SET
          days_since_publish = ?,
          engagement_rate = ?,
          comment_rate = ?,
          view_sub_ratio = ?,
          relative_velocity = ?,
          sub_fit_score = ?,
          view_sub_score = ?,
          engagement_score = ?,
          comment_score = ?,
          relative_velocity_score = ?,
          pre_score = ?,
          pre_score_breakdown_json = ?,
          avg_views = ?,
          avg_views_score = ?,
          creator_engagement_score = ?,
          subscriber_score = ?,
          creator_score = ?,
          creator_score_breakdown_json = ?,
          opportunity_tier = ?,
          status = 'pre_scored',
          updated_at = ?
        WHERE id = ?`
      ).run(
        score.days_since_publish,
        score.engagement_rate,
        score.comment_rate,
        score.view_sub_ratio,
        score.relative_velocity,
        score.sub_fit_score,
        score.view_sub_score,
        score.engagement_score,
        score.comment_score,
        score.relative_velocity_score,
        score.pre_score,
        stringifyJson(score.pre_score_breakdown),
        avgViews,
        creatorScore.avg_views_score,
        creatorScore.creator_engagement_score,
        creatorScore.subscriber_score,
        creatorScore.creator_score,
        stringifyJson(creatorScore.creator_score_breakdown),
        score.opportunity_tier,
        nowIso(),
        row.id
      );
      scoredCount += 1;
    }
    updateJobStage(db, job.id, "pre_score");
  });

  return { scored_count: scoredCount, skipped_count: skippedCount };
}

function runShortlist(db: SqliteDatabase, job: JobRecord): { shortlisted_count: number; rejected_count: number } {
  const rows = db
    .prepare(
      `SELECT * FROM results
       WHERE job_id = ?
         AND pre_score IS NOT NULL
         AND subscribers >= ?
         AND (? = 0 OR subscribers <= ?)
         AND days_since_publish <= ?
         AND views >= 3000
         AND pre_score >= ?
       ORDER BY pre_score DESC, raw_search_rank ASC
       LIMIT ?`
    )
    .all(
        job.id,
        job.subscriber_min,
        job.subscriber_max,
        job.subscriber_max,
        job.lookback_days,
      job.minimum_pre_score,
      job.shortlist_size
    ) as unknown as CreatorResult[];

  const shortlistIds = new Set(rows.map((row) => row.id));
  const preScoredRows = db.prepare("SELECT id FROM results WHERE job_id = ? AND pre_score IS NOT NULL").all(job.id) as {
    id: string;
  }[];
  let rejectedCount = 0;

  runInTransaction(db, () => {
    for (const row of preScoredRows) {
      const status = shortlistIds.has(row.id) ? "shortlisted" : "rejected";
      if (status === "rejected") rejectedCount += 1;
      db.prepare("UPDATE results SET status = ?, updated_at = ? WHERE id = ?").run(status, nowIso(), row.id);
    }
    updateJobStage(db, job.id, "shortlist");
  });

  return { shortlisted_count: rows.length, rejected_count: rejectedCount };
}

function runExport(db: SqliteDatabase, job: JobRecord, format: "csv" | "xlsx"): ExportRecord {
  const results = db
    .prepare("SELECT * FROM results WHERE job_id = ? ORDER BY creator_score DESC, pre_score DESC, raw_search_rank ASC")
    .all(job.id) as unknown as CreatorResult[];
  const visibleChannelIds = new Set(listChannelIntelligence(db, job.id).map((channel) => channel.channel_id));
  const exportedResults: CreatorResult[] = [];
  const exportedChannelIds = new Set<string>();
  for (const result of results) {
    if (!result.channel_id || !visibleChannelIds.has(result.channel_id) || exportedChannelIds.has(result.channel_id)) continue;
    exportedChannelIds.add(result.channel_id);
    exportedResults.push(result);
  }
  const timestamp = nowIso();
  const exportId = randomUUID();

  try {
    const output = createExportFile(job.id, format, exportedResults);
    const record: ExportRecord = {
      id: exportId,
      job_id: job.id,
      format,
      file_path: output.filePath,
      row_count: output.rowCount,
      status: "completed",
      error_message: null,
      created_at: timestamp
    };
    db.prepare(
      `INSERT INTO exports (id, job_id, format, file_path, row_count, status, error_message, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      record.id,
      record.job_id,
      record.format,
      record.file_path,
      record.row_count,
      record.status,
      record.error_message,
      record.created_at
    );
    updateJobStage(db, job.id, "export");
    return record;
  } catch (error) {
    db.prepare(
      `INSERT INTO exports (id, job_id, format, file_path, row_count, status, error_message, created_at)
       VALUES (?, ?, ?, ?, 0, 'failed', ?, ?)`
    ).run(exportId, job.id, format, "", error instanceof Error ? error.message : "Unknown export error", timestamp);
    throw error;
  }
}

function selectTargetResults(
  db: SqliteDatabase,
  jobId: string,
  resultIds: string[] | undefined,
  defaultStatuses: CreatorResult["status"][]
): CreatorResult[] {
  if (resultIds?.length) {
    const placeholders = resultIds.map(() => "?").join(",");
    return db
      .prepare(`SELECT * FROM results WHERE job_id = ? AND id IN (${placeholders}) ORDER BY pre_score DESC, raw_search_rank ASC`)
      .all(jobId, ...resultIds) as unknown as CreatorResult[];
  }

  const placeholders = defaultStatuses.map(() => "?").join(",");
  return db
    .prepare(`SELECT * FROM results WHERE job_id = ? AND status IN (${placeholders}) ORDER BY pre_score DESC, raw_search_rank ASC`)
    .all(jobId, ...defaultStatuses) as unknown as CreatorResult[];
}

async function runAll(db: SqliteDatabase, job: JobRecord): Promise<Record<string, unknown>> {
  const search = await runSearch(db, job);
  const enrichment = await runEnrichment(db, job);
  const channelIntelligence = await runChannelIntelligence(db, job);
  const preScore = runPreScore(db, job);
  const shortlist = runShortlist(db, job);
  return { search, enrichment, channel_intelligence: channelIntelligence, pre_score: preScore, shortlist };
}

const unimplementedStageActions = new Set<string>([]);

export async function handleJobsRoute(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  db: SqliteDatabase
): Promise<RouteResult> {
  if (pathname === "/api/jobs") {
    if (req.method !== "POST") return methodNotAllowed(res);
    const body = await readJson(req);
    const config = createJobSchema.parse(body);
    const timestamp = nowIso();
    const job: JobRecord = {
      id: randomUUID(),
      ...config,
      status: "draft",
      stage: "created",
      config_json: stringifyJson(config),
      error_message: null,
      created_at: timestamp,
      updated_at: timestamp
    };
    insertJob(db, job);
    sendJson(res, 201, { ok: true, job });
    return { handled: true };
  }

  const match = pathname.match(/^\/api\/jobs\/([^/]+)(?:\/([^/]+))?$/);
  if (!match) return { handled: false };

  const [, jobId, action] = match;
  const job = getJob(db, jobId);
  if (!job) return notFound(res, "Job not found");

  if (!action) {
    if (req.method !== "GET") return methodNotAllowed(res);
    const summary = getJobSummary(db, jobId);
    sendJson(res, 200, {
      ok: true,
      job,
      results: [],
      channels: [],
      summary,
      exports: listExportsForJob(db, jobId)
    });
    return { handled: true };
  }

  if (action === "channels") {
    if (req.method !== "GET") return methodNotAllowed(res);
    const query = parseChannelListQuery(req);
    const page = listChannelsPage(db, jobId, query);
    sendJson(res, 200, {
      ok: true,
      job_id: jobId,
      filters: query,
      ...page
    });
    return { handled: true };
  }

  if (req.method !== "POST") return methodNotAllowed(res);

  try {
    if (action === "run-search") {
      const result = await runSearch(db, job);
      sendJson(res, 200, { ok: true, job_id: jobId, action, ...result });
      return { handled: true };
    }

    if (action === "run-enrichment") {
      const result = await runEnrichment(db, job);
      sendJson(res, 200, { ok: true, job_id: jobId, action, ...result });
      return { handled: true };
    }

    if (action === "run-channel-intelligence") {
      const result = await runChannelIntelligence(db, job);
      sendJson(res, 200, {
        ok: true,
        job_id: jobId,
        action,
        ...result,
        channels: listChannelIntelligence(db, jobId)
      });
      return { handled: true };
    }

    if (action === "run-pre-score") {
      const result = runPreScore(db, job);
      sendJson(res, 200, { ok: true, job_id: jobId, action, ...result });
      return { handled: true };
    }

    if (action === "run-shortlist") {
      const result = runShortlist(db, job);
      sendJson(res, 200, { ok: true, job_id: jobId, action, ...result });
      return { handled: true };
    }

    if (action === "run-export") {
      const body = await readJson(req);
      const { format } = runExportSchema.parse(body);
      const result = runExport(db, job, format);
      sendJson(res, 200, {
        ok: true,
        job_id: jobId,
        action,
        export: result,
        download_url: `/api/exports/${result.id}/download`
      });
      return { handled: true };
    }

    if (action === "run-all") {
      const result = await runAll(db, job);
      sendJson(res, 200, { ok: true, job_id: jobId, action, ...result });
      return { handled: true };
    }

    if (unimplementedStageActions.has(action)) {
      sendJson(res, 202, {
        ok: true,
        job_id: jobId,
        action,
        status: "accepted",
        message: "Stage route skeleton only; implementation is deferred to later phases."
      });
      return { handled: true };
    }
  } catch (error) {
    const errorPayload = structuredError(error);
    updateJobStage(db, jobId, "failed", String(errorPayload.message || "Unknown error"));
    sendJson(res, error instanceof YouTubeApiError ? 502 : 500, { ok: false, job_id: jobId, action, error: errorPayload });
    return { handled: true };
  }

  return { handled: false };
}
