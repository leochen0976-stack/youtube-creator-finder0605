export const REGION_COUNTRY_CODES: Record<string, string[]> = {
  north_america: ["US", "CA"],
  europe: ["GB", "DE", "FR", "ES", "IT", "PL"],
  east_asia: ["JP", "KR", "CN", "TW", "HK"],
  southeast_asia: ["SG", "ID", "TH", "VN", "PH"],
  south_asia: ["IN"],
  latin_america: ["BR", "MX"],
  cis: ["RU"],
  middle_east_arab: ["AE", "SA", "EG"],
  turkey: ["TR"],
  oceania: ["AU"],
  other: ["ZZ"]
};

export function getRegionCountryCodes(value: string | null | undefined): string[] {
  return REGION_COUNTRY_CODES[String(value ?? "").trim().toLowerCase()] ?? [];
}

export function isRegionValue(value: string | null | undefined): boolean {
  return getRegionCountryCodes(value).length > 0;
}
