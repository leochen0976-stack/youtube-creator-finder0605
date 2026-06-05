export function uniqueByChannelId<T extends { channel_id: string | null | undefined }>(items: T[]): T[] {
  try {
    const seen = new Set<string>();
    const out: T[] = [];
    for (const item of items) {
      const channelId = String(item.channel_id ?? "").trim();
      if (!channelId || seen.has(channelId)) continue;
      seen.add(channelId);
      out.push(item);
    }
    return out;
  } catch {
    return [];
  }
}
