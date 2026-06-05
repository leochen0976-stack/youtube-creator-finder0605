export type JobStage =
  | "created"
  | "search"
  | "enrichment"
  | "channel_intelligence"
  | "pre_score"
  | "shortlist"
  | "export"
  | "done"
  | "failed";

export type ResultStatus =
  | "candidate"
  | "enriched"
  | "pre_scored"
  | "shortlisted"
  | "exported"
  | "rejected"
  | "failed";

export type OpportunityTier = "A" | "B" | "C" | "D";
export type ContentTypeFilter = "all" | "video" | "short" | "live";

export interface JobRecord {
  id: string;
  keyword: string;
  lookback_days: number;
  subscriber_min: number;
  subscriber_max: number;
  max_candidates: number;
  shortlist_size: number;
  minimum_pre_score: number;
  content_type: ContentTypeFilter;
  region: string;
  language: string;
  status: string;
  stage: JobStage;
  config_json: string;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreatorResult {
  id: string;
  job_id: string;
  keyword: string;
  video_id: string;
  video_url: string;
  title: string | null;
  published_at: string | null;
  raw_search_rank: number | null;
  search_page: number | null;
  search_source: string | null;
  views: number;
  likes: number;
  comments: number;
  subscribers: number;
  channel_id: string | null;
  channel_title: string | null;
  channel_description: string | null;
  channel_language: string | null;
  channel_normalized_country: string | null;
  channel_video_count: number;
  similar_channels_json: string | null;
  channel_avatar_url: string | null;
  channel_country: string | null;
  days_since_publish: number | null;
  engagement_rate: number | null;
  comment_rate: number | null;
  view_sub_ratio: number | null;
  relative_velocity: number | null;
  sub_fit_score: number | null;
  view_sub_score: number | null;
  engagement_score: number | null;
  comment_score: number | null;
  relative_velocity_score: number | null;
  pre_score: number | null;
  pre_score_breakdown_json: string | null;
  avg_views: number | null;
  avg_views_score: number | null;
  creator_engagement_score: number | null;
  subscriber_score: number | null;
  creator_score: number | null;
  creator_score_breakdown_json: string | null;
  opportunity_tier: OpportunityTier | null;
  public_email: string | null;
  social_links_json: string | null;
  website_url: string | null;
  contact_status: string | null;
  contactability_score: number | null;
  raw_comet_output: string | null;
  comet_video_summary: string | null;
  comet_comments_summary: string | null;
  minimax_content_type: string | null;
  minimax_content_fit_score: number | null;
  minimax_audience_fit_score: number | null;
  minimax_brand_safety_score: number | null;
  minimax_commercial_intent_score: number | null;
  minimax_reason: string | null;
  minimax_status: string | null;
  minimax_error: string | null;
  final_score: number | null;
  outreach_priority: string | null;
  status: ResultStatus;
  created_at: string;
  updated_at: string;
}

export interface ExportRecord {
  id: string;
  job_id: string;
  format: "csv" | "xlsx";
  file_path: string;
  row_count: number;
  status: "pending" | "completed" | "failed";
  error_message: string | null;
  created_at: string;
}

export interface QuotaSummary {
  usage_date: string;
  daily_limit: number;
  used_units: number;
  remaining_units: number;
  percent_used: number;
}

export interface SimilarChannelOutput {
  channel_name: string;
  channel_id: string;
}

export interface ChannelIntelligenceOutput {
  channel_name: string;
  channel_id: string;
  channel_url: string;
  country: string;
  language: string;
  email: string | null;
  description: string;
  subscriber_count: number;
  video_count: number;
  similar_channels: SimilarChannelOutput[];
}

export interface ChannelListItem extends ChannelIntelligenceOutput {
  representative: CreatorResult | null;
}

export interface JobSummary {
  channel_count: number;
  shortlisted_count: number;
  average_creator_score: number | null;
  average_pre_score: number | null;
}

export interface JobDetailResponse {
  ok: boolean;
  job: JobRecord;
  results: CreatorResult[];
  channels: ChannelIntelligenceOutput[];
  summary?: JobSummary;
  exports: ExportRecord[];
}

export interface ChannelPageResponse {
  ok: boolean;
  job_id: string;
  items: ChannelListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface SimilarCreator {
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

export interface SimilarCreatorsResponse {
  ok: boolean;
  id: string;
  items: SimilarCreator[];
}

export interface ChannelQueryInput {
  contentType: ContentTypeFilter;
  region: string;
  regions: string[];
  minFollowers: number | null;
  maxFollowers: number | null;
  language: string;
  languages: string[];
  age: number | null;
  minEngagementRate: number | null;
  minAvgViews: number | null;
  recentActivityDays: number | null;
  minUploadFrequency: number | null;
  page: number;
  pageSize: number;
  sortKey: string;
  sortDirection: "asc" | "desc";
}

export interface CreateJobInput {
  keyword: string;
  lookback_days: number;
  subscriber_min: number | null;
  subscriber_max: number | null;
  max_candidates: number;
  shortlist_size: number;
  minimum_pre_score: number | null;
  content_type: ContentTypeFilter;
  region: string;
  language: string;
}

export interface FilterState {
  keyword: string;
  content_type: ContentTypeFilter;
  region: string;
  subscriber_min: string;
  subscriber_max: string;
  language: string;
  age: string;
  follower_min: string;
  engagement_min: string;
  avg_views_min: string;
  recent_activity: string;
  upload_frequency: string;
  selected_regions: string[];
  selected_languages: string[];
}
