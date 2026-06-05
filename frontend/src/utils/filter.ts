import type { FilterState } from "../types";
import { countryLabelForValue } from "../constants/countries";
import { languageLabelForValue } from "../constants/languages";
import type { NormalizedChannel } from "./normalize";

export function filterChannels(data: NormalizedChannel[], filters: FilterState): NormalizedChannel[] {
  const subscriberMin = filters.subscriber_min === "" ? null : Number(filters.subscriber_min);
  const subscriberMax = filters.subscriber_max === "" ? null : Number(filters.subscriber_max);
  const country = filters.region === "" ? "All" : countryLabelForValue(filters.region);
  const language = filters.language === "" ? "All" : languageLabelForValue(filters.language);

  return data.filter((channel) => {
    return (
      (subscriberMin === null || channel.subscriber_count >= subscriberMin) &&
      (subscriberMax === null || channel.subscriber_count <= subscriberMax) &&
      (country === "All" || channel.country === country) &&
      (language === "All" || channel.language === language)
    );
  });
}
