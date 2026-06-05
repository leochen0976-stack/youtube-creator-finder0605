export interface CountryOption {
  value: string;
  label: string;
  aliases: string[];
}

const COUNTRY_CODES = [
  "AD", "AE", "AF", "AG", "AI", "AL", "AM", "AO", "AQ", "AR", "AS", "AT", "AU", "AW", "AX", "AZ",
  "BA", "BB", "BD", "BE", "BF", "BG", "BH", "BI", "BJ", "BL", "BM", "BN", "BO", "BQ", "BR", "BS",
  "BT", "BV", "BW", "BY", "BZ", "CA", "CC", "CD", "CF", "CG", "CH", "CI", "CK", "CL", "CM", "CN",
  "CO", "CR", "CU", "CV", "CW", "CX", "CY", "CZ", "DE", "DJ", "DK", "DM", "DO", "DZ", "EC", "EE",
  "EG", "EH", "ER", "ES", "ET", "FI", "FJ", "FK", "FM", "FO", "FR", "GA", "GB", "GD", "GE", "GF",
  "GG", "GH", "GI", "GL", "GM", "GN", "GP", "GQ", "GR", "GS", "GT", "GU", "GW", "GY", "HK", "HM",
  "HN", "HR", "HT", "HU", "ID", "IE", "IL", "IM", "IN", "IO", "IQ", "IR", "IS", "IT", "JE", "JM",
  "JO", "JP", "KE", "KG", "KH", "KI", "KM", "KN", "KP", "KR", "KW", "KY", "KZ", "LA", "LB", "LC",
  "LI", "LK", "LR", "LS", "LT", "LU", "LV", "LY", "MA", "MC", "MD", "ME", "MF", "MG", "MH", "MK",
  "ML", "MM", "MN", "MO", "MP", "MQ", "MR", "MS", "MT", "MU", "MV", "MW", "MX", "MY", "MZ", "NA",
  "NC", "NE", "NF", "NG", "NI", "NL", "NO", "NP", "NR", "NU", "NZ", "OM", "PA", "PE", "PF", "PG",
  "PH", "PK", "PL", "PM", "PN", "PR", "PS", "PT", "PW", "PY", "QA", "RE", "RO", "RS", "RU", "RW",
  "SA", "SB", "SC", "SD", "SE", "SG", "SH", "SI", "SJ", "SK", "SL", "SM", "SN", "SO", "SR", "SS",
  "ST", "SV", "SX", "SY", "SZ", "TC", "TD", "TF", "TG", "TH", "TJ", "TK", "TL", "TM", "TN", "TO",
  "TR", "TT", "TV", "TW", "TZ", "UA", "UG", "UM", "US", "UY", "UZ", "VA", "VC", "VE", "VG", "VI",
  "VN", "VU", "WF", "WS", "YE", "YT", "ZA", "ZM", "ZW"
] as const;

const countryDisplay = new Intl.DisplayNames(["en"], { type: "region" });

const COUNTRY_ALIASES: Record<string, string[]> = {
  US: ["USA", "U.S.", "U.S.A.", "United States of America", "美国"],
  GB: ["UK", "Great Britain", "Britain", "England", "英国"],
  CN: ["PRC", "中国", "中国大陆"],
  HK: ["Hong Kong SAR", "香港"],
  TW: ["台湾", "Taiwan, Province of China"],
  JP: ["日本"],
  KR: ["Korea", "Republic of Korea", "韩国"],
  RU: ["Russian Federation", "俄罗斯"],
  VN: ["Viet Nam", "越南"],
  AE: ["UAE", "阿联酋"],
  TR: ["Türkiye", "土耳其"]
};

export const ALL_COUNTRIES: CountryOption[] = [
  { value: "", label: "全部国家", aliases: [] },
  ...COUNTRY_CODES.map((code) => ({
    value: code,
    label: countryDisplay.of(code) ?? code,
    aliases: COUNTRY_ALIASES[code] ?? []
  })),
  { value: "ZZ", label: "Other", aliases: ["", "Unknown", "unknown", "其他", "无"] }
];

const countryAliasMap = new Map<string, string>();
for (const country of ALL_COUNTRIES) {
  if (country.value) countryAliasMap.set(country.value.toLowerCase(), country.label);
  countryAliasMap.set(country.label.toLowerCase(), country.label);
  for (const alias of country.aliases) {
    countryAliasMap.set(alias.toLowerCase(), country.label);
  }
}

export function normalizeCountry(value: string | null | undefined): string {
  const key = String(value ?? "").trim();
  if (!key) return "Other";
  return countryAliasMap.get(key.toLowerCase()) ?? key;
}

export function countryLabelForValue(value: string): string {
  return ALL_COUNTRIES.find((country) => country.value === value)?.label ?? "Other";
}
