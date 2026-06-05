import type { ChannelIntelligenceOutput, CreatorResult } from "../types";
import { normalizeCountry } from "../constants/countries";
import { normalizeLanguage } from "../constants/languages";

export interface NormalizedChannel extends ChannelIntelligenceOutput {
  country: string;
  language: string;
  representative: CreatorResult | null;
}

export function normalizeChannel(
  item: ChannelIntelligenceOutput,
  representative: CreatorResult | null = null
): NormalizedChannel {
  return {
    ...item,
    country: normalizeCountry(item.country),
    language: normalizeLanguage(item.language),
    email: item.email || null,
    representative
  };
}
