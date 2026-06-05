import { env } from "../config/env.js";

export type YouTubeApiAction = "search.list" | "videos.list" | "channels.list";

const QUOTA_UNITS: Record<YouTubeApiAction, number> = {
  "search.list": 100,
  "videos.list": 1,
  "channels.list": 1
};

interface QuotaState {
  usageDate: string;
  usedUnits: number;
}

function pacificDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
}

const state: QuotaState = {
  usageDate: pacificDate(),
  usedUnits: 0
};

function refreshDate(now = new Date()): void {
  const usageDate = pacificDate(now);
  if (state.usageDate !== usageDate) {
    state.usageDate = usageDate;
    state.usedUnits = 0;
  }
}

export interface QuotaDecision {
  allowed: boolean;
  action: YouTubeApiAction;
  units: number;
  usedUnits: number;
  remainingUnits: number;
  reason: string | null;
}

export function getQuotaUnits(action: YouTubeApiAction): number {
  return QUOTA_UNITS[action] ?? 1;
}

export function checkQuotaBudget(action: YouTubeApiAction, now = new Date()): QuotaDecision {
  refreshDate(now);
  const dailyLimit = env.YOUTUBE_DAILY_QUOTA_LIMIT;
  const units = getQuotaUnits(action);
  const remainingUnits = Math.max(0, dailyLimit - state.usedUnits);

  if (action === "search.list" && remainingUnits < 200) {
    return {
      allowed: false,
      action,
      units,
      usedUnits: state.usedUnits,
      remainingUnits,
      reason: "search.list disabled because remaining quota is below 200 units"
    };
  }

  if (remainingUnits < units) {
    return {
      allowed: false,
      action,
      units,
      usedUnits: state.usedUnits,
      remainingUnits,
      reason: "insufficient YouTube API quota"
    };
  }

  return {
    allowed: true,
    action,
    units,
    usedUnits: state.usedUnits,
    remainingUnits,
    reason: null
  };
}

export function reserveQuota(action: YouTubeApiAction, now = new Date()): QuotaDecision {
  const decision = checkQuotaBudget(action, now);
  if (!decision.allowed) return decision;
  state.usedUnits += decision.units;
  return {
    ...decision,
    usedUnits: state.usedUnits,
    remainingUnits: Math.max(0, env.YOUTUBE_DAILY_QUOTA_LIMIT - state.usedUnits)
  };
}

export function getRuntimeQuotaState(now = new Date()): QuotaState & { dailyLimit: number; remainingUnits: number } {
  refreshDate(now);
  return {
    ...state,
    dailyLimit: env.YOUTUBE_DAILY_QUOTA_LIMIT,
    remainingUnits: Math.max(0, env.YOUTUBE_DAILY_QUOTA_LIMIT - state.usedUnits)
  };
}

export function resetQuotaForTests(usedUnits = 0, now = new Date()): void {
  state.usageDate = pacificDate(now);
  state.usedUnits = Math.max(0, usedUnits);
}
