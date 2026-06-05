const STOP_WORDS: Record<string, string[]> = {
  en: ["the", "and", "with", "for", "from", "this", "that", "review", "how", "best"],
  es: ["que", "para", "con", "los", "las", "una", "como", "mejor"],
  fr: ["que", "pour", "avec", "les", "une", "des", "comment"],
  de: ["und", "der", "die", "das", "mit", "für", "von"],
  pt: ["que", "para", "com", "uma", "como", "melhor"],
  ru: ["для", "как", "что", "это", "обзор", "лучший"],
  ja: [],
  zh: [],
  ko: [],
  ar: [],
  hi: []
};

function countMatches(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}

export function detectLanguage(parts: Array<string | null | undefined>): string {
  try {
    const text = parts.map((part) => String(part ?? "")).join(" ").trim();
    if (text.length < 2) return "unknown";
    const lower = text.toLowerCase();
    const scriptScores: Record<string, number> = {
      zh: countMatches(text, /[\u4e00-\u9fff]/g),
      ja: countMatches(text, /[\u3040-\u30ff]/g),
      ko: countMatches(text, /[\uac00-\ud7af]/g),
      ru: countMatches(text, /[\u0400-\u04ff]/g),
      ar: countMatches(text, /[\u0600-\u06ff]/g),
      hi: countMatches(text, /[\u0900-\u097f]/g)
    };

    const strongestScript = Object.entries(scriptScores).sort((a, b) => b[1] - a[1])[0];
    if (strongestScript && strongestScript[1] >= 2) return strongestScript[0];

    const wordScores = Object.entries(STOP_WORDS).map(([lang, words]) => {
      const score = words.reduce((sum, word) => sum + countMatches(lower, new RegExp(`\\b${word}\\b`, "g")), 0);
      return [lang, score] as const;
    });
    const strongestWord = wordScores.sort((a, b) => b[1] - a[1])[0];
    if (strongestWord && strongestWord[1] >= 2) return strongestWord[0];

    const latinLetters = countMatches(lower, /[a-z]/g);
    if (latinLetters >= 12) return "en";
    return "unknown";
  } catch {
    return "unknown";
  }
}
