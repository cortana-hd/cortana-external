import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

function findWorkspaceRoot(start = process.cwd()): string {
  let current = path.resolve(start);

  while (true) {
    if (fs.existsSync(path.join(current, ".git"))) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return path.resolve(start, "..", "..");
    }
    current = parent;
  }
}

function readExternalPort(): string {
  const root = findWorkspaceRoot();
  const envPath = path.join(root, ".env");

  if (!fs.existsSync(envPath)) {
    return "3033";
  }

  const content = fs.readFileSync(envPath, "utf8");
  const match = content.match(/^\s*PORT\s*=\s*(.+)\s*$/m);
  if (!match) return "3033";

  const value = match[1]?.trim() ?? "3033";
  return value.replace(/^['"]|['"]$/g, "") || "3033";
}

async function fetchActionUrl(action: string): Promise<string> {
  const port = readExternalPort();
  const baseUrl = `http://127.0.0.1:${port}`;

  if (action === "whoop-auth-url") {
    const response = await fetch(`${baseUrl}/auth/url`, { cache: "no-store" });
    const payload = (await response.json()) as { url?: string };
    if (!response.ok || !payload.url) {
      throw new Error("Whoop auth URL is unavailable");
    }
    return payload.url;
  }

  if (action === "schwab-auth-url") {
    const response = await fetch(`${baseUrl}/auth/schwab/url`, { cache: "no-store" });
    const payload = (await response.json()) as { data?: { url?: string }; reason?: string };
    const url = payload.data?.url;
    if (!response.ok || !url) {
      throw new Error(payload.reason || "Schwab auth URL is unavailable");
    }
    return url;
  }

  throw new Error(`Unknown action: ${action}`);
}

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ action: string }> },
) {
  try {
    const { action } = await params;
    const url = await fetchActionUrl(action);
    return NextResponse.json({ status: "ok", url });
  } catch (error) {
    return NextResponse.json(
      {
        status: "error",
        message: error instanceof Error ? error.message : "Action failed",
      },
      { status: 500 },
    );
  }
}
