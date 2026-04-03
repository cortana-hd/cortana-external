import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DocsClient from "@/app/docs/docs-client";

const jsonResponse = (payload: unknown, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  }) as Response;

describe("DocsClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders OpenClaw Docs header text", async () => {
    vi.spyOn(global, "fetch")
      .mockResolvedValueOnce(jsonResponse({ status: "ok", files: [] }))
      .mockResolvedValueOnce(jsonResponse({ status: "ok", name: "", content: "" }));

    render(<DocsClient />);
    expect(screen.getByText("Docs Library")).toBeInTheDocument();
  });

  it("shows loading state initially", () => {
    vi.spyOn(global, "fetch").mockImplementation(() => new Promise(() => {}));

    render(<DocsClient />);
    expect(screen.getByText("Loading docs...")).toBeInTheDocument();
  });

  it("renders file list after fetch resolves", async () => {
    vi.spyOn(global, "fetch")
      .mockResolvedValueOnce(
        jsonResponse({
          status: "ok",
          files: [
            { id: "OpenClaw Docs:b.md", name: "b.md", path: "/docs/b.md", section: "OpenClaw Docs" },
            { id: "OpenClaw Docs:a.md", name: "a.md", path: "/docs/a.md", section: "OpenClaw Docs" },
          ],
        })
      )
      .mockResolvedValueOnce(jsonResponse({ status: "ok", name: "a.md", content: "# A" }));

    render(<DocsClient />);

    expect(await screen.findByRole("button", { name: "a.md" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "b.md" })).toBeInTheDocument();
  });

  it("clicking a file updates selection and fetches content", async () => {
    const fetchMock = vi
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(
        jsonResponse({
          status: "ok",
          files: [
            { id: "OpenClaw Docs:a.md", name: "a.md", path: "/docs/a.md", section: "OpenClaw Docs" },
            { id: "Backtester Docs:b.md", name: "b.md", path: "/docs/b.md", section: "Backtester Docs" },
          ],
        })
      )
      .mockResolvedValueOnce(jsonResponse({ status: "ok", name: "a.md", content: "A content" }))
      .mockResolvedValueOnce(jsonResponse({ status: "ok", name: "b.md", content: "B content" }));

    render(<DocsClient />);

    const secondFile = await screen.findByRole("button", { name: "b.md" });
    fireEvent.click(secondFile);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/docs?file=Backtester%20Docs%3Ab.md", { cache: "no-store" });
    });

    await screen.findByText("B content");
    expect(secondFile.className).toContain("bg-primary/10");
  });

  it("shows error state when API returns error", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      jsonResponse({ status: "error", message: "No docs root" }, 500)
    );

    render(<DocsClient />);

    expect(await screen.findByText("Docs unavailable")).toBeInTheDocument();
    expect(screen.getByText("No docs root")).toBeInTheDocument();
  });

  it("does not render a DOCS_PATH badge", async () => {
    vi.spyOn(global, "fetch")
      .mockResolvedValueOnce(jsonResponse({ status: "ok", files: [] }))
      .mockResolvedValueOnce(jsonResponse({ status: "ok", name: "", content: "" }));

    render(<DocsClient />);

    await screen.findByText("No markdown files found.");
    expect(screen.queryByText(/DOCS_PATH/i)).not.toBeInTheDocument();
  });

  it("renders section headers for multiple doc sources", async () => {
    vi.spyOn(global, "fetch")
      .mockResolvedValueOnce(
        jsonResponse({
          status: "ok",
          files: [
            { id: "OpenClaw Docs:a.md", name: "a.md", path: "/docs/a.md", section: "OpenClaw Docs" },
            { id: "Backtester Docs:README.md", name: "README.md", path: "/backtester/README.md", section: "Backtester Docs" },
          ],
        })
      )
      .mockResolvedValueOnce(jsonResponse({ status: "ok", name: "a.md", content: "# A" }));

    render(<DocsClient />);

    expect(await screen.findByText("OpenClaw Docs")).toBeInTheDocument();
    expect(screen.getByText("Backtester Docs")).toBeInTheDocument();
  });
});
