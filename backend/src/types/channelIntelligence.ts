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
