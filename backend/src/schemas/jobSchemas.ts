import { z } from "zod";
import { jobStages, jobStatuses } from "../types/job.js";

export const jobStatusSchema = z.enum(jobStatuses);
export const jobStageSchema = z.enum(jobStages);

export const createJobSchema = z.object({
  keyword: z.string().trim().min(1),
  lookback_days: z.number().int().positive().default(30),
  subscriber_min: z.number().int().nonnegative().nullable().default(null).transform((value) => value ?? 0),
  subscriber_max: z.number().int().nonnegative().nullable().default(null).transform((value) => value ?? 0),
  max_candidates: z.number().int().positive().default(50),
  shortlist_size: z.number().int().positive().default(50),
  minimum_pre_score: z.number().min(0).max(100).nullable().default(null).transform((value) => value ?? 0),
  content_type: z.enum(["all", "video", "short", "live"]).default("all"),
  region: z.string().trim().max(32).default(""),
  language: z.string().trim().max(8).default("")
});

export const jobRecordSchema = createJobSchema.extend({
  id: z.string().min(1),
  status: jobStatusSchema,
  stage: jobStageSchema,
  config_json: z.string(),
  error_message: z.string().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime()
});

export type CreateJobInput = z.infer<typeof createJobSchema>;
export type JobRecordSchema = z.infer<typeof jobRecordSchema>;
