export interface RegionOption {
  value: string;
  label: string;
  countries: string[];
}

export const REGION_OPTIONS: RegionOption[] = [
  { value: "", label: "全部地区", countries: [] },
  { value: "north_america", label: "North America", countries: ["US", "CA"] },
  { value: "europe", label: "Europe", countries: ["GB", "DE", "FR", "ES", "IT", "PL"] },
  { value: "east_asia", label: "East Asia", countries: ["JP", "KR", "CN", "TW", "HK"] },
  { value: "southeast_asia", label: "Southeast Asia", countries: ["SG", "ID", "TH", "VN", "PH"] },
  { value: "south_asia", label: "South Asia", countries: ["IN"] },
  { value: "latin_america", label: "Latin America", countries: ["BR", "MX"] },
  { value: "cis", label: "CIS", countries: ["RU"] },
  { value: "middle_east_arab", label: "Middle East & Arab", countries: ["AE", "SA", "EG"] },
  { value: "turkey", label: "Turkey", countries: ["TR"] },
  { value: "oceania", label: "Oceania", countries: ["AU"] },
  { value: "other", label: "Other", countries: ["ZZ"] }
];

export const REGION_COUNTRY_CODES = new Set(REGION_OPTIONS.flatMap((region) => region.countries));

export function getRegionCountryCodes(regionValue: string): string[] {
  return REGION_OPTIONS.find((region) => region.value === regionValue)?.countries ?? [];
}

export function getRegionForCountry(countryValue: string): string {
  return REGION_OPTIONS.find((region) => region.countries.includes(countryValue))?.value ?? "";
}

export function isRegionValue(value: string): boolean {
  return REGION_OPTIONS.some((region) => region.value === value && region.value !== "");
}
