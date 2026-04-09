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

  it("renders header text", async () => {
    vi.spyOn(global, "fetch")
      .mockResolvedValueOnce(jsonResponse({ status: "ok", files: [] }))
      .mockResolvedValueOnce(jsonResponse({ status: "ok", name: "", content: "" }));

    render(<DocsClient />);
    expect(screen.getByText("Docs Library")).toBeInTheDocument();
    expect(screen.getByText("Documentation")).toBeInTheDocument();
    expect(await screen.findByText("No markdown files found.")).toBeInTheDocument();
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

    expect(await screen.findByRole("button", { name: /\ba\b/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /\bb\b/i })).toBeInTheDocument();
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

    const secondFile = await screen.findByRole("button", { name: /\bb\b/i });
    fireEvent.click(secondFile);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/docs?file=Backtester%20Docs%3Ab.md", { cache: "no-store" });
    });

    await screen.findByText("B content");
    expect(secondFile).toHaveAttribute("aria-pressed", "true");
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
            { id: "Mission Control Research:raw/mission-control/README.md", name: "raw/mission-control/README.md", path: "/research/raw/mission-control/README.md", section: "Mission Control Research" },
            { id: "Backtester Docs:README.md", name: "README.md", path: "/backtester/README.md", section: "Backtester Docs" },
            { id: "Backtester Research:raw/backtester/README.md", name: "raw/backtester/README.md", path: "/research/raw/backtester/README.md", section: "Backtester Research" },
            { id: "OpenClaw Knowledge:README.md", name: "README.md", path: "/knowledge/README.md", section: "OpenClaw Knowledge" },
            { id: "OpenClaw Research:README.md", name: "README.md", path: "/research/README.md", section: "OpenClaw Research" },
          ],
        })
      )
      .mockResolvedValueOnce(jsonResponse({ status: "ok", name: "a.md", content: "# A" }));

    render(<DocsClient />);

    expect((await screen.findAllByText("OpenClaw Docs")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Mission Control Research").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Backtester Docs").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Backtester Research").length).toBeGreaterThan(0);
    expect(screen.getAllByText("OpenClaw Knowledge").length).toBeGreaterThan(0);
    expect(screen.getAllByText("OpenClaw Research").length).toBeGreaterThan(0);
  });

  it("renders search input", async () => {
    vi.spyOn(global, "fetch")
      .mockResolvedValueOnce(
        jsonResponse({
          status: "ok",
          files: [
            { id: "OpenClaw Docs:a.md", name: "a.md", path: "/docs/a.md", section: "OpenClaw Docs" },
          ],
        })
      )
      .mockResolvedValueOnce(jsonResponse({ status: "ok", name: "a.md", content: "# A" }));

    render(<DocsClient />);

    await screen.findByRole("button", { name: /\ba\b/i });
    expect(screen.getAllByPlaceholderText("Search docs...").length).toBeGreaterThan(0);
  });

  it("renders breadcrumbs for selected file", async () => {
    vi.spyOn(global, "fetch")
      .mockResolvedValueOnce(
        jsonResponse({
          status: "ok",
          files: [
            { id: "External Docs:source/arch/design.md", name: "source/arch/design.md", path: "/docs/source/arch/design.md", section: "External Docs" },
          ],
        })
      )
      .mockResolvedValueOnce(jsonResponse({ status: "ok", name: "design.md", content: "# Design" }));

    const { container } = render(<DocsClient />);

    // Wait for file to appear in sidebar (file button shows basename without .md)
    await screen.findByRole("button", { name: /design/i });

    // Breadcrumbs should contain path segments
    expect(container).toHaveTextContent("External Docs");
    expect(container).toHaveTextContent("source");
    expect(container).toHaveTextContent("arch");
    expect(container).toHaveTextContent("design.md");
  });

  it("keeps folders collapsed until clicked", async () => {
    vi.spyOn(global, "fetch")
      .mockResolvedValueOnce(
        jsonResponse({
          status: "ok",
          files: [
            { id: "OpenClaw Docs:archive/old.md", name: "archive/old.md", path: "/docs/archive/old.md", section: "OpenClaw Docs" },
            { id: "OpenClaw Docs:source/new.md", name: "source/new.md", path: "/docs/source/new.md", section: "OpenClaw Docs" },
          ],
        })
      )
      .mockResolvedValueOnce(jsonResponse({ status: "ok", name: "new.md", content: "# New" }));

    render(<DocsClient />);

    await screen.findByRole("button", { name: /source/i });
    expect(screen.queryByRole("button", { name: /new/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /old/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /source/i }));
    expect(await screen.findByRole("button", { name: /new/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /archive/i }));

    expect(await screen.findByRole("button", { name: /old/i })).toBeInTheDocument();
  });
});
