import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";

export const revalidate = 60;

const PPL_PATH =
  "/Users/hd/Developer/cortana/memory/fitness/programs/json/tonal-ppl-v1.json";
const CATALOG_PATH =
  "/Users/hd/Developer/cortana/memory/fitness/programs/json/tonal-public-movement-catalog.json";
const BLOCK_PATH =
  "/Users/hd/Developer/cortana/memory/fitness/plans/8-week-ppl-block-v1.md";

export async function GET() {
  try {
    const [pplRaw, catalogRaw, blockRaw] = await Promise.all([
      readFile(PPL_PATH, "utf-8"),
      readFile(CATALOG_PATH, "utf-8"),
      readFile(BLOCK_PATH, "utf-8"),
    ]);

    const ppl = JSON.parse(pplRaw);
    const catalog = JSON.parse(catalogRaw);

    const mappedInPpl =
      (ppl.days?.push?.movements?.length ?? 0) +
      (ppl.days?.pull?.movements?.length ?? 0) +
      (ppl.days?.legs?.movements?.length ?? 0);

    const generatedAt = new Date().toISOString();

    return NextResponse.json(
      {
        status: "ok",
        generatedAt,
        data: {
          ppl,
          coverage: {
            publicMovementCount: catalog.summary?.publicMovementCount ?? 0,
            metricReadyCount: catalog.summary?.metricReadyCount ?? 0,
            mappedInPpl,
            workoutsSeen: ppl.summary?.workoutsSeen ?? 0,
            lastRefreshed: ppl.generatedAt ?? generatedAt,
          },
          block: {
            raw: blockRaw,
            status: "planned" as const,
          },
        },
      },
      {
        headers: {
          "cache-control": "public, max-age=60, stale-while-revalidate=30",
        },
      },
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to load program data.";
    const detail = error instanceof Error ? error.stack : undefined;

    return NextResponse.json(
      {
        status: "error",
        generatedAt: new Date().toISOString(),
        error: { message, detail },
      },
      {
        status: 500,
        headers: { "cache-control": "no-store" },
      },
    );
  }
}
