import type {
  CreatorScoreBreakdown,
  FinalScoreBreakdown,
  OpportunityTier,
  OutreachPriority,
  PreScoreBreakdown,
  ScoringInput
} from "../../types/scoring.js";

const DAY_MS = 86_400_000;
const SCORE_CAP_AVG_VIEWS = 1_000_000;
const SCORE_CAP_SUBSCRIBERS = 1_000_000;
const SCORE_CAP_ENGAGEMENT_RATE = 0.05;

export interface PreScoreResult {
  days_since_publish: number;
  engagement_rate: number;
  comment_rate: number;
  view_sub_ratio: number;
  relative_velocity: number;
  sub_fit_score: number;
  view_sub_score: number;
  engagement_score: number;
  comment_score: number;
  relative_velocity_score: number;
  pre_score: number;
  pre_score_breakdown: PreScoreBreakdown;
  opportunity_tier: OpportunityTier;
}

export interface FinalScoreInput {
  pre_score: number;
  contactability_score: number;
  content_fit_score: number;
  audience_fit_score: number;
  brand_safety_score: number;
}

export interface FinalScoreResult {
  final_score: number;
  final_score_breakdown: FinalScoreBreakdown;
  outreach_priority: OutreachPriority;
}

export interface CreatorScoreInput {
  avg_views: number;
  engagement_rate: number;
  subscribers: number;
}

export interface CreatorScoreResult {
  avg_views_score: number;
  creator_engagement_score: number;
  subscriber_score: number;
  creator_score: number;
  creator_score_breakdown: CreatorScoreBreakdown;
}

export function clamp(x: number, min: number, max: number): number {
  return Math.max(min, Math.min(x, max));
}

export function computeLogScaledScore(value: number, cap: number): number {
  const safeValue = Math.max(0, value);
  const safeCap = Math.max(1, cap);
  return clamp((Math.log10(safeValue + 1) / Math.log10(safeCap + 1)) * 100, 0, 100);
}

export function computeDaysSincePublish(publishedAt: string, now: Date = new Date()): number {
  const published = new Date(publishedAt);
  const elapsedMs = now.getTime() - published.getTime();
  if (!Number.isFinite(elapsedMs)) return 1;
  return Math.max(1, Math.ceil(elapsedMs / DAY_MS));
}

export function computeEngagementRate(likes: number, comments: number, views: number): number {
  return (likes + comments * 2) / Math.max(views, 1);
}

export function computeCommentRate(comments: number, views: number): number {
  return comments / Math.max(views, 1);
}

export function computeViewSubRatio(views: number, subscribers: number): number {
  return views / Math.max(subscribers, 1);
}

export function computeRelativeVelocity(views: number, daysSincePublish: number, subscribers: number): number {
  return views / Math.max(daysSincePublish, 1) / Math.max(subscribers, 1);
}

export function computeSubscriberFitScore(subscribers: number): number {
  if (subscribers >= 3000 && subscribers < 8000) return 0.7;
  if (subscribers >= 8000 && subscribers <= 30000) return 1.0;
  if (subscribers > 30000 && subscribers <= 50000) return 0.8;
  if (subscribers > 50000 && subscribers <= 100000) return 0.5;
  return 0;
}

export function computeOpportunityTier(preScore: number): OpportunityTier {
  if (preScore >= 85) return "A";
  if (preScore >= 70) return "B";
  if (preScore >= 55) return "C";
  return "D";
}

export function computeAvgViewsScore(avgViews: number): number {
  return computeLogScaledScore(avgViews, SCORE_CAP_AVG_VIEWS);
}

export function computeCreatorEngagementScore(engagementRate: number): number {
  return clamp(engagementRate / SCORE_CAP_ENGAGEMENT_RATE, 0, 1) * 100;
}

export function computeSubscriberScore(subscribers: number): number {
  return computeLogScaledScore(subscribers, SCORE_CAP_SUBSCRIBERS);
}

export function computeCreatorScore(input: CreatorScoreInput): CreatorScoreResult {
  const avg_views_score = computeAvgViewsScore(input.avg_views);
  const creator_engagement_score = computeCreatorEngagementScore(input.engagement_rate);
  const subscriber_score = computeSubscriberScore(input.subscribers);
  const creator_score = 0.5 * avg_views_score + 0.3 * creator_engagement_score + 0.2 * subscriber_score;
  const creator_score_breakdown = {
    avg_views_score,
    creator_engagement_score,
    subscriber_score
  };

  return {
    avg_views_score,
    creator_engagement_score,
    subscriber_score,
    creator_score,
    creator_score_breakdown
  };
}

export function computePreScore(input: ScoringInput): PreScoreResult {
  const days_since_publish = computeDaysSincePublish(input.published_at, input.now);
  const engagement_rate = computeEngagementRate(input.likes, input.comments, input.views);
  const comment_rate = computeCommentRate(input.comments, input.views);
  const view_sub_ratio = computeViewSubRatio(input.views, input.subscribers);
  const relative_velocity = computeRelativeVelocity(input.views, days_since_publish, input.subscribers);
  const sub_fit_score = computeSubscriberFitScore(input.subscribers);
  const view_sub_score = clamp(view_sub_ratio / 0.4, 0, 1);
  const engagement_score = clamp(engagement_rate / 0.05, 0, 1);
  const comment_score = clamp(comment_rate / 0.005, 0, 1);
  const relative_velocity_score = clamp(relative_velocity / 0.02, 0, 1);

  const pre_score =
    30 * sub_fit_score +
    30 * view_sub_score +
    20 * engagement_score +
    10 * comment_score +
    10 * relative_velocity_score;

  const pre_score_breakdown = {
    sub_fit_score,
    view_sub_score,
    engagement_score,
    comment_score,
    relative_velocity_score
  };

  return {
    days_since_publish,
    engagement_rate,
    comment_rate,
    view_sub_ratio,
    relative_velocity,
    sub_fit_score,
    view_sub_score,
    engagement_score,
    comment_score,
    relative_velocity_score,
    pre_score,
    pre_score_breakdown,
    opportunity_tier: computeOpportunityTier(pre_score)
  };
}

export function computeContactabilityScore(input: {
  publicEmailFound: boolean;
  socialLinksFound: boolean;
  websiteOrContactPageFound: boolean;
}): number {
  if (input.publicEmailFound) return 100;
  if (input.socialLinksFound) return 70;
  if (input.websiteOrContactPageFound) return 50;
  return 0;
}

export function computeOutreachPriority(finalScore: number): OutreachPriority {
  if (finalScore >= 85) return "P1";
  if (finalScore >= 70) return "P2";
  if (finalScore >= 55) return "P3";
  return "P4";
}

export function computeFinalScore(input: FinalScoreInput): FinalScoreResult {
  const final_score_breakdown = {
    pre_score_norm: clamp(input.pre_score / 100, 0, 1),
    contactability_norm: clamp(input.contactability_score / 100, 0, 1),
    content_fit_norm: clamp(input.content_fit_score / 100, 0, 1),
    audience_fit_norm: clamp(input.audience_fit_score / 100, 0, 1),
    brand_safety_norm: clamp(input.brand_safety_score / 100, 0, 1)
  };

  const final_score =
    100 *
    (0.4 * final_score_breakdown.pre_score_norm +
      0.2 * final_score_breakdown.contactability_norm +
      0.2 * final_score_breakdown.content_fit_norm +
      0.1 * final_score_breakdown.audience_fit_norm +
      0.1 * final_score_breakdown.brand_safety_norm);

  return {
    final_score,
    final_score_breakdown,
    outreach_priority: computeOutreachPriority(final_score)
  };
}
