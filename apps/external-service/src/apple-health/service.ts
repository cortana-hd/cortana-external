import path from "node:path";
import os from "node:os";

import { readJsonFile, resolveFromCwd, writeJsonFileAtomic } from "../lib/files.js";
import { createLogger, type AppLogger } from "../lib/logger.js";
import {
  AppleHealthExportSchema,
  type AppleHealthExport,
  type AppleHealthHealthResponse,
  type AppleHealthImportResponse,
  type AppleHealthFreshness,
} from "./types.js";

export interface AppleHealthServiceOptions {
  dataPath: string;
  maxAgeMs?: number;
  apiToken?: string;
  logger?: AppLogger;
  now?: () => Date;
}

interface LoadedAppleHealthExport {
  payload: AppleHealthExport;
  generatedAt: Date;
  ageSeconds: number;
  maxAgeSeconds: number;
  isStale: boolean;
  freshness?: AppleHealthFreshness;
}

function normalizeAppleHealthPath(filePath: string): string {
  const expanded = filePath.startsWith("~")
    ? path.join(os.homedir(), filePath.slice(1).replace(/^\/+/, ""))
    : filePath;
  return resolveFromCwd(expanded);
}

function toIsoString(date: Date): string {
  return date.toISOString();
}

export class AppleHealthService {
  private readonly dataPath: string;
  private readonly maxAgeMs: number;
  private readonly apiToken: string;
  private readonly logger: AppLogger;
  private readonly now: () => Date;

  constructor(options: AppleHealthServiceOptions) {
    this.dataPath = normalizeAppleHealthPath(options.dataPath);
    this.maxAgeMs = options.maxAgeMs ?? 36 * 60 * 60 * 1000;
    this.apiToken = options.apiToken?.trim() ?? "";
    this.logger = options.logger ?? createLogger("apple-health");
    this.now = options.now ?? (() => new Date());
  }

  validateToken(authorizationHeader: string | null | undefined): boolean {
    if (!this.apiToken) return true;
    const expected = `Bearer ${this.apiToken}`;
    return authorizationHeader?.trim() === expected;
  }

  async handleImport(raw: unknown): Promise<{ status: number; body: AppleHealthImportResponse }> {
    const parsed = AppleHealthExportSchema.parse(raw);
    const normalized = this.normalizeStoredExport(parsed);
    await writeJsonFileAtomic(this.dataPath, normalized);

    return {
      status: 200,
      body: {
        ok: true,
        stored: true,
        data_path: this.dataPath,
        generated_at: normalized.generated_at,
        max_age_seconds: normalized.freshness?.max_age_seconds ?? Math.trunc(this.maxAgeMs / 1000),
        is_stale: normalized.freshness?.is_stale ?? false,
        days: this.countDays(normalized),
        metrics: this.listMetrics(normalized),
        received_at: this.now().toISOString(),
      },
    };
  }

  async handleData(): Promise<{ status: number; body: unknown; warning?: string }> {
    try {
      const loaded = await this.loadLatestExport();
      const body = loaded.payload;
      if (loaded.isStale) {
        return {
          status: 200,
          body,
          warning: '110 - "Serving stale Apple Health export"',
        };
      }
      return { status: 200, body };
    } catch (error) {
      if (this.isMissingFileError(error) || this.isConfiguredMissingExportError(error)) {
        return {
          status: 200,
          body: {
            status: "unconfigured",
            data_path: this.dataPath,
            note: "apple health export not configured",
          },
        };
      }
      return this.toErrorResponse(error);
    }
  }

  async handleHealth(): Promise<{ status: number; body: AppleHealthHealthResponse }> {
    try {
      const loaded = await this.loadLatestExport();
      return {
        status: 200,
        body: {
          status: loaded.isStale ? "degraded" : "healthy",
          data_path: this.dataPath,
          generated_at: toIsoString(loaded.generatedAt),
          age_seconds: loaded.ageSeconds,
          max_age_seconds: loaded.maxAgeSeconds,
          is_stale: loaded.isStale,
        },
      };
    } catch (error) {
      if (this.isMissingFileError(error) || this.isConfiguredMissingExportError(error)) {
        return {
          status: 200,
          body: {
            status: "unconfigured",
            data_path: this.dataPath,
            generated_at: null,
            age_seconds: null,
            max_age_seconds: Math.trunc(this.maxAgeMs / 1000),
            is_stale: false,
            note: "apple health export not configured",
          },
        };
      }
      const message = error instanceof Error ? error.message : String(error);
      return {
        status: 503,
        body: {
          status: "unhealthy",
          data_path: this.dataPath,
          generated_at: null,
          age_seconds: null,
          max_age_seconds: Math.trunc(this.maxAgeMs / 1000),
          is_stale: true,
          error: message,
        },
      };
    }
  }

