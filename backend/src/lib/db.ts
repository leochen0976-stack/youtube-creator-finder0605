import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { env } from "../config/env.js";

export type SqliteDatabase = DatabaseSync;

export function resolveProjectPath(inputPath: string): string {
  return path.isAbsolute(inputPath) ? inputPath : path.resolve(process.cwd(), inputPath);
}

export function openDatabase(databasePath = env.DATABASE_PATH): SqliteDatabase {
  if (databasePath === ":memory:") {
    const db = new DatabaseSync(databasePath);
    db.exec("PRAGMA foreign_keys = ON;");
    return db;
  }

  const resolved = resolveProjectPath(databasePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const db = new DatabaseSync(resolved);
  db.exec("PRAGMA foreign_keys = ON;");
  return db;
}

export function readSchemaSql(): string {
  return fs.readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");
}

export function initializeDatabase(db: SqliteDatabase): void {
  db.exec(readSchemaSql());
  try {
    db.exec("ALTER TABLE results ADD COLUMN channel_avatar_url TEXT;");
  } catch {
    // Ignore when the column already exists.
  }
  try {
    db.exec("ALTER TABLE results ADD COLUMN channel_country TEXT;");
  } catch {
    // Ignore when the column already exists.
  }
  try {
    db.exec("ALTER TABLE results ADD COLUMN channel_description TEXT;");
  } catch {
    // Ignore when the column already exists.
  }
  try {
    db.exec("ALTER TABLE results ADD COLUMN channel_language TEXT;");
  } catch {
    // Ignore when the column already exists.
  }
  try {
    db.exec("ALTER TABLE results ADD COLUMN channel_normalized_country TEXT;");
  } catch {
    // Ignore when the column already exists.
  }
  try {
    db.exec("ALTER TABLE results ADD COLUMN channel_video_count INTEGER NOT NULL DEFAULT 0;");
  } catch {
    // Ignore when the column already exists.
  }
  try {
    db.exec("ALTER TABLE results ADD COLUMN similar_channels_json TEXT;");
  } catch {
    // Ignore when the column already exists.
  }
  try {
    db.exec("ALTER TABLE results ADD COLUMN avg_views REAL;");
  } catch {
    // Ignore when the column already exists.
  }
  try {
    db.exec("ALTER TABLE results ADD COLUMN avg_views_score REAL;");
  } catch {
    // Ignore when the column already exists.
  }
  try {
    db.exec("ALTER TABLE results ADD COLUMN creator_engagement_score REAL;");
  } catch {
    // Ignore when the column already exists.
  }
  try {
    db.exec("ALTER TABLE results ADD COLUMN subscriber_score REAL;");
  } catch {
    // Ignore when the column already exists.
  }
  try {
    db.exec("ALTER TABLE results ADD COLUMN creator_score REAL;");
  } catch {
    // Ignore when the column already exists.
  }
  try {
    db.exec("ALTER TABLE results ADD COLUMN creator_score_breakdown_json TEXT;");
  } catch {
    // Ignore when the column already exists.
  }
  try {
    db.exec("ALTER TABLE jobs ADD COLUMN content_type TEXT NOT NULL DEFAULT 'all';");
  } catch {
    // Ignore when the column already exists.
  }
  try {
    db.exec("ALTER TABLE jobs ADD COLUMN region TEXT NOT NULL DEFAULT '';");
  } catch {
    // Ignore when the column already exists.
  }
  try {
    db.exec("ALTER TABLE jobs ADD COLUMN language TEXT NOT NULL DEFAULT '';");
  } catch {
    // Ignore when the column already exists.
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_results_channel_id ON results(channel_id);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_results_job_creator_score ON results(job_id, creator_score DESC);");
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_results_similarity_country_language_subs ON results(channel_normalized_country, channel_language, subscribers);"
  );
  db.exec("CREATE INDEX IF NOT EXISTS idx_results_keyword_subscribers ON results(keyword, subscribers);");
}
