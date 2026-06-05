import type { IncomingMessage, ServerResponse } from "node:http";
import type { SqliteDatabase } from "../lib/db.js";
import type { CreatorResult } from "../types/result.js";
import { normalizeCountryCode } from "../services/channelIntelligence/countryMap.js";
import { detectLanguage } from "../services/channelIntelligence/languageDetector.js";
import { extractEmails } from "../services/channelIntelligence/emailExtractor.js";

interface SimilarRouteResult {
  handled: boolean;
}

interface SimilarCreator {
  id: string;
  channel_id: string;
  channel_name: string;
  channel_avatar_url: string | null;
  channel_url: string;
  country: string;
  language: string;
  email: string | null;
  subscriber_count: number;
  content_type: string;
  game_category: string;
  pre_score: number | null;
  similarity_score: number;
  similarity_reasons: string[];
}

interface CandidateRow extends CreatorResult {
  content_type: string;
}

const similarCache = new Map<string, { expiresAt: number; payload: SimilarCreator[] }>();
const CACHE_TTL_MS = 5 * 60_000;

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function parseLimit(req: IncomingMessage): number {
  const url = new URL(req.url || "/", "http://localhost");
  const value = Number(url.searchParams.get("limit"));
  if (!Number.isFinite(value) || value <= 0) return 6;
  return Math.min(20, Math.trunc(value));
}

function parseId(req: IncomingMessage): string {
  const url = new URL(req.url || "/", "http://localhost");
  return (url.searchParams.get("id") || "").trim();
}

function channelUrl(channelId: string | null): string {
  return channelId ? `https://www.youtube.com/channel/${channelId}` : "";
}

function normalizeLanguage(input: string | null | undefined, fallbackTexts: Array<string | null | undefined>): string {
  const value = String(input ?? "").trim();
  const detected = value && value.toLowerCase() !== "unknown" ? value : detectLanguage(fallbackTexts);
  const key = detected.toLowerCase();
  const prefix = key.split("-")[0] ?? key;
  const labels: Record<string, string> = {
    en: "English",
    zh: "Chinese",
    ja: "Japanese",
    ko: "Korean",
    es: "Spanish",
    fr: "French",
    de: "German",
    pl: "Polish",
    pt: "Portuguese",
    ru: "Russian"
  };
  return labels[key] ?? labels[prefix] ?? (detected && detected !== "unknown" ? detected : "Other");
}

function followerSimilarity(left: number, right: number): number {
  const maxValue = Math.max(left, right, 1);
  const diffRatio = Math.abs(left - right) / maxValue;
  return Math.max(0, 1 - diffRatio);
}

function scoreCandidate(target: CandidateRow, candidate: CandidateRow): SimilarCreator {
  const targetCountry = normalizeCountryCode(target.channel_normalized_country || target.channel_country) || "Other";
  const candidateCountry = normalizeCountryCode(candidate.channel_normalized_country || candidate.channel_country) || "Other";
  const targetLanguage = normalizeLanguage(target.channel_language, [target.channel_title, target.channel_description, target.title]);
  const candidateLanguage = normalizeLanguage(candidate.channel_language, [
    candidate.channel_title,
    candidate.channel_description,
    candidate.title
  ]);
  const targetContentType = target.content_type || "all";
  const candidateContentType = candidate.content_type || "all";
  const targetGame = target.keyword.trim().toLowerCase();
  const candidateGame = candidate.keyword.trim().toLowerCase();
  const followerScore = followerSimilarity(target.subscribers, candidate.subscribers);
  const reasons: string[] = [];
  let score = 0;

  if (targetCountry !== "Other" && targetCountry === candidateCountry) {
    score += 25;
    reasons.push("same_country");
  }
  if (targetLanguage !== "Other" && targetLanguage === candidateLanguage) {
    score += 20;
    reasons.push("same_language");
  }
  if (targetContentType === candidateContentType) {
    score += 10;
    reasons.push("same_content_type");
  }
  score += 25 * followerScore;
  if (followerScore >= 0.75) reasons.push("similar_followers");
  if (targetGame && candidateGame && targetGame === candidateGame) {
    score += 20;
    reasons.push("same_game_category");
  }

  return {
    id: candidate.id,
    channel_id: candidate.channel_id || "",
    channel_name: candidate.channel_title || "",
    channel_avatar_url: candidate.channel_avatar_url || null,
    channel_url: channelUrl(candidate.channel_id),
    country: candidateCountry,
    language: candidateLanguage,
    email: candidate.public_email || extractEmails(candidate.channel_description)[0] || null,
    subscriber_count: candidate.subscribers,
    content_type: candidateContentType,
    game_category: candidate.keyword,
    pre_score: candidate.pre_score,
    similarity_score: Math.round(score * 10) / 10,
    similarity_reasons: reasons
  };
}