  private async loadLatestExport(): Promise<LoadedAppleHealthExport> {
    let raw: unknown;
    try {
      raw = await readJsonFile<unknown>(this.dataPath);
    } catch (error) {
      if (this.isMissingFileError(error)) {
        throw Object.assign(new Error(`apple health export not found at ${this.dataPath}`), { statusCode: 404 });
      }
      throw Object.assign(new Error(`failed to read apple health export at ${this.dataPath}`), { statusCode: 503 });
    }

    const parsed = AppleHealthExportSchema.safeParse(raw);
    if (!parsed.success) {
      throw Object.assign(new Error(`invalid apple health export schema at ${this.dataPath}`), { statusCode: 422 });
    }

    const generatedAt = new Date(parsed.data.generated_at);
    const now = this.now();
    const ageMs = Math.max(0, now.getTime() - generatedAt.getTime());
    const ageSeconds = Math.trunc(ageMs / 1000);
    const maxAgeSeconds = Math.trunc((parsed.data.freshness?.max_age_seconds ?? this.maxAgeMs / 1000));
    const freshnessWindowMs = maxAgeSeconds * 1000;
    const isStale = ageMs > freshnessWindowMs;
    if (parsed.data.freshness) {
      const freshness = parsed.data.freshness;
      if (freshness.generated_at !== parsed.data.generated_at || freshness.is_stale !== isStale) {
        throw Object.assign(new Error(`invalid apple health freshness metadata at ${this.dataPath}`), { statusCode: 422 });
      }
    }

    return {
      payload: parsed.data,
      generatedAt,
      ageSeconds,
      maxAgeSeconds,
      isStale,
      freshness: parsed.data.freshness,
    };
  }

  private isMissingFileError(error: unknown): boolean {
    return Boolean(
      error &&
        typeof error === "object" &&
        "code" in error &&
        (error as { code?: unknown }).code === "ENOENT",
    );
  }

  private isConfiguredMissingExportError(error: unknown): boolean {
    return error instanceof Error && /apple health export not found at /.test(error.message);
  }

  private normalizeStoredExport(payload: AppleHealthExport): AppleHealthExport {
    const maxAgeSeconds = payload.freshness?.max_age_seconds ?? Math.trunc(this.maxAgeMs / 1000);
    const generatedAtMs = Date.parse(payload.generated_at);
    const nowMs = this.now().getTime();
    const isStale = Number.isFinite(generatedAtMs) ? nowMs - generatedAtMs > maxAgeSeconds * 1000 : false;
    return {
      ...payload,
      freshness: {
        generated_at: payload.generated_at,
        max_age_seconds: maxAgeSeconds,
        is_stale: isStale,
      },
    };
  }

  private countDays(payload: AppleHealthExport): number | null {
    const root = payload as Record<string, unknown>;
    if (Array.isArray(root.days)) return root.days.length;
    if (Array.isArray(root.entries)) return root.entries.length;
    return null;
  }

  private listMetrics(payload: AppleHealthExport): string[] {
    const root = payload as Record<string, unknown>;
    const firstDay =
      Array.isArray(root.days) && root.days[0] && typeof root.days[0] === "object" && !Array.isArray(root.days[0])
        ? (root.days[0] as Record<string, unknown>)
        : null;
    if (!firstDay) return [];

    return Object.keys(firstDay)
      .filter((key) => key !== "date" && key !== "source" && key !== "source_name" && key !== "sourceName" && key !== "provenance")
      .sort();
  }

  private toErrorResponse(error: unknown): { status: number; body: Record<string, unknown> } {
    const status = typeof (error as { statusCode?: unknown }).statusCode === "number" ? (error as { statusCode: number }).statusCode : 500;
    const message = error instanceof Error ? error.message : String(error);
    this.logger.error("apple health export load failed", error);
    return {
      status,
      body: {
        error: message,
        data_path: this.dataPath,
      },
    };
  }
}
