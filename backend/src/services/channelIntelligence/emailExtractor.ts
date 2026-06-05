import type { YouTubeFetch } from "../youtube/youtubeService.js";

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

function normalizeEmail(value: string): string {
  return value.trim().replace(/[),.;:]+$/, "").toLowerCase();
}

export function extractEmails(text: string | null | undefined): string[] {
  try {
    return [...new Set(String(text ?? "").match(EMAIL_PATTERN)?.map(normalizeEmail) ?? [])];
  } catch {
    return [];
  }
}

async function fetchText(url: string, fetchImpl: YouTubeFetch): Promise<string> {
  try {
    const response = await fetchImpl(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 YouTube Creator Finder"
      },
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) return "";
    return await response.text();
  } catch {
    return "";
  }
}

export async function extractPublicEmail(input: {
  channelUrl?: string | null;
  description?: string | null;
  websiteUrl?: string | null;
  fetchImpl?: YouTubeFetch;
}): Promise<string | null> {
  try {
    const direct = extractEmails(input.description)[0];
    if (direct) return direct;

    const fetchImpl = input.fetchImpl || fetch;
    const sources = [input.channelUrl ? `${String(input.channelUrl).replace(/\/$/, "")}/about` : "", input.websiteUrl || ""]
      .map((url) => url.trim())
      .filter(Boolean);

    for (const source of sources) {
      const html = await fetchText(source, fetchImpl);
      const email = extractEmails(html)[0];
      if (email) return email;
    }

    return null;
  } catch {
    return null;
  }
}
