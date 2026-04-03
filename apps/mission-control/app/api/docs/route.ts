import fs from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { getDocsPath } from "@/lib/runtime-paths";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type DocEntry = { id: string; name: string; path: string; section: string };

type DocsListResponse =
  | { status: "ok"; files: DocEntry[] }
  | { status: "error"; message: string };

type DocContentResponse =
  | { status: "ok"; name: string; content: string }
  | { status: "error"; message: string };

const getBacktesterRoot = () => path.resolve(process.cwd(), "..", "..", "backtester");

const toDocId = (section: string, relativePath: string) => `${section}:${relativePath}`;

async function listDocs(docsRoot: string, section: string): Promise<DocEntry[]> {
  const entries = await fs.readdir(docsRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => ({
      id: toDocId(section, entry.name),
      name: entry.name,
      path: path.join(docsRoot, entry.name),
      section,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function listBacktesterDocs(backtesterRoot: string): Promise<DocEntry[]> {
  const docsRoot = path.join(backtesterRoot, "docs");
  let files: DocEntry[] = [];

  try {
    files = await listDocs(docsRoot, "Backtester Docs");
  } catch {
    return [];
  }

  const readmePath = path.join(backtesterRoot, "README.md");

  try {
    const stats = await fs.stat(readmePath);
    if (stats.isFile()) {
      files.unshift({
        id: toDocId("Backtester Docs", "README.md"),
        name: "README.md",
        path: readmePath,
        section: "Backtester Docs",
      });
    }
  } catch {
    // optional readme
  }

  return files;
}

async function listAllDocs(): Promise<DocEntry[]> {
  const results = await Promise.allSettled([
    listDocs(getDocsPath(), "OpenClaw Docs"),
    listBacktesterDocs(getBacktesterRoot()),
  ]);

  const files = results.flatMap((result) => (result.status === "fulfilled" ? result.value : []));

  return files.sort((a, b) => {
    const sectionOrder = a.section.localeCompare(b.section);
    if (sectionOrder !== 0) return sectionOrder;
    return a.name.localeCompare(b.name);
  });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const file = searchParams.get("file");

  if (!file) {
    try {
      const files = await listAllDocs();
      const payload: DocsListResponse = { status: "ok", files };
      return NextResponse.json(payload, {
        headers: {
          "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        },
      });
    } catch (error) {
      const payload: DocsListResponse = {
        status: "error",
        message: error instanceof Error ? error.message : "Failed to load docs.",
      };
      return NextResponse.json(payload, { status: 500 });
    }
  }

  try {
    const docs = await listAllDocs();
    const match = docs.find((entry) => entry.id === file);
    if (!match) {
      const payload: DocContentResponse = {
        status: "error",
        message: "File not found.",
      };
      return NextResponse.json(payload, { status: 404 });
    }

    const filePath = match.path;
    const stats = await fs.stat(filePath);
    if (!stats.isFile()) {
      const payload: DocContentResponse = {
        status: "error",
        message: "File not found.",
      };
      return NextResponse.json(payload, { status: 404 });
    }

    const content = await fs.readFile(filePath, "utf8");
    const payload: DocContentResponse = { status: "ok", name: match.name, content };
    return NextResponse.json(payload, {
      headers: {
        "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      },
    });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    const status = code === "ENOENT" ? 404 : 500;
    const payload: DocContentResponse = {
      status: "error",
      message: code === "ENOENT" ? "File not found." : "Failed to load doc.",
    };
    return NextResponse.json(payload, { status });
  }
}
