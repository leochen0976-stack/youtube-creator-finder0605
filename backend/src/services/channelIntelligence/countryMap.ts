const countryDisplay = new Intl.DisplayNames(["en"], { type: "region" });

const COUNTRY_ALIASES: Record<string, string> = {
  USA: "United States",
  "U.S.": "United States",
  "U.S.A.": "United States",
  "UNITED STATES OF AMERICA": "United States",
  美国: "United States",
  UK: "United Kingdom",
  "GREAT BRITAIN": "United Kingdom",
  BRITAIN: "United Kingdom",
  ENGLAND: "United Kingdom",
  英国: "United Kingdom",
  PRC: "China",
  中国: "China",
  中国大陆: "China",
  日本: "Japan",
  KOREA: "South Korea",
  "REPUBLIC OF KOREA": "South Korea",
  韩国: "South Korea",
  "RUSSIAN FEDERATION": "Russia",
  俄罗斯: "Russia",
  "VIET NAM": "Vietnam",
  越南: "Vietnam",
  UAE: "United Arab Emirates",
  阿联酋: "United Arab Emirates",
  "TÜRKIYE": "Turkey",
  土耳其: "Turkey"
};

export function normalizeCountryCode(input: string | null | undefined): string {
  try {
    const value = String(input ?? "").trim();
    if (!value) return "";
    const upper = value.toUpperCase();
    if (COUNTRY_ALIASES[upper]) return COUNTRY_ALIASES[upper];
    if (upper.length !== 2) return value;
    const label = countryDisplay.of(upper);
    return !label || label === "Unknown Region" ? value : label;
  } catch {
    return String(input ?? "").trim();
  }
}
