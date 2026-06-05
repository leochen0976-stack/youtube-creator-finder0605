import type { FilterState } from "../types";
import { ALL_COUNTRIES } from "../constants/countries";
import { ALL_LANGUAGES } from "../constants/languages";
import { getRegionCountryCodes, getRegionForCountry, REGION_OPTIONS } from "../constants/regions";

const VISIBLE_COUNTRY_VALUES = [
  "",
  "US",
  "GB",
  "CA",
  "AU",
  "JP",
  "KR",
  "CN",
  "TW",
  "HK",
  "SG",
  "IN",
  "ID",
  "TH",
  "VN",
  "PH",
  "BR",
  "MX",
  "DE",
  "FR",
  "ES",
  "IT",
  "PL",
  "RU",
  "AE",
  "SA",
  "EG",
  "TR",
  "ZZ"
] as const;

const VISIBLE_LANGUAGE_VALUES = [
  "",
  "en",
  "zh",
  "ja",
  "ko",
  "es",
  "fr",
  "de",
  "pl",
  "pt",
  "ru",
  "id",
  "th",
  "vi",
  "tl",
  "hi",
  "ar",
  "other"
] as const;

const visibleCountryOptions = VISIBLE_COUNTRY_VALUES.map((value) => ALL_COUNTRIES.find((country) => country.value === value)).filter(
  (country): country is (typeof ALL_COUNTRIES)[number] => Boolean(country)
);

const visibleLanguageOptions = VISIBLE_LANGUAGE_VALUES.map((value) => ALL_LANGUAGES.find((language) => language.value === value)).filter(
  (language): language is (typeof ALL_LANGUAGES)[number] => Boolean(language)
);

export const contentTypeOptions = [
  { value: "all", label: "全部", query: "" },
  { value: "video", label: "视频", query: "video" },
  { value: "short", label: "短视频", query: "shorts" },
  { value: "live", label: "直播", query: "live stream" }
] as const;

export function buildDynamicQuery(filters: FilterState): string {
  return filters.keyword.trim() || "youtube creator";
}

interface FilterPanelProps {
  filters: FilterState;
  loading: boolean;
  onChange: (next: FilterState) => void;
  onSearch: () => void;
  showSearch?: boolean;
  showFilters?: boolean;
}

export function FilterPanel({ filters, loading, onChange, onSearch, showSearch = true, showFilters = true }: FilterPanelProps) {
  function setField<Key extends keyof FilterState>(key: Key, value: FilterState[Key]) {
    onChange({ ...filters, [key]: value });
  }

  const selectedRegion = getRegionCountryCodes(filters.region).length ? filters.region : getRegionForCountry(filters.region);
  const selectedCountry = getRegionCountryCodes(filters.region).length ? "" : filters.region;
  const selectedRegionCountries = getRegionCountryCodes(selectedRegion);
  const countryOptions = selectedRegion
    ? visibleCountryOptions.filter((country) => country.value === "" || selectedRegionCountries.includes(country.value))
    : visibleCountryOptions;

  function setRegion(value: string) {
    onChange({ ...filters, region: value });
  }

  function setCountry(value: string) {
    onChange({ ...filters, region: value || selectedRegion });
  }

  if (!showSearch && !showFilters) return null;

  return (
    <section className="filter-panel">
      {showSearch ? (
        <div className="filter-panel__search">
          <input
            value={filters.keyword}
            onChange={(event) => setField("keyword", event.target.value)}
            placeholder="搜索关键词（如：AI tools, productivity, tech review...）"
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onSearch();
              }
            }}
          />
          <button type="button" onClick={onSearch} disabled={loading}>
            {loading ? "搜索中..." : "搜索"}
          </button>
        </div>
      ) : null}

      {showFilters ? (
        <div className="filter-panel__grid">
          <label>
            <span>地区</span>
            <select value={selectedRegion} onChange={(event) => setRegion(event.target.value)}>
              {REGION_OPTIONS.map((option) => (
                <option key={option.value || "all"} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>国家</span>
            <select value={selectedCountry} onChange={(event) => setCountry(event.target.value)}>
              <option value="">全部国家</option>
              {countryOptions
                .filter((option) => option.value)
                .map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
            </select>
          </label>

          <label>
            <span>语言</span>
            <select value={filters.language} onChange={(event) => setField("language", event.target.value)}>
              {visibleLanguageOptions.map((option) => (
                <option key={option.value || "all"} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}
    </section>
  );
}
