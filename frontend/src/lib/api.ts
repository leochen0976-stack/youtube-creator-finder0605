import type {
  ChannelPageResponse,
  ChannelQueryInput,
  CreateJobInput,
  JobDetailResponse,
  JobRecord,
  QuotaSummary,
  SimilarCreatorsResponse
} from "../types";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3011";

function buildApiUrl(path: string): string {
  const base = String(API_BASE).replace(/\/$/, "");
  if (base.endsWith("/api") && path.startsWith("/api/")) {
    return `${base}${path.slice(4)}`;
  }
  return `${base}${path}`;
}

export function resolveApiUrl(path: string): string {
  return buildApiUrl(path);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(buildApiUrl(path), {
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    },
    ...init
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed with ${response.status}`);
  }

  return (await response.json()) as T;
}

export async function createJob(input: CreateJobInput): Promise<JobRecord> {
  const data = await request<{ ok: boolean; job: JobRecord }>("/api/jobs", {
    method: "POST",
    body: JSON.stringify(input)
  });
  return data.job;
}

export async function fetchJob(jobId: string): Promise<JobDetailResponse> {
  return request<JobDetailResponse>(`/api/jobs/${jobId}`);
}

const channelPageCache = new Map<string, Promise<ChannelPageResponse>>();
const similarCreatorsCache = new Map<string, Promise<SimilarCreatorsResponse>>();

function buildQueryString(input: ChannelQueryInput): string {
  const params = new URLSearchParams();
  params.set("contentType", input.contentType);
  params.set("page", String(input.page));
  params.set("pageSize", String(input.pageSize));
  params.set("sortKey", input.sortKey);
  params.set("sortDirection", input.sortDirection);
  if (input.region) params.set("region", input.region);
  if (input.regions.length) params.set("regions", input.regions.join(","));
  if (input.language) params.set("language", input.language);
  if (input.languages.length) params.set("languages", input.languages.join(","));
  if (input.minFollowers !== null) params.set("minFollowers", String(input.minFollowers));
  if (input.maxFollowers !== null) params.set("maxFollowers", String(input.maxFollowers));
  if (input.age !== null) params.set("age", String(input.age));
  if (input.minEngagementRate !== null) params.set("minEngagementRate", String(input.minEngagementRate));
  if (input.minAvgViews !== null) params.set("minAvgViews", String(input.minAvgViews));
  if (input.recentActivityDays !== null) params.set("recentActivityDays", String(input.recentActivityDays));
  if (input.minUploadFrequency !== null) params.set("minUploadFrequency", String(input.minUploadFrequency));
  return params.toString();
}

export function clearJobChannelCache(jobId?: string): void {
  if (!jobId) {
    channelPageCache.clear();
    return;
  }
  for (const key of channelPageCache.keys()) {
    if (key.startsWith(`${jobId}?`)) channelPageCache.delete(key);
  }
}

export async function fetchJobChannels(jobId: string, input: ChannelQueryInput): Promise<ChannelPageResponse> {
  const query = buildQueryString(input);
  const cacheKey = `${jobId}?${query}`;
  const cached = channelPageCache.get(cacheKey);
  if (cached) return cached;

  const pending = request<ChannelPageResponse>(`/api/jobs/${jobId}/channels?${query}`).catch((error) => {
    channelPageCache.delete(cacheKey);
    throw error;
  });
  channelPageCache.set(cacheKey, pending);
  return pending;
}

export async function fetchSimilarCreators(id: string, limit = 6): Promise<SimilarCreatorsResponse> {
  const cacheKey = `${id}:${limit}`;
  const cached = similarCreatorsCache.get(cacheKey);
  if (cached) return cached;

  const pending = request<SimilarCreatorsResponse>(`/api/similar-creators?id=${encodeURIComponent(id)}&limit=${limit}`).catch(
    (error) => {
      similarCreatorsCache.delete(cacheKey);
      throw error;
    }
  );
  similarCreatorsCache.set(cacheKey, pending);
  return pending;
}

export async function runStage(
  jobId: string,
  action:
    | "run-search"
    | "run-enrichment"
    | "run-channel-intelligence"
    | "run-pre-score"
    | "run-shortlist",
  body?: unknown
): Promise<unknown> {
  return request(`/api/jobs/${jobId}/${action}`, {
    method: "POST",
    body: body ? JSON.stringify(body) : "{}"
  });
}

export async function runExport(jobId: string, format: "csv" | "xlsx"): Promise<{ download_url: string }> {
  return request<{ ok: boolean; download_url: string }>(`/api/jobs/${jobId}/run-export`, {
    method: "POST",
    body: JSON.stringify({ format })
  });
}

export async function fetchQuotaSummary(): Promise<QuotaSummary> {
  const data = await request<{ ok: boolean; quota: QuotaSummary }>("/api/quota-summary");
  return data.quota;
}
