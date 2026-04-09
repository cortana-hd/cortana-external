"use client";

import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Calendar,
  ChevronDown,
  ChevronRight,
  List,
  Menu,
  Search,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { extractHeadings, getTextContent, slugify } from "@/lib/markdown-utils";

/* ── types ── */

type MemoriesResponse = {
  dates: string[];
  content?: string;
  error?: string;
};

type LongTermResponse = {
  content: string;
  updatedAt: string | null;
  error?: string;
};

/* ── pure helpers ── */

const formatDate = (value: string) => {
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(y, (m ?? 1) - 1, d ?? 1);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
};

/* ── main component ── */

export default function MemoriesPage() {
  const [activeTab, setActiveTab] = React.useState("daily");

  const [dates, setDates] = React.useState<string[]>([]);
  const [selectedDate, setSelectedDate] = React.useState<string | null>(null);
  const [dailyContent, setDailyContent] = React.useState("");
  const [dailyLoading, setDailyLoading] = React.useState(true);
  const [dailyContentLoading, setDailyContentLoading] = React.useState(false);
  const [dailyError, setDailyError] = React.useState<string | null>(null);

  const [longTermContent, setLongTermContent] = React.useState("");
  const [longTermUpdatedAt, setLongTermUpdatedAt] = React.useState<string | null>(null);
  const [longTermLoading, setLongTermLoading] = React.useState(false);
  const [longTermLoaded, setLongTermLoaded] = React.useState(false);
  const [longTermError, setLongTermError] = React.useState<string | null>(null);

  const [searchQuery, setSearchQuery] = React.useState("");
  const [activeHeadingId, setActiveHeadingId] = React.useState<string | null>(null);
  const [mobileSidebarOpen, setMobileSidebarOpen] = React.useState(false);
  const [mobileTocOpen, setMobileTocOpen] = React.useState(false);

  const contentRef = React.useRef<HTMLDivElement>(null);

  /* ── derived ── */
  const activeContent = activeTab === "daily" ? dailyContent : longTermContent;
  const headings = React.useMemo(() => extractHeadings(activeContent), [activeContent]);

  const filteredDates = React.useMemo(() => {
    if (!searchQuery) return dates;
    const q = searchQuery.toLowerCase();
    return dates.filter((d) => d.includes(q) || formatDate(d).toLowerCase().includes(q));
  }, [dates, searchQuery]);

  /* ── data fetching ── */
  React.useEffect(() => {
    let mounted = true;
    const loadDates = async () => {
      try {
        setDailyLoading(true);
        const response = await fetch("/api/memories", { cache: "no-store" });
        const data = (await response.json()) as MemoriesResponse;
        if (!response.ok) throw new Error(data.error ?? "Failed to load memories");
        if (!mounted) return;
        setDates(data.dates ?? []);
        setSelectedDate(data.dates?.[0] ?? null);
      } catch (error) {
        if (!mounted) return;
        setDailyError(error instanceof Error ? error.message : "Failed to load memories");
      } finally {
        if (mounted) setDailyLoading(false);
      }
    };
    void loadDates();
    return () => { mounted = false; };
  }, []);

  React.useEffect(() => {
    let mounted = true;
    if (!selectedDate) { setDailyContent(""); return; }
    const loadContent = async () => {
      try {
        setDailyContentLoading(true);
        const response = await fetch(`/api/memories?date=${selectedDate}`, { cache: "no-store" });
        const data = (await response.json()) as MemoriesResponse;
        if (!response.ok) throw new Error(data.error ?? "Failed to load memory content");
        if (!mounted) return;
        setDailyContent(data.content ?? "");
      } catch (error) {
        if (!mounted) return;
        setDailyError(error instanceof Error ? error.message : "Failed to load memory content");
      } finally {
        if (mounted) setDailyContentLoading(false);
      }
    };
    void loadContent();
    return () => { mounted = false; };
  }, [selectedDate]);

  React.useEffect(() => {
    if (activeTab !== "longterm" || longTermLoaded) return;
    let mounted = true;
    const loadLongTerm = async () => {
      try {
        setLongTermLoading(true);
        const response = await fetch("/api/memories/longterm", { cache: "no-store" });
        const data = (await response.json()) as LongTermResponse;
        if (!response.ok) throw new Error(data.error ?? "Failed to load long-term memory");
        if (!mounted) return;
        setLongTermContent(data.content ?? "");
        setLongTermUpdatedAt(data.updatedAt ?? null);
        setLongTermLoaded(true);
      } catch (error) {
        if (!mounted) return;
        setLongTermError(error instanceof Error ? error.message : "Failed to load long-term memory");
      } finally {
        if (mounted) setLongTermLoading(false);
      }
    };
    void loadLongTerm();
    return () => { mounted = false; };
  }, [activeTab, longTermLoaded]);

  /* reset on content change */
  React.useEffect(() => {
    setActiveHeadingId(null);
    setMobileTocOpen(false);
  }, [selectedDate, activeTab]);

  /* ── scroll-spy ── */
  React.useEffect(() => {
    if (headings.length === 0) return;
    if (typeof IntersectionObserver === "undefined") return;
    const el = contentRef.current;
    if (!el) return;

    const headingElements = headings
      .map((h) => el.querySelector(`[id="${h.id}"]`))
      .filter(Boolean) as Element[];

    if (headingElements.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length > 0) setActiveHeadingId(visible[0].target.id);
      },
      { rootMargin: "-80px 0px -70% 0px", threshold: 0 },
    );

    headingElements.forEach((hEl) => observer.observe(hEl));
    return () => observer.disconnect();
  }, [headings, activeContent]);

  /* ── body scroll lock for mobile sidebar ── */
  React.useEffect(() => {
    if (mobileSidebarOpen) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => { document.body.style.overflow = ""; };
  }, [mobileSidebarOpen]);

  /* ── heading components for ReactMarkdown ── */
  const headingComponents = React.useMemo(() => {
    const make = (Tag: "h1" | "h2" | "h3" | "h4" | "h5" | "h6") => {
      const Comp = ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => {
        const text = getTextContent(children);
        const id = slugify(text);
        return <Tag id={id} {...props}>{children}</Tag>;
      };
      Comp.displayName = Tag;
      return Comp;
    };
    return { h1: make("h1"), h2: make("h2"), h3: make("h3"), h4: make("h4"), h5: make("h5"), h6: make("h6") };
  }, []);

  /* ── TOC ── */
  const tocContent = headings.length > 0 ? (
    <nav className="space-y-0.5">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        <List className="h-3.5 w-3.5" />
        On this page
      </p>
      {headings.map((h) => (
        <a
          key={h.id}
          href={`#${h.id}`}
          onClick={(e) => {
            e.preventDefault();
            const target = contentRef.current?.querySelector(`[id="${h.id}"]`);
            if (target) {
              target.scrollIntoView({ behavior: "smooth", block: "start" });
              setActiveHeadingId(h.id);
            }
          }}
          className={cn(
            "docs-toc-link",
            h.level >= 3 && "pl-6 text-xs",
            h.level >= 4 && "pl-9",
            activeHeadingId === h.id && "docs-toc-link-active",
          )}
        >
          {h.text}
        </a>
      ))}
    </nav>
  ) : null;

  /* ── sidebar content (date picker) ── */
  const sidebarContent = (
    <nav className="space-y-3">
      {/* Search */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search dates..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="h-8 pl-8 pr-8 text-sm"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => setSearchQuery("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Date list */}
      <div className="space-y-0.5">
        <button
          type="button"
          onClick={() => setActiveTab("daily")}
          className={cn(
            "docs-nav-section",
            activeTab === "daily" && "text-foreground",
          )}
        >
          <ChevronRight className={cn("h-3 w-3 shrink-0 text-muted-foreground/70 transition-transform duration-150", activeTab === "daily" && "rotate-90")} />
          <span className="min-w-0 flex-1 truncate">Daily Memories</span>
          <span className="shrink-0 rounded-full bg-muted/60 px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
            {dates.length}
          </span>
        </button>
        {activeTab === "daily" && (
          dailyLoading ? (
            <p className="px-2 py-3 text-sm text-muted-foreground">Loading...</p>
          ) : filteredDates.length === 0 ? (
            <p className="px-2 py-3 text-sm text-muted-foreground">
              {searchQuery ? `No results for "${searchQuery}"` : "No memories found."}
            </p>
          ) : (
            filteredDates.map((date) => {
              const isActive = date === selectedDate;
              return (
                <button
                  key={date}
                  type="button"
                  onClick={() => {
                    setSelectedDate(date);
                    setActiveTab("daily");
                    setMobileSidebarOpen(false);
                  }}
                  className={cn("docs-nav-file", isActive && "docs-nav-file-active")}
                  style={{ paddingLeft: "14px" }}
                >
                  <Calendar className="h-3 w-3 shrink-0 text-muted-foreground/70" />
                  <span className="truncate">{formatDate(date)}</span>
                </button>
              );
            })
          )
        )}
      </div>

      {/* Long-term memory link */}
      <div className="space-y-0.5">
        <button
          type="button"
          onClick={() => setActiveTab("longterm")}
          className={cn(
            "docs-nav-section",
            activeTab === "longterm" && "text-foreground",
          )}
        >
          <ChevronRight className={cn("h-3 w-3 shrink-0 text-muted-foreground/70 transition-transform duration-150", activeTab === "longterm" && "rotate-90")} />
          <span className="min-w-0 flex-1 truncate">Persistent</span>
        </button>
        {activeTab === "longterm" && (
          <button
            type="button"
            onClick={() => {
              setActiveTab("longterm");
              setMobileSidebarOpen(false);
            }}
            className={cn("docs-nav-file docs-nav-file-active")}
            style={{ paddingLeft: "14px" }}
          >
            <List className="h-3 w-3 shrink-0 text-muted-foreground/70" />
            <span className="truncate">MEMORY.md</span>
          </button>
        )}
      </div>
    </nav>
  );

  /* ── render active content ── */
  const renderContent = () => {
    if (activeTab === "longterm") {
      return (
        <>
          <div className="mb-6 space-y-2 border-b border-border/50 pb-4">
            <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Long-Term Memory</h1>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">MEMORY.md</Badge>
              {longTermUpdatedAt && (
                <span className="text-xs text-muted-foreground">
                  Updated {new Date(longTermUpdatedAt).toLocaleString()}
                </span>
              )}
            </div>
          </div>

          <div ref={contentRef}>
            {longTermError ? (
              <p className="py-8 text-sm text-muted-foreground">{longTermError}</p>
            ) : longTermLoading ? (
              <p className="py-8 text-sm text-muted-foreground">Loading MEMORY.md...</p>
            ) : longTermContent.trim() ? (
              <article className="docs-prose pb-16">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={headingComponents}>
                  {longTermContent}
                </ReactMarkdown>
              </article>
            ) : (
              <p className="py-8 text-sm text-muted-foreground">No long-term memory content yet.</p>
            )}
          </div>
        </>
      );
    }

    // Daily tab
    return (
      <>
        {/* Breadcrumbs */}
        {selectedDate && (
          <nav className="mb-3 flex items-center gap-1 text-sm">
            <span className="text-muted-foreground">Daily Memories</span>
            <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
            <span className="font-medium text-foreground">{formatDate(selectedDate)}</span>
          </nav>
        )}

        {/* Document title + metadata */}
        {selectedDate && (
          <div className="mb-6 space-y-2 border-b border-border/50 pb-4">
            <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
              {formatDate(selectedDate)}
            </h1>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{selectedDate}</Badge>
              <span className="text-xs text-muted-foreground">Daily memory</span>
            </div>
          </div>
        )}

        {dailyError ? (
          <Card className="border-destructive/40 bg-destructive/5">
            <CardHeader>
              <CardTitle className="text-base">Error</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">{dailyError}</CardContent>
          </Card>
        ) : (
          <div ref={contentRef}>
            {dailyContentLoading ? (
              <p className="py-8 text-sm text-muted-foreground">Loading content...</p>
            ) : dailyContent.trim() ? (
              <article className="docs-prose pb-16">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={headingComponents}>
                  {dailyContent}
                </ReactMarkdown>
              </article>
            ) : (
              <p className="py-8 text-sm text-muted-foreground">
                {selectedDate ? "No content for this date." : "Select a date to view memories."}
              </p>
            )}
          </div>
        )}
      </>
    );
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="space-y-1">
        <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">Memory Vault</p>
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Memories</h1>
        <p className="text-sm text-muted-foreground">
          Daily notes and long-term memory from Cortana.
        </p>
      </div>

      {/* Mobile top bar */}
      <div className="flex items-center gap-2 md:hidden">
        <button
          type="button"
          onClick={() => setMobileSidebarOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted/40"
        >
          <Menu className="h-4 w-4" />
          Browse
        </button>
        {activeTab === "daily" && selectedDate && (
          <span className="truncate text-sm text-muted-foreground">{formatDate(selectedDate)}</span>
        )}
        {activeTab === "longterm" && (
          <span className="truncate text-sm text-muted-foreground">MEMORY.md</span>
        )}
      </div>

      {/* Mobile sidebar overlay */}
      {mobileSidebarOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={() => setMobileSidebarOpen(false)} />
          <div className="fixed inset-y-0 left-0 z-50 w-80 max-w-[calc(100vw-3rem)] overflow-y-auto border-r bg-background shadow-lg">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <span className="text-sm font-semibold">Memories</span>
              <button
                type="button"
                onClick={() => setMobileSidebarOpen(false)}
                className="rounded-md p-1 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-3">{sidebarContent}</div>
          </div>
        </div>
      )}

      {/* Three-column grid */}
      <div className="md:grid md:grid-cols-[16rem_minmax(0,1fr)] md:gap-6 xl:grid-cols-[16rem_minmax(0,1fr)_14rem] xl:gap-8">
        {/* Left sidebar (desktop) */}
        <aside className="hidden md:block">
          <div className="sticky top-8 max-h-[calc(100vh-4rem)] overflow-y-auto rounded-lg border border-border/50 bg-card/30 p-3">
            {sidebarContent}
          </div>
        </aside>

        {/* Center content */}
        <div className="min-w-0">
          {/* Mobile/tablet TOC accordion */}
          {headings.length > 0 && (
            <div className="mb-4 xl:hidden">
              <button
                type="button"
                onClick={() => setMobileTocOpen((o) => !o)}
                className="flex w-full items-center justify-between rounded-md border border-border/50 bg-muted/20 px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                <span className="flex items-center gap-1.5">
                  <List className="h-3.5 w-3.5" />
                  On this page
                </span>
                <ChevronDown className={cn("h-4 w-4 transition-transform", mobileTocOpen && "rotate-180")} />
              </button>
              {mobileTocOpen && (
                <div className="mt-1 rounded-md border border-border/50 bg-card/40 p-3">
                  {tocContent}
                </div>
              )}
            </div>
          )}

          {renderContent()}
        </div>

        {/* Right TOC rail (desktop only) */}
        <aside className="hidden xl:block">
          <div className="sticky top-8 max-h-[calc(100vh-4rem)] overflow-y-auto">
            {tocContent}
          </div>
        </aside>
      </div>
    </div>
  );
}
