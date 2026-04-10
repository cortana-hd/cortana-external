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
    window.scrollTo = vi.fn();
    window.localStorage.clear();
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
            { id: "OpenClaw Docs:b.md", name: "b.md", path: "/docs/b.md", section: "OpenClaw Docs" },
          ],
        })
      )
      .mockResolvedValueOnce(jsonResponse({ status: "ok", name: "a.md", content: "A content" }))
      .mockResolvedValueOnce(jsonResponse({ status: "ok", name: "b.md", content: "B content" }));

    render(<DocsClient />);

    const secondFile = await screen.findByRole("button", { name: /\bb\b/i });
    fireEvent.click(secondFile);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/docs?file=OpenClaw%20Docs%3Ab.md", { cache: "no-store" });
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
            { id: "External Docs:README.md", name: "README.md", path: "/docs/README.md", section: "External Docs" },
            { id: "Mission Control Research:raw/mission-control/README.md", name: "raw/mission-control/README.md", path: "/research/raw/mission-control/README.md", section: "Mission Control Research" },
            { id: "Backtester Docs:README.md", name: "README.md", path: "/backtester/README.md", section: "Backtester Docs" },
            { id: "Backtester Research:raw/backtester/README.md", name: "raw/backtester/README.md", path: "/research/raw/backtester/README.md", section: "Backtester Research" },
            { id: "OpenClaw Docs:a.md", name: "a.md", path: "/docs/a.md", section: "OpenClaw Docs" },
            { id: "OpenClaw Knowledge:README.md", name: "README.md", path: "/knowledge/README.md", section: "OpenClaw Knowledge" },
            { id: "OpenClaw Research:README.md", name: "README.md", path: "/research/README.md", section: "OpenClaw Research" },
          ],
        })
      )
      .mockResolvedValueOnce(jsonResponse({ status: "ok", name: "README.md", content: "# External Docs" }));

    render(<DocsClient />);

    expect((await screen.findAllByText("External")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Cortana").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Docs").length).toBeGreaterThan(0);
  });

  it("keeps inactive repo groups collapsed until clicked", async () => {
    vi.spyOn(global, "fetch")
      .mockResolvedValueOnce(
        jsonResponse({
          status: "ok",
          files: [
            { id: "External Docs:README.md", name: "README.md", path: "/docs/README.md", section: "External Docs" },
            { id: "OpenClaw Knowledge:README.md", name: "README.md", path: "/knowledge/README.md", section: "OpenClaw Knowledge" },
          ],
        })
      )
      .mockResolvedValueOnce(jsonResponse({ status: "ok", name: "README.md", content: "# External Docs" }));

    render(<DocsClient />);

    await screen.findByText("External");
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /knowledge/i })).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /cortana/i }));

    expect(await screen.findByRole("button", { name: /knowledge/i })).toBeInTheDocument();
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

    await waitFor(() => {
      expect(screen.getAllByPlaceholderText("Search docs...").length).toBeGreaterThan(0);
    });
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
    expect(container).toHaveTextContent("Docs");
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
            { id: "OpenClaw Docs:README.md", name: "README.md", path: "/docs/README.md", section: "OpenClaw Docs" },
            { id: "OpenClaw Docs:archive/old.md", name: "archive/old.md", path: "/docs/archive/old.md", section: "OpenClaw Docs" },
            { id: "OpenClaw Docs:source/new.md", name: "source/new.md", path: "/docs/source/new.md", section: "OpenClaw Docs" },
          ],
        })
      )
      .mockResolvedValueOnce(jsonResponse({ status: "ok", name: "README.md", content: "# Docs" }));

    render(<DocsClient />);

    await screen.findByText("source");
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /\bnew\b/i })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /\bold\b/i })).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("source"));
    expect(await screen.findByRole("button", { name: /\bnew\b/i })).toBeInTheDocument();

    fireEvent.click(screen.getByText("archive"));

    expect(await screen.findByRole("button", { name: /\bold\b/i })).toBeInTheDocument();
  });

  it("resolves knowledge links into OpenClaw research docs", async () => {
    const fetchMock = vi
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(
        jsonResponse({
          status: "ok",
          files: [
            {
              id: "OpenClaw Knowledge:domains/spartan/coaching-rules.md",
              name: "domains/spartan/coaching-rules.md",
              path: "/knowledge/domains/spartan/coaching-rules.md",
              section: "OpenClaw Knowledge",
            },
            {
              id: "OpenClaw Research:derived/spartan/spartan-evidence-map.md",
              name: "derived/spartan/spartan-evidence-map.md",
              path: "/research/derived/spartan/spartan-evidence-map.md",
              section: "OpenClaw Research",
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          status: "ok",
          name: "coaching-rules.md",
          content: "# Spartan Coaching Rules\n\n- [Spartan evidence map](../../../research/derived/spartan/spartan-evidence-map.md)",
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({ status: "ok", name: "spartan-evidence-map.md", content: "# Evidence map" })
      );

    render(<DocsClient />);

    const evidenceLink = await screen.findByRole("link", { name: /spartan evidence map/i });
    fireEvent.click(evidenceLink);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/docs?file=OpenClaw%20Research%3Aderived%2Fspartan%2Fspartan-evidence-map.md",
        { cache: "no-store" },
      );
    });
  });

  it("resolves knowledge links into OpenClaw planning docs", async () => {
    const fetchMock = vi
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(
        jsonResponse({
          status: "ok",
          files: [
            {
              id: "OpenClaw Knowledge:domains/spartan/coaching-rules.md",
              name: "domains/spartan/coaching-rules.md",
              path: "/knowledge/domains/spartan/coaching-rules.md",
              section: "OpenClaw Knowledge",
            },
            {
              id: "OpenClaw Docs:source/planning/spartan/roadmap/fitness-trainer-roadmap-2026-04-04.md",
              name: "source/planning/spartan/roadmap/fitness-trainer-roadmap-2026-04-04.md",
              path: "/docs/source/planning/spartan/roadmap/fitness-trainer-roadmap-2026-04-04.md",
              section: "OpenClaw Docs",
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          status: "ok",
          name: "coaching-rules.md",
          content: "# Spartan Coaching Rules\n\n- [Ultimate fitness trainer roadmap](../../../docs/source/planning/spartan/roadmap/fitness-trainer-roadmap-2026-04-04.md)",
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({ status: "ok", name: "fitness-trainer-roadmap-2026-04-04.md", content: "# Roadmap" })
      );

    render(<DocsClient />);

    const roadmapLink = await screen.findByRole("link", { name: /ultimate fitness trainer roadmap/i });
    fireEvent.click(roadmapLink);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/docs?file=OpenClaw%20Docs%3Asource%2Fplanning%2Fspartan%2Froadmap%2Ffitness-trainer-roadmap-2026-04-04.md",
        { cache: "no-store" },
      );
    });
  });

  it("resolves absolute filesystem links into OpenClaw knowledge docs", async () => {
    const fetchMock = vi
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(
        jsonResponse({
          status: "ok",
          files: [
            {
              id: "OpenClaw Research:derived/spartan/README.md",
              name: "derived/spartan/README.md",
              path: "/Users/hd/Developer/cortana/research/derived/spartan/README.md",
              section: "OpenClaw Research",
            },
            {
              id: "OpenClaw Knowledge:domains/spartan/overview.md",
              name: "domains/spartan/overview.md",
              path: "/Users/hd/Developer/cortana/knowledge/domains/spartan/overview.md",
              section: "OpenClaw Knowledge",
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          status: "ok",
          name: "README.md",
          content: "# Spartan Derived Research\n\n- [Spartan overview](/Users/hd/Developer/cortana/knowledge/domains/spartan/overview.md)",
        })
      )
      .mockResolvedValueOnce(jsonResponse({ status: "ok", name: "overview.md", content: "# Overview" }));

    render(<DocsClient />);

    const overviewLink = await screen.findByRole("link", { name: /spartan overview/i });
    fireEvent.click(overviewLink);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/docs?file=OpenClaw%20Knowledge%3Adomains%2Fspartan%2Foverview.md",
        { cache: "no-store" },
      );
    });
  });

  it("resolves repo-level external knowledge links into backtester docs", async () => {
    const fetchMock = vi
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(
        jsonResponse({
          status: "ok",
          files: [
            {
              id: "External Knowledge:domains/backtester/overview.md",
              name: "domains/backtester/overview.md",
              path: "/Users/hd/Developer/cortana-external/knowledge/domains/backtester/overview.md",
              section: "External Knowledge",
            },
            {
              id: "Backtester Docs:source/guide/backtester-study-guide.md",
              name: "source/guide/backtester-study-guide.md",
              path: "/Users/hd/Developer/cortana-external/backtester/docs/source/guide/backtester-study-guide.md",
              section: "Backtester Docs",
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          status: "ok",
          name: "overview.md",
          content: "# Backtester Overview\n\n- [Study guide](../../../backtester/docs/source/guide/backtester-study-guide.md)",
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({ status: "ok", name: "backtester-study-guide.md", content: "# Study guide" })
      );

    render(<DocsClient />);

    const studyGuideLink = await screen.findByRole("link", { name: /study guide/i });
    fireEvent.click(studyGuideLink);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/docs?file=Backtester%20Docs%3Asource%2Fguide%2Fbacktester-study-guide.md",
        { cache: "no-store" },
      );
    });
  });
});
