import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fsMocks = vi.hoisted(() => ({
  readdir: vi.fn(),
  stat: vi.fn(),
  readFile: vi.fn(),
}));

vi.mock("fs/promises", () => ({
  default: {
    readdir: fsMocks.readdir,
    stat: fsMocks.stat,
    readFile: fsMocks.readFile,
  },
}));

import { GET } from "@/app/api/docs/route";

const makeRequest = (query = "") => new Request(`http://localhost/api/docs${query}`);
const repoRoot = path.resolve(process.cwd(), "..", "..");
const externalDocsRoot = path.join(repoRoot, "docs");
const backtesterRoot = path.join(repoRoot, "backtester");
const backtesterDocsRoot = path.join(backtesterRoot, "docs");
const openClawDocsRoot = "/Users/hd/Developer/cortana/docs";

const fileEntry = (name: string) => ({
  name,
  isFile: () => true,
  isDirectory: () => false,
});

const dirEntry = (name: string) => ({
  name,
  isFile: () => false,
  isDirectory: () => true,
});

const createMissingError = (target: string) => {
  const error = new Error(`missing: ${target}`) as NodeJS.ErrnoException;
  error.code = "ENOENT";
  return error;
};

const mockDirectoryTree = (entriesByPath: Record<string, Array<ReturnType<typeof fileEntry> | ReturnType<typeof dirEntry>>>) => {
  fsMocks.readdir.mockImplementation(async (target: string) => {
    if (target in entriesByPath) {
      return entriesByPath[target];
    }

    throw createMissingError(target);
  });
};

describe("GET /api/docs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.DOCS_PATH;
    fsMocks.stat.mockRejectedValue(createMissingError("missing"));
  });

  it("returns recursively discovered markdown docs with unique relative-path ids", async () => {
    mockDirectoryTree({
      [externalDocsRoot]: [fileEntry("README.md"), fileEntry("notes.txt"), dirEntry("source")],
      [`${externalDocsRoot}/source`]: [dirEntry("architecture")],
      [`${externalDocsRoot}/source/architecture`]: [fileEntry("mission-control.md")],
      [openClawDocsRoot]: [fileEntry("AGENTS.md")],
    });

    const response = await GET(makeRequest());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      status: "ok",
      files: [
        {
          id: "External Docs:README.md",
          name: "README.md",
          path: path.join(externalDocsRoot, "README.md"),
          section: "External Docs",
        },
        {
          id: "External Docs:source/architecture/mission-control.md",
          name: "source/architecture/mission-control.md",
          path: path.join(externalDocsRoot, "source", "architecture", "mission-control.md"),
          section: "External Docs",
        },
        {
          id: "OpenClaw Docs:AGENTS.md",
          name: "AGENTS.md",
          path: "/Users/hd/Developer/cortana/docs/AGENTS.md",
          section: "OpenClaw Docs",
        },
      ],
    });
  });

  it("uses DOCS_PATH when explicitly provided", async () => {
    process.env.DOCS_PATH = "/tmp/mission-control-docs";
    mockDirectoryTree({
      ["/tmp/mission-control-docs"]: [fileEntry("README.md"), dirEntry("source")],
      ["/tmp/mission-control-docs/source"]: [dirEntry("architecture")],
      ["/tmp/mission-control-docs/source/architecture"]: [fileEntry("overview.md")],
    });

    const response = await GET(makeRequest());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      status: "ok",
      files: [
        {
          id: "OpenClaw Docs:README.md",
          name: "README.md",
          path: "/tmp/mission-control-docs/README.md",
          section: "OpenClaw Docs",
        },
        {
          id: "OpenClaw Docs:source/architecture/overview.md",
          name: "source/architecture/overview.md",
          path: "/tmp/mission-control-docs/source/architecture/overview.md",
          section: "OpenClaw Docs",
        },
      ],
    });
  });

  it("returns file content when file param is provided", async () => {
    mockDirectoryTree({
      [externalDocsRoot]: [fileEntry("README.md"), dirEntry("source")],
      [`${externalDocsRoot}/source`]: [dirEntry("architecture")],
      [`${externalDocsRoot}/source/architecture`]: [fileEntry("mission-control.md")],
    });
    fsMocks.stat.mockResolvedValueOnce({ isFile: () => true });
    fsMocks.readFile.mockResolvedValueOnce("# hello");

    const response = await GET(
      makeRequest("?file=External%20Docs%3Asource%2Farchitecture%2Fmission-control.md")
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      status: "ok",
      name: "source/architecture/mission-control.md",
      content: "# hello",
    });
  });

  it("returns 404 for unknown document ids", async () => {
    mockDirectoryTree({
      [externalDocsRoot]: [fileEntry("README.md")],
    });

    const response = await GET(makeRequest("?file=../../../etc/passwd"));
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload).toEqual({ status: "error", message: "File not found." });
  });

  it("returns 404 for non-existent files", async () => {
    const err = new Error("missing") as NodeJS.ErrnoException;
    err.code = "ENOENT";
    mockDirectoryTree({
      [externalDocsRoot]: [fileEntry("missing.md")],
    });
    fsMocks.stat.mockRejectedValueOnce(err);

    const response = await GET(makeRequest("?file=External%20Docs%3Amissing.md"));
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload).toEqual({ status: "error", message: "File not found." });
  });

  it("returns proper JSON shape for list and content payloads", async () => {
    mockDirectoryTree({
      [externalDocsRoot]: [fileEntry("a.md")],
    });
    let response = await GET(makeRequest());
    let payload = await response.json();

    expect(payload.status).toBe("ok");
    expect(Array.isArray(payload.files)).toBe(true);
    expect(payload.files[0]).toMatchObject({
      id: "External Docs:a.md",
      name: "a.md",
      section: "External Docs",
    });

    fsMocks.stat.mockResolvedValueOnce({ isFile: () => true });
    fsMocks.readFile.mockResolvedValueOnce("content");
    mockDirectoryTree({
      [externalDocsRoot]: [fileEntry("a.md")],
    });
    response = await GET(makeRequest("?file=External%20Docs%3Aa.md"));
    payload = await response.json();

    expect(payload).toMatchObject({
      status: "ok",
      name: "a.md",
      content: "content",
    });
  });

  it("keeps backtester root README and docs README distinct", async () => {
    mockDirectoryTree({
      [backtesterDocsRoot]: [fileEntry("README.md")],
    });
    fsMocks.stat.mockResolvedValueOnce({ isFile: () => true });

    const response = await GET(makeRequest());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.files).toEqual([
      {
        id: "Backtester Docs:docs/README.md",
        name: "docs/README.md",
        path: path.join(backtesterDocsRoot, "README.md"),
        section: "Backtester Docs",
      },
      {
        id: "Backtester Docs:README.md",
        name: "README.md",
        path: path.join(backtesterRoot, "README.md"),
        section: "Backtester Docs",
      },
    ]);
  });
});
