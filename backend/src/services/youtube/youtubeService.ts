import {
  youtubeApiRequest,
  type YouTubeFetch
} from "../../api/youtubeApiWrapper.js";

export type { YouTubeFetch };

export interface SearchCandidatesInput {
  apiKey: string;
  keyword: string;
  lookbackDays: number;
  maxCandidates?: number;
  maxPages?: number;
  now?: Date;
  contentType?: "all" | "video" | "short" | "live";
  region?: string;
  language?: string;
  fetchImpl?: YouTubeFetch;
}

export interface SearchCandidatesResult {
  candidates: YouTubeSearchCandidate[];
  pages_fetched: number;
}

export interface YouTubeSearchCandidate {
  video_id: string;
  video_url: string;
  title: string;
  published_at: string;
  raw_search_rank: number;
  search_page: number;
  search_source: "youtube_api_search";
  channel_id: string;
  channel_title: string;
}

export interface YouTubeVideoMetric {
  video_id: string;
  title: string;
  published_at: string;
  views: number;
  likes: number;
  comments: number;
  channel_id: string;
  channel_title: string;
}

export interface YouTubeChannelMetric {
  channel_id: string;
  channel_title: string;
  channel_description: string;
  subscribers: number;
  video_count: number;
  channel_avatar_url: string;
  channel_country: string;
}

export interface SimilarChannel {
  channel_id: string;
  channel_name: string;
}

export interface SimilarChannelsResult {
  channels: SimilarChannel[];
  requests_made: number;
}

export interface EnrichVideoMetricsResult {
  metrics: YouTubeVideoMetric[];
  requests_made: number;
}

export interface EnrichChannelMetricsResult {
  metrics: YouTubeChannelMetric[];
  requests_made: number;
}

export class YouTubeApiError extends Error {
  readonly statusCode: number;
  readonly apiStatus?: string;

