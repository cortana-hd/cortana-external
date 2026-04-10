import fs from "node:fs";
import path from "node:path";

import { getBacktesterRepoPath } from "@/lib/runtime-paths";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ marketSlug: string }> },
) {
  const { marketSlug } = await params;
  const response = await fetch(`${resolveExternalServiceBaseUrl()}/polymarket/pins/${encodeURIComponent(marketSlug)}`, {
    method: "DELETE",
    cache: "no-store",
  });
  const body = await response.text();
  return new Response(body, {
    status: response.status,
    headers: {
      "content-type": response.headers.get("content-type") ?? "application/json",
      "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    },
  });
}

function resolveExternalServiceBaseUrl(): string {
  const explicit = process.env.MISSION_CONTROL_EXTERNAL_SERVICE_URL?.trim();
  if (explicit) {
    return explicit.replace(/\/+$/u, "");
  }

  const repoRoot = path.resolve(getBacktesterRepoPath(), "..");
  const envPath = path.join(repoRoot, ".env");
  if (!fs.existsSync(envPath)) {
    return "http://127.0.0.1:3033";
  }

  const content = fs.readFileSync(envPath, "utf8");
  const match = content.match(/^\s*PORT\s*=\s*(.+)\s*$/m);
  const port = (match?.[1]?.trim() ?? "3033").replace(/^['"]|['"]$/gu, "") || "3033";
  return `http://127.0.0.1:${port}`;
}
