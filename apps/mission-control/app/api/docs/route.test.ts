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

describe("GET /api/docs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.DOCS_PATH;
  });

  it("returns list of .md files when no file param is provided", async () => {
    fsMocks.readdir.mockResolvedValueOnce([
      { name: "README.md", isFile: () => true },
      { name: "notes.txt", isFile: () => true },
      { name: "subdir", isFile: () => false },
      { name: "AGENTS.md", isFile: () => true },
    ]);

    const response = await GET(makeRequest());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      status: "ok",
      files: [
        {
          id: "OpenClaw Docs:AGENTS.md",
          name: "AGENTS.md",
          path: "/Users/hd/Developer/cortana/docs/AGENTS.md",
          section: "OpenClaw Docs",
        },
        {
          id: "OpenClaw Docs:README.md",
          name: "README.md",
          path: "/Users/hd/Developer/cortana/docs/README.md",
          section: "OpenClaw Docs",
        },
      ],
    });
  });

  it("uses DOCS_PATH when explicitly provided", async () => {
    process.env.DOCS_PATH = "/tmp/mission-control-docs";
    fsMocks.readdir.mockResolvedValueOnce([{ name: "README.md", isFile: () => true }]);

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
      ],
    });
  });

  it("returns file content when file param is provided", async () => {
    fsMocks.stat.mockResolvedValueOnce({ isFile: () => true });
    fsMocks.readFile.mockResolvedValueOnce("# hello");

    fsMocks.readdir.mockResolvedValueOnce([{ name: "README.md", isFile: () => true }]);

    const response = await GET(makeRequest("?file=OpenClaw%20Docs%3AREADME.md"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ status: "ok", name: "README.md", content: "# hello" });
  });

  it("returns 404 for unknown document ids", async () => {
    fsMocks.readdir.mockResolvedValueOnce([{ name: "README.md", isFile: () => true }]);

    const response = await GET(makeRequest("?file=../../../etc/passwd"));
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload).toEqual({ status: "error", message: "File not found." });
  });

  it("returns 404 for non-existent files", async () => {
    const err = new Error("missing") as NodeJS.ErrnoException;
    err.code = "ENOENT";
    fsMocks.stat.mockRejectedValueOnce(err);
    fsMocks.readdir.mockResolvedValueOnce([{ name: "missing.md", isFile: () => true }]);

    const response = await GET(makeRequest("?file=OpenClaw%20Docs%3Amissing.md"));
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload).toEqual({ status: "error", message: "File not found." });
  });

  it("returns proper JSON shape for list and content payloads", async () => {
    fsMocks.readdir.mockResolvedValueOnce([{ name: "a.md", isFile: () => true }]);
    let response = await GET(makeRequest());
    let payload = await response.json();

    expect(payload.status).toBe("ok");
    expect(Array.isArray(payload.files)).toBe(true);
    expect(payload.files[0]).toMatchObject({ id: "OpenClaw Docs:a.md", name: "a.md", section: "OpenClaw Docs" });

    fsMocks.stat.mockResolvedValueOnce({ isFile: () => true });
    fsMocks.readFile.mockResolvedValueOnce("content");
    fsMocks.readdir.mockResolvedValueOnce([{ name: "a.md", isFile: () => true }]);
    response = await GET(makeRequest("?file=OpenClaw%20Docs%3Aa.md"));
    payload = await response.json();

    expect(payload).toMatchObject({
      status: "ok",
      name: "a.md",
      content: "content",
    });
  });
});