  constructor(message: string, statusCode: number, apiStatus?: string) {
    super(message);
    this.name = "YouTubeApiError";
    this.statusCode = statusCode;
    this.apiStatus = apiStatus;
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function toInt(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function publishedAfterForLookback(lookbackDays: number, now = new Date()): string {
  const days = Math.max(1, Math.trunc(lookbackDays));
  const date = new Date(now.getTime() - days * 86_400_000);
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString();
}

function searchParamsForContentType(contentType: SearchCandidatesInput["contentType"]): {
  videoDuration?: string;
  eventType?: string;
} {
  if (contentType === "short") return { videoDuration: "short" };
  if (contentType === "video") return { videoDuration: "medium" };
  if (contentType === "live") return { eventType: "live" };
  return {};
}

const DAY_MS = 86_400_000;
const SIMILAR_TTL_MS = 7 * DAY_MS;

async function youtubeGet<T>(
  input: {
    action: "search.list" | "videos.list" | "channels.list";
    path: string;
    params: Record<string, string | number | undefined>;
    apiKey: string;
    fetchImpl?: YouTubeFetch;
    fallback: T;
    cacheNamespace: "search" | "channel" | "video" | "similar";
    cacheTtlMs?: number;
  }
): Promise<{ data: T; apiCalled: boolean; fromCache: boolean; ok: boolean; skippedReason: string | null }> {
  const result = await youtubeApiRequest<T>({
    action: input.action,
    path: input.path,
    params: input.params,
    apiKey: input.apiKey,
    fetchImpl: input.fetchImpl,
    fallback: input.fallback,
    cacheNamespace: input.cacheNamespace,
    cacheTtlMs: input.cacheTtlMs ?? DAY_MS
  });
  return {
    data: result.data,
    apiCalled: result.apiCalled,
    fromCache: result.fromCache,
    ok: result.ok,
    skippedReason: result.skippedReason
  };
}

export async function searchCandidates(input: SearchCandidatesInput): Promise<SearchCandidatesResult> {
  const fetchImpl = input.fetchImpl || fetch;
  const maxCandidates = Math.max(1, input.maxCandidates ?? 200);
  const maxPages = 1;
  const publishedAfter = publishedAfterForLookback(input.lookbackDays, input.now);
  const contentParams = searchParamsForContentType(input.contentType);
  const candidates: YouTubeSearchCandidate[] = [];
  const seen = new Set<string>();
  const seenChannels = new Set<string>();
  let nextPageToken = "";
  let rawRank = 0;
  let pagesFetched = 0;

  for (let page = 1; page <= maxPages && candidates.length < maxCandidates; page += 1) {
    const result = await youtubeGet<{
      nextPageToken?: string;
      items?: Array<{
        id?: { kind?: string; videoId?: string };
        snippet?: {
          title?: string;
          publishedAt?: string;
          channelId?: string;
          channelTitle?: string;
        };
      }>;
    }>({
      action: "search.list",
      path: "search",
      params: {
        part: "snippet",
        q: input.keyword,
        type: "video",
        order: "relevance",
        maxResults: Math.min(50, maxCandidates - candidates.length),
        publishedAfter,
        pageToken: nextPageToken,
        videoDuration: contentParams.videoDuration,
        eventType: contentParams.eventType,
        regionCode: input.region?.toUpperCase(),
        relevanceLanguage: input.language?.toLowerCase()
      },
      apiKey: input.apiKey,
      fetchImpl,
      fallback: { items: [] },
      cacheNamespace: "search",
      cacheTtlMs: DAY_MS
    });
    const data = result.data;
    if (result.apiCalled) pagesFetched += 1;
    if (!result.ok && !result.fromCache && result.skippedReason !== "search.list disabled because remaining quota is below 200 units") {
      throw new YouTubeApiError(`YouTube search failed: ${result.skippedReason || "unknown error"}`, 502, result.skippedReason || undefined);
    }

    for (const item of data.items || []) {
      const videoId = item.id?.videoId || "";
      const channelId = item.snippet?.channelId || "";
      if (!videoId || item.id?.kind !== "youtube#video" || seen.has(videoId)) continue;
      if (channelId && seenChannels.has(channelId)) continue;
      seen.add(videoId);
      if (channelId) seenChannels.add(channelId);
      rawRank += 1;
      const snippet = item.snippet || {};
      candidates.push({
        video_id: videoId,
        video_url: `https://www.youtube.com/watch?v=${videoId}`,
        title: snippet.title || "",
        published_at: snippet.publishedAt || "",
        raw_search_rank: rawRank,
        search_page: page,
        search_source: "youtube_api_search",
        channel_id: channelId,
        channel_title: snippet.channelTitle || ""
      });
      if (candidates.length >= maxCandidates) break;
    }

    nextPageToken = "";
    if (!nextPageToken) break;
  }

  return { candidates, pages_fetched: pagesFetched };
}

export async function enrichVideoMetrics(
  apiKey: string,
  videoIds: string[],
  fetchImpl: YouTubeFetch = fetch
): Promise<EnrichVideoMetricsResult> {
  const out: YouTubeVideoMetric[] = [];
  let requestsMade = 0;
  for (const ids of chunk(unique(videoIds), 50)) {
    if (!ids.length) continue;
    const result = await youtubeGet<{
      items?: Array<{
        id?: string;
        snippet?: {
          title?: string;
          publishedAt?: string;
          channelId?: string;
          channelTitle?: string;
        };
        statistics?: {
          viewCount?: string;
          likeCount?: string;
          commentCount?: string;
        };
      }>;
    }>({
      action: "videos.list",
      path: "videos",
      params: {
        part: "snippet,statistics",
        id: ids.join(","),
        maxResults: 50
      },
      apiKey,
      fetchImpl,
      fallback: { items: [] },
      cacheNamespace: "video",
      cacheTtlMs: DAY_MS
    });
    const data = result.data;
    if (result.apiCalled) requestsMade += 1;

    for (const item of data.items || []) {
      const videoId = item.id || "";
      if (!videoId) continue;
      const snippet = item.snippet || {};
      const stats = item.statistics || {};
      out.push({
        video_id: videoId,
        title: snippet.title || "",
        published_at: snippet.publishedAt || "",
        views: toInt(stats.viewCount),
        likes: toInt(stats.likeCount),
        comments: toInt(stats.commentCount),
        channel_id: snippet.channelId || "",
        channel_title: snippet.channelTitle || ""
      });
    }
  }
  return { metrics: out, requests_made: requestsMade };
}

export async function enrichChannelMetrics(
  apiKey: string,
  channelIds: string[],
  fetchImpl: YouTubeFetch = fetch
): Promise<EnrichChannelMetricsResult> {
  const out: YouTubeChannelMetric[] = [];
  let requestsMade = 0;
  for (const ids of chunk(unique(channelIds), 50)) {
    if (!ids.length) continue;
    const result = await youtubeGet<{
        items?: Array<{
          id?: string;
          snippet?: {
            title?: string;
            description?: string;
            country?: string;
            thumbnails?: {
              default?: { url?: string };
              medium?: { url?: string };
              high?: { url?: string };
            };
          };
          statistics?: { subscriberCount?: string; hiddenSubscriberCount?: boolean; videoCount?: string };
        }>;
    }>({
      action: "channels.list",
      path: "channels",
      params: {
        part: "snippet,statistics",
        id: ids.join(","),
        maxResults: 50
      },
      apiKey,
      fetchImpl,
      fallback: { items: [] },
      cacheNamespace: "channel",
      cacheTtlMs: DAY_MS
    });
    const data = result.data;
    if (result.apiCalled) requestsMade += 1;

    for (const item of data.items || []) {
      const channelId = item.id || "";
      if (!channelId) continue;
      const thumbnails = item.snippet?.thumbnails;
      out.push({
        channel_id: channelId,
        channel_title: item.snippet?.title || "",
        channel_description: item.snippet?.description || "",
        subscribers: item.statistics?.hiddenSubscriberCount ? 0 : toInt(item.statistics?.subscriberCount),
        video_count: toInt(item.statistics?.videoCount),
        channel_avatar_url: thumbnails?.high?.url || thumbnails?.medium?.url || thumbnails?.default?.url || "",
        channel_country: item.snippet?.country || ""
      });
    }
  }
  return { metrics: out, requests_made: requestsMade };
}

export async function searchSimilarChannels(input: {
  apiKey: string;
  channelId: string;
  channelTitle: string;
  keyword: string;
  maxResults?: number;
  fetchImpl?: YouTubeFetch;
}): Promise<SimilarChannelsResult> {
  try {
    const query = [input.channelTitle, input.keyword].map((value) => value.trim()).filter(Boolean).join(" ");
    if (!query) return { channels: [], requests_made: 0 };

    const result = await youtubeGet<{
      items?: Array<{
        id?: { kind?: string; channelId?: string };
        snippet?: { channelId?: string; channelTitle?: string; title?: string };
      }>;
    }>({
      action: "search.list",
      path: "search",
      params: {
        part: "snippet",
        q: query,
        type: "channel",
        order: "relevance",
        maxResults: Math.max(1, Math.min(10, input.maxResults ?? 10))
      },
      apiKey: input.apiKey,
      fetchImpl: input.fetchImpl || fetch,
      fallback: { items: [] },
      cacheNamespace: "similar",
      cacheTtlMs: SIMILAR_TTL_MS
    });
    const data = result.data;

    const seen = new Set<string>();
    const channels: SimilarChannel[] = [];
    for (const item of data.items || []) {
      const channelId = item.id?.channelId || item.snippet?.channelId || "";
      if (!channelId || channelId === input.channelId || seen.has(channelId)) continue;
      seen.add(channelId);
      channels.push({
        channel_id: channelId,
        channel_name: item.snippet?.channelTitle || item.snippet?.title || ""
      });
      if (channels.length >= 5) break;
    }

    return { channels, requests_made: result.apiCalled ? 1 : 0 };
  } catch {
    return { channels: [], requests_made: 0 };
  }
}
