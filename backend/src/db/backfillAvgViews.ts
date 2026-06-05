import { openDatabase } from "../lib/db.js";

export function backfillAvgViews(databasePath?: string): void {
  const db = openDatabase(databasePath);
  try {
    db.exec(`
      WITH channel_avg AS (
        SELECT job_id, channel_id, AVG(views) AS avg_views
        FROM results
        WHERE COALESCE(channel_id, '') <> ''
        GROUP BY job_id, channel_id
      )
      UPDATE results
      SET avg_views = (
        SELECT channel_avg.avg_views
        FROM channel_avg
        WHERE channel_avg.job_id = results.job_id
          AND channel_avg.channel_id = results.channel_id
      )
      WHERE COALESCE(channel_id, '') <> '';
    `);
  } finally {
    db.close();
  }
}

backfillAvgViews(process.env.DATABASE_PATH);
console.log("Average views backfilled");