function getTarget(db: SqliteDatabase, id: string): CandidateRow | null {
  return (
    (db
      .prepare(
        `SELECT results.*, jobs.content_type
         FROM results
         JOIN jobs ON jobs.id = results.job_id
         WHERE results.id = ?`
      )
      .get(id) as CandidateRow | undefined) || null
  );
}

function getCandidates(db: SqliteDatabase, target: CandidateRow, limit: number): CandidateRow[] {
  const country = normalizeCountryCode(target.channel_normalized_country || target.channel_country);
  const language = target.channel_language || "";
  const minSubscribers = Math.max(0, Math.floor(target.subscribers * 0.5));
  const maxSubscribers = Math.max(minSubscribers + 1, Math.ceil(target.subscribers * 2));
  const scanLimit = Math.max(30, limit * 8);

  return db
    .prepare(
      `WITH ranked AS (
        SELECT
          results.*,
          jobs.content_type,
          ROW_NUMBER() OVER (
            PARTITION BY results.channel_id
            ORDER BY COALESCE(results.pre_score, -1) DESC, COALESCE(results.raw_search_rank, 999999) ASC
          ) AS row_rank
        FROM results
        JOIN jobs ON jobs.id = results.job_id
        WHERE COALESCE(results.channel_id, '') <> ''
          AND results.channel_id <> ?
          AND results.subscribers BETWEEN ? AND ?
          AND (
            results.keyword = ?
            OR results.channel_normalized_country = ?
            OR results.channel_language = ?
          )
      )
      SELECT *
      FROM ranked
      WHERE row_rank = 1
      ORDER BY COALESCE(pre_score, -1) DESC, COALESCE(raw_search_rank, 999999) ASC
      LIMIT ?`
    )
    .all(target.channel_id || "", minSubscribers, maxSubscribers, target.keyword, country, language, scanLimit) as unknown as CandidateRow[];
}

function listSimilarCreators(db: SqliteDatabase, id: string, limit: number): SimilarCreator[] {
  const cacheKey = `${id}:${limit}`;
  const cached = similarCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.payload;

  const target = getTarget(db, id);
  if (!target?.channel_id) return [];

  const seen = new Set<string>();
  const payload = getCandidates(db, target, limit)
    .filter((candidate) => candidate.channel_id && candidate.channel_id !== target.channel_id)
    .filter((candidate) => {
      if (!candidate.channel_id || seen.has(candidate.channel_id)) return false;
      seen.add(candidate.channel_id);
      return true;
    })
    .map((candidate) => scoreCandidate(target, candidate))
    .filter((candidate) => candidate.similarity_score > 0)
    .sort((left, right) => right.similarity_score - left.similarity_score || (right.pre_score ?? 0) - (left.pre_score ?? 0))
    .slice(0, limit);

  similarCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, payload });
  return payload;
}

export async function handleSimilarCreatorsRoute(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  db: SqliteDatabase
): Promise<SimilarRouteResult> {
  if (pathname !== "/similar-creators" && pathname !== "/api/similar-creators") return { handled: false };
  if (req.method !== "GET") {
    sendJson(res, 405, { ok: false, error: "Method not allowed" });
    return { handled: true };
  }

  const id = parseId(req);
  if (!id) {
    sendJson(res, 400, { ok: false, error: "Missing id" });
    return { handled: true };
  }

  sendJson(res, 200, {
    ok: true,
    id,
    items: listSimilarCreators(db, id, parseLimit(req))
  });
  return { handled: true };
}
