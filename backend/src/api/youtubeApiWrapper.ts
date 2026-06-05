import { getCachedValue, setCachedValue, stableCacheKey } from "./cacheLayer.js";
import { checkQuotaBudget, reserveQuota, type YouTubeApiAction } from "./quotaManager.js";
import { scheduleYouTubeApiRequest } from "./rateLimiter.js";

export interface YouTubeFetch {
  (input: string | URL, init?: RequestInit): Promise<Response>;
}

export interface YouTubeApiRequestInput<T> {
  action: YouTubeApiAction;
  path: string;
  params: Record<string, string | number | undefined>;
  apiKey: string;
  cacheNamespace: "search" | "channel" | "video" | "similar";
  cacheTtlMs: number;
  fallback: T;
  fetchImpl?: YouTubeFetch;
}

export interface YouTubeApiRequestResult<T> {
  data: T;
  ok: boolean;
  apiCalled: boolean;
  fromCache: boolean;
  quotaUnits: number;
  skippedReason: string | null;
}

function buildUrl(path: string, params: Record<string, string | number | undefined>, apiKey: string): URL {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  url.searchParams.set("key", apiKey);
  return url;
}

function cacheKeyFor(input: YouTubeApiRequestInput<unknown>): string {
  return stableCacheKey(input.cacheNamespace, {
    path: input.path,
    params: input.params
  });
}

async function parseJson<T>(response: Response, fallback: T): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    return fallback;
  }
}

export async function youtubeApiRequest<T>(input: YouTubeApiRequestInput<T>): Promise<YouTubeApiRequestResult<T>> {
  return scheduleYouTubeApiRequest(input.action, async () => {
    const key = cacheKeyFor(input);
    const quotaDecision = checkQuotaBudget(input.action);
    const cached = getCachedValue<T>(key);

    if (cached) {
      return {
        data: cached,
        ok: true,
        apiCalled: false,
        fromCache: true,
        quotaUnits: 0,
        skippedReason: null
      };
    }

    if (!quotaDecision.allowed) {
      console.warn(`[youtubeApiRequest] skipped ${input.action}: ${quotaDecision.reason}`);
      return {
        data: input.fallback,
        ok: false,
        apiCalled: false,
        fromCache: false,
        quotaUnits: 0,
        skippedReason: quotaDecision.reason
      };
    }

    try {
      const reserved = reserveQuota(input.action);
      if (!reserved.allowed) {
        console.warn(`[youtubeApiRequest] skipped ${input.action}: ${reserved.reason}`);
        return {
          data: input.fallback,
          ok: false,
          apiCalled: false,
          fromCache: false,
          quotaUnits: 0,
          skippedReason: reserved.reason
        };
      }

      const response = await (input.fetchImpl || fetch)(buildUrl(input.path, input.params, input.apiKey));
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        console.warn(`[youtubeApiRequest] ${input.action} failed: ${response.status} ${text.slice(0, 200)}`);
        return {
          data: input.fallback,
          ok: false,
          apiCalled: true,
          fromCache: false,
          quotaUnits: reserved.units,
          skippedReason: `http_${response.status}`
        };
      }

      const data = await parseJson(response, input.fallback);
      setCachedValue(key, data, input.cacheTtlMs);
      return {
        data,
        ok: true,
        apiCalled: true,
        fromCache: false,
        quotaUnits: reserved.units,
        skippedReason: null
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[youtubeApiRequest] ${input.action} failed: ${message}`);
      return {
        data: input.fallback,
        ok: false,
        apiCalled: false,
        fromCache: false,
        quotaUnits: 0,
        skippedReason: message
      };
    }
  });
}
