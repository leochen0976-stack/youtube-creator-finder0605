import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

interface CacheRecord<T = unknown> {
  value: T;
  expiresAt: number;
  createdAt: number;
}

const memoryCache = new Map<string, CacheRecord>();

function cacheFilePath(): string {
  return path.resolve(process.cwd(), "data", "youtube-api-cache.json");
}

function readDiskCache(): Record<string, CacheRecord> {
  if (process.env.NODE_ENV === "test") return {};
  try {
    const filePath = cacheFilePath();
    if (!fs.existsSync(filePath)) return {};
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, CacheRecord>;
  } catch {
    return {};
  }
}

function writeDiskCache(records: Record<string, CacheRecord>): void {
  if (process.env.NODE_ENV === "test") return;
  try {
    const filePath = cacheFilePath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(records), "utf8");
  } catch {
    // Cache writes are best-effort and must never interrupt the pipeline.
  }
}

export function stableCacheKey(namespace: string, parts: Record<string, unknown>): string {
  const raw = JSON.stringify(
    Object.keys(parts)
      .sort()
      .reduce<Record<string, unknown>>((out, key) => {
        out[key] = parts[key];
        return out;
      }, {})
  );
  return `${namespace}:${crypto.createHash("sha256").update(raw).digest("hex")}`;
}

export function getCachedValue<T>(key: string): T | null {
  try {
    const now = Date.now();
    const memory = memoryCache.get(key);
    if (memory && memory.expiresAt > now) return memory.value as T;

    const disk = readDiskCache();
    const record = disk[key];
    if (!record || record.expiresAt <= now) return null;
    memoryCache.set(key, record);
    return record.value as T;
  } catch {
    return null;
  }
}

export function setCachedValue<T>(key: string, value: T, ttlMs: number): void {
  try {
    const record: CacheRecord<T> = {
      value,
      expiresAt: Date.now() + ttlMs,
      createdAt: Date.now()
    };
    memoryCache.set(key, record);
    const disk = readDiskCache();
    disk[key] = record;
    writeDiskCache(disk);
  } catch {
    // Cache writes are best-effort and must never interrupt the pipeline.
  }
}

export function clearCacheForTests(): void {
  memoryCache.clear();
}
