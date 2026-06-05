export interface LanguageOption {
  value: string;
  label: string;
  aliases: string[];
}

const LANGUAGE_CODES = [
  "aa", "ab", "ae", "af", "ak", "am", "an", "ar", "as", "av", "ay", "az", "ba", "be", "bg", "bh",
  "bi", "bm", "bn", "bo", "br", "bs", "ca", "ce", "ch", "co", "cr", "cs", "cu", "cv", "cy", "da",
  "de", "dv", "dz", "ee", "el", "en", "eo", "es", "et", "eu", "fa", "ff", "fi", "fj", "fo", "fr",
  "fy", "ga", "gd", "gl", "gn", "gu", "gv", "ha", "he", "hi", "ho", "hr", "ht", "hu", "hy", "hz",
  "ia", "id", "ie", "ig", "ii", "ik", "io", "is", "it", "iu", "ja", "jv", "ka", "kg", "ki", "kj",
  "kk", "kl", "km", "kn", "ko", "kr", "ks", "ku", "kv", "kw", "ky", "la", "lb", "lg", "li", "ln",
  "lo", "lt", "lu", "lv", "mg", "mh", "mi", "mk", "ml", "mn", "mr", "ms", "mt", "my", "na", "nb",
  "nd", "ne", "ng", "nl", "nn", "no", "nr", "nv", "ny", "oc", "oj", "om", "or", "os", "pa", "pi",
  "pl", "ps", "pt", "qu", "rm", "rn", "ro", "ru", "rw", "sa", "sc", "sd", "se", "sg", "si", "sk",
  "sl", "sm", "sn", "so", "sq", "sr", "ss", "st", "su", "sv", "sw", "ta", "te", "tg", "th", "ti",
  "tk", "tl", "tn", "to", "tr", "ts", "tt", "tw", "ty", "ug", "uk", "ur", "uz", "ve", "vi", "vo",
  "wa", "wo", "xh", "yi", "yo", "za", "zh", "zu"
] as const;

const languageDisplay = new Intl.DisplayNames(["en"], { type: "language" });

const LANGUAGE_ALIASES: Record<string, string[]> = {
  en: ["en-US", "en-GB", "English", "英语"],
  zh: ["zh-CN", "zh-TW", "Chinese", "Mandarin", "中文", "汉语", "普通话"],
  ja: ["Japanese", "日本語", "日语"],
  ko: ["Korean", "한국어", "韩语"],
  es: ["Spanish", "Español", "西班牙语"],
  fr: ["French", "Français", "法语"],
  de: ["German", "Deutsch", "德语"],
  pt: ["pt-BR", "Portuguese", "Português", "葡萄牙语"],
  ru: ["Russian", "Русский", "俄语"],
  id: ["Indonesian", "Bahasa Indonesia", "印尼语"],
  ms: ["Malay", "Bahasa Melayu", "马来语"],
  tl: ["fil", "Tagalog", "Filipino", "菲律宾语"],
  he: ["iw", "Hebrew", "עברית", "希伯来语"]
};

export const ALL_LANGUAGES: LanguageOption[] = [
  { value: "", label: "全部语言", aliases: [] },
  ...LANGUAGE_CODES.map((code) => ({
    value: code,
    label: languageDisplay.of(code) ?? code,
    aliases: LANGUAGE_ALIASES[code] ?? []
  })),
  { value: "other", label: "Other", aliases: ["", "Unknown", "unknown", "其他", "无"] }
];

const languageAliasMap = new Map<string, string>();
for (const language of ALL_LANGUAGES) {
  if (language.value) languageAliasMap.set(language.value.toLowerCase(), language.label);
  languageAliasMap.set(language.label.toLowerCase(), language.label);
  for (const alias of language.aliases) {
    languageAliasMap.set(alias.toLowerCase(), language.label);
  }
}

export function normalizeLanguage(value: string | null | undefined): string {
  const key = String(value ?? "").trim();
  if (!key) return "Other";
  const languagePrefix = key.split("-")[0]?.toLowerCase() ?? key.toLowerCase();
  return languageAliasMap.get(key.toLowerCase()) ?? languageAliasMap.get(languagePrefix) ?? key;
}

export function languageLabelForValue(value: string): string {
  return ALL_LANGUAGES.find((language) => language.value === value)?.label ?? "Other";
}
