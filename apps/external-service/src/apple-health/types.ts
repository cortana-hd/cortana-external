import { z } from "zod";

export const AppleHealthFreshnessSchema = z.object({
  generated_at: z.string().datetime(),
  max_age_seconds: z.number().positive(),
  is_stale: z.boolean(),
});

export type AppleHealthFreshness = z.infer<typeof AppleHealthFreshnessSchema>;

export const AppleHealthExportSchema = z
  .object({
    schema_version: z.literal(1),
    generated_at: z.string().datetime(),
    freshness: AppleHealthFreshnessSchema.optional(),
  })
  .passthrough();

export type AppleHealthExport = z.infer<typeof AppleHealthExportSchema>;

export const AppleHealthImportResponseSchema = z.object({
  ok: z.literal(true),
  stored: z.literal(true),
  data_path: z.string(),
  generated_at: z.string().datetime(),
  max_age_seconds: z.number().positive(),
  is_stale: z.boolean(),
  days: z.number().int().nonnegative().nullable(),
  metrics: z.array(z.string()),
  received_at: z.string().datetime(),
});

export type AppleHealthImportResponse = z.infer<typeof AppleHealthImportResponseSchema>;

export const AppleHealthHealthSchema = z.object({
  status: z.enum(["healthy", "degraded", "unhealthy", "unconfigured"]),
  data_path: z.string(),
  generated_at: z.string().datetime().nullable(),
  age_seconds: z.number().nonnegative().nullable(),
  max_age_seconds: z.number().positive(),
  is_stale: z.boolean(),
  error: z.string().optional(),
  note: z.string().optional(),
});

export type AppleHealthHealthResponse = z.infer<typeof AppleHealthHealthSchema>;
