"use client";

import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
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
import type { Heading } from "@/lib/markdown-utils";

/* ── types ── */

type DocFile = { id: string; name: string; path: string; section: string };

type DocsListResponse =
  | { status: "ok"; files: DocFile[] }
  | { status: "error"; message: string };

type DocContentResponse =
  | { status: "ok"; name: string; content: string }
  | { status: "error"; message: string };

type TreeNode = {
  name: string;
  fullPath: string;
  children: TreeNode[];
  files: DocFile[];
};

type SectionTree = {
  section: string;
  root: TreeNode;
};

type SectionGroup = {
  group: string;
  sections: SectionTree[];
};

/* ── pure helpers ── */

function isArchiveFolderPath(fullPath: string): boolean {
  return fullPath.split("/").includes("archive");
}

function sortFolderNodes(nodes: TreeNode[]): TreeNode[] {
  return [...nodes].sort((a, b) => {
    const aArchive = isArchiveFolderPath(a.fullPath);
    const bArchive = isArchiveFolderPath(b.fullPath);
    if (aArchive !== bArchive) return aArchive ? 1 : -1;
    return a.name.localeCompare(b.name);
  });
}

function collectFolderPaths(node: TreeNode): string[] {
  const paths: string[] = [];
  for (const child of node.children) {
    paths.push(child.fullPath);
    paths.push(...collectFolderPaths(child));
  }
  return paths;
}

const SECTION_GROUP_ORDER = ["cortana-external", "OpenClaw"] as const;

function getSectionGroup(section: string): string {
  if (
    section === "External Docs" ||
    section === "Mission Control Research" ||
    section === "Backtester Docs" ||
    section === "Backtester Research"
  ) {
    return "cortana-external";
  }
  return "OpenClaw";
}

function getSectionLabel(section: string): string {
  if (section === "External Docs") return "Repo Docs";
  if (section === "OpenClaw Docs") return "Docs";
  if (section === "OpenClaw Knowledge") return "Knowledge";
  if (section === "OpenClaw Research") return "Research";
  return section;
}

function getGroupLabel(group: string): string {
  if (group === "cortana-external") return "cortana-external";
  return group;
}

function getSectionKey(group: string, section: string): string {
  return `${group}::${section}`;
}
function buildFolderTree(files: DocFile[], searchQuery: string): SectionTree[] {
  const query = searchQuery.toLowerCase();
  const filtered = query ? files.filter((f) => f.name.toLowerCase().includes(query)) : files;

  const bySection = new Map<string, DocFile[]>();
  for (const f of filtered) {
    const arr = bySection.get(f.section) ?? [];
    arr.push(f);
    bySection.set(f.section, arr);
  }

  return Array.from(bySection.entries()).map(([section, sectionFiles]) => {
    const root: TreeNode = { name: section, fullPath: section, children: [], files: [] };

    for (const file of sectionFiles) {
      const segments = file.name.split("/");
      let current = root;

      for (let i = 0; i < segments.length - 1; i++) {
        const seg = segments[i];
        let child = current.children.find((c) => c.name === seg);
        if (!child) {
          child = { name: seg, fullPath: `${current.fullPath}/${seg}`, children: [], files: [] };
          current.children.push(child);
        }
        current = child;
      }

      current.files.push(file);
    }

    return { section, root };
  });
}

function deriveBreadcrumbs(file: DocFile | null): string[] {
  if (!file) return [];
  return [getSectionLabel(file.section), ...file.name.split("/")];
}

function basename(name: string): string {
  const parts = name.split("/");
  return parts[parts.length - 1].replace(/\.md$/i, "");
}

function isArchiveFile(file: DocFile): boolean {
  return file.name.split("/").includes("archive");
}

function groupSectionTrees(sections: SectionTree[]): SectionGroup[] {
  const grouped = new Map<string, SectionTree[]>();
  for (const sectionTree of sections) {
    const group = getSectionGroup(sectionTree.section);
    const items = grouped.get(group) ?? [];
    items.push(sectionTree);
    grouped.set(group, items);
  }

  return SECTION_GROUP_ORDER.flatMap((group) => {
    const sectionsForGroup = grouped.get(group);
    if (!sectionsForGroup || sectionsForGroup.length === 0) return [];
    return [{ group, sections: sectionsForGroup }];
  });
}

function countNodeFiles(node: TreeNode): number {
  return node.files.length + node.children.reduce((sum, child) => sum + countNodeFiles(child), 0);
}

function collectAncestorFolderPaths(file: DocFile | null): string[] {
  if (!file) return [];
  const segments = file.name.split("/");
  const ancestors: string[] = [];
  let current = file.section;
  for (let i = 0; i < segments.length - 1; i++) {
    current = `${current}/${segments[i]}`;
    ancestors.push(current);
  }
  return ancestors;
}

/* ── main component ── */

export default function DocsClient() {
  const [files, setFiles] = React.useState<DocFile[]>([]);
  const [selectedFileId, setSelectedFileId] = React.useState<string | null>(null);
  const [content, setContent] = React.useState<string>("");
  const [searchQuery, setSearchQuery] = React.useState("");
  const [collapsedFolders, setCollapsedFolders] = React.useState<Set<string>>(new Set());
  const [collapsedGroups, setCollapsedGroups] = React.useState<Set<string>>(new Set());
  const [collapsedSections, setCollapsedSections] = React.useState<Set<string>>(new Set());
  const [activeHeadingId, setActiveHeadingId] = React.useState<string | null>(null);
  const [mobileSidebarOpen, setMobileSidebarOpen] = React.useState(false);
  const [mobileTocOpen, setMobileTocOpen] = React.useState(false);
  const [listLoading, setListLoading] = React.useState(true);
  const [contentLoading, setContentLoading] = React.useState(false);
  const [listError, setListError] = React.useState<string | null>(null);
  const [contentError, setContentError] = React.useState<string | null>(null);

  const contentRef = React.useRef<HTMLDivElement>(null);

  /* ── derived ── */
  const selectedFile = React.useMemo(
    () => files.find((f) => f.id === selectedFileId) ?? null,
    [files, selectedFileId],
  );
  const tree = React.useMemo(() => buildFolderTree(files, searchQuery), [files, searchQuery]);
  const groupedTree = React.useMemo(() => groupSectionTrees(tree), [tree]);
  const headings = React.useMemo(() => extractHeadings(content), [content]);
  const breadcrumbs = React.useMemo(() => deriveBreadcrumbs(selectedFile), [selectedFile]);
  const activeGroup = React.useMemo(
    () => (selectedFile ? getSectionGroup(selectedFile.section) : null),
    [selectedFile],
  );
  const activeSectionKey = React.useMemo(
    () => (selectedFile ? getSectionKey(getSectionGroup(selectedFile.section), selectedFile.section) : null),
    [selectedFile],
  );

  /* ── data fetching ── */
  React.useEffect(() => {
    let active = true;
    const loadList = async () => {
      try {
        setListLoading(true);
        const response = await fetch("/api/docs", { cache: "no-store" });
        const payload = (await response.json()) as DocsListResponse;
        if (!response.ok || payload.status !== "ok") {
          const message = payload.status === "error" ? payload.message : "Failed to load docs.";
          throw new Error(message);
        }
        if (active) {
          setFiles(payload.files);
          const preferred = payload.files.find((file) => !isArchiveFile(file)) ?? payload.files[0] ?? null;
          setSelectedFileId(preferred?.id ?? null);
          setListError(null);
        }
      } catch (error) {
        if (active) setListError(error instanceof Error ? error.message : "Failed to load docs.");
      } finally {
        if (active) setListLoading(false);
      }
    };
    void loadList();
    return () => { active = false; };
  }, []);

  React.useEffect(() => {
    let active = true;
    const loadDoc = async () => {
      if (!selectedFileId) {
        setContent("");
        setContentError(null);
        return;
      }
      try {
        setContentLoading(true);
        const response = await fetch(`/api/docs?file=${encodeURIComponent(selectedFileId)}`, { cache: "no-store" });
        const payload = (await response.json()) as DocContentResponse;
        if (!response.ok || payload.status !== "ok") {
          const message = payload.status === "error" ? payload.message : "Failed to load doc.";
          throw new Error(message);
        }
        if (active) {
          setContent(payload.content);
          setContentError(null);
        }
      } catch (error) {
        if (active) setContentError(error instanceof Error ? error.message : "Failed to load doc.");
      } finally {
        if (active) setContentLoading(false);
      }
    };
    void loadDoc();
    return () => { active = false; };
  }, [selectedFileId]);

  /* reset on doc change */
  React.useEffect(() => {
    setActiveHeadingId(null);
    setMobileTocOpen(false);
  }, [selectedFileId]);

  React.useEffect(() => {
    if (tree.length === 0) return;
    setCollapsedFolders((prev) => {
      if (prev.size > 0) return prev;
      const next = new Set(prev);
      for (const { root } of tree) {
        for (const fullPath of collectFolderPaths(root)) {
          next.add(fullPath);
        }
      }
      for (const fullPath of collectAncestorFolderPaths(selectedFile)) {
        next.delete(fullPath);
      }
      return next;
    });
    setCollapsedGroups((prev) => {
      if (prev.size > 0) return prev;
      const next = new Set<string>();
      for (const { group } of groupedTree) {
        if (group !== activeGroup) next.add(group);
      }
      return next;
    });
    setCollapsedSections((prev) => {
      if (prev.size > 0) return prev;
      const next = new Set<string>();
      for (const { group, sections } of groupedTree) {
        for (const { section } of sections) {
          const key = getSectionKey(group, section);
          if (key !== activeSectionKey) next.add(key);
        }
      }
      return next;
    });
  }, [tree, groupedTree, selectedFile, activeGroup, activeSectionKey]);

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
  }, [headings, content]);

  /* ── body scroll lock for mobile sidebar ── */
  React.useEffect(() => {
    if (mobileSidebarOpen) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => { document.body.style.overflow = ""; };
  }, [mobileSidebarOpen]);

  /* ── markdown components for ReactMarkdown ── */
  const markdownComponents = React.useMemo(() => {
    const make = (Tag: "h1" | "h2" | "h3" | "h4" | "h5" | "h6") => {
      const Comp = ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => {
        const text = getTextContent(children);
        const id = slugify(text);
        return <Tag id={id} {...props}>{children}</Tag>;
      };
      Comp.displayName = Tag;
      return Comp;
    };

    /* Intercept relative .md links and navigate within the docs viewer */
    const DocLink = ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => {
      if (href && !href.startsWith("http") && !href.startsWith("#") && href.endsWith(".md")) {
        return (
          <a
            {...props}
            href={href}
            onClick={(e) => {
              e.preventDefault();
              // Resolve relative path against current file
              const currentDir = selectedFile ? selectedFile.name.split("/").slice(0, -1).join("/") : "";
              const parts = [...(currentDir ? currentDir.split("/") : []), ...href.split("/")];
              const resolved: string[] = [];
              for (const part of parts) {
                if (part === "..") resolved.pop();
                else if (part !== "." && part !== "") resolved.push(part);
              }
              const targetPath = resolved.join("/");

              // Find matching file across all sections
              const match = files.find((f) =>
                f.name === targetPath || f.name.endsWith("/" + targetPath) || f.name.endsWith(targetPath)
              );
              if (match) {
                setSelectedFileId(match.id);
                window.scrollTo({ top: 0, behavior: "smooth" });
              }
            }}
          >
            {children}
          </a>
        );
      }
      return <a href={href} {...props}>{children}</a>;
    };
    DocLink.displayName = "DocLink";

    return {
      h1: make("h1"), h2: make("h2"), h3: make("h3"), h4: make("h4"), h5: make("h5"), h6: make("h6"),
      a: DocLink,
    };
  }, [selectedFile, files]);

  /* ── folder toggle ── */
  const toggleFolder = React.useCallback((fullPath: string) => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(fullPath)) next.delete(fullPath);
      else next.add(fullPath);
      return next;
    });
  }, []);

  const toggleGroup = React.useCallback((group: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  }, []);

  const toggleSection = React.useCallback((group: string, section: string) => {
    const key = getSectionKey(group, section);
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const selectFile = React.useCallback((id: string) => {
    setSelectedFileId(id);
    setMobileSidebarOpen(false);
  }, []);

  /* ── sidebar nav tree renderer ── */
  const renderNode = (node: TreeNode, depth: number) => {
    const isSearching = searchQuery.length > 0;

    return (
      <div key={node.fullPath}>
        {/* Folder nodes */}
        {sortFolderNodes(node.children).map((child) => {
          const isCollapsed = !isSearching && collapsedFolders.has(child.fullPath);
          return (
            <div key={child.fullPath}>
              <button
                type="button"
                onClick={() => toggleFolder(child.fullPath)}
                className="docs-nav-item"
                style={{ paddingLeft: `${depth * 12 + 8}px` }}
              >
                {isCollapsed ? <ChevronRight className="h-3.5 w-3.5 shrink-0" /> : <ChevronDown className="h-3.5 w-3.5 shrink-0" />}
                {isCollapsed ? <Folder className="h-3.5 w-3.5 shrink-0" /> : <FolderOpen className="h-3.5 w-3.5 shrink-0" />}
                <span className="truncate">{child.name}</span>
              </button>
              {!isCollapsed && renderNode(child, depth + 1)}
            </div>
          );
        })}

        {/* File leaf nodes */}
        {node.files.map((file) => {
          const isActive = file.id === selectedFileId;
          return (
            <button
              key={file.id}
              type="button"
              onClick={() => selectFile(file.id)}
              aria-pressed={isActive}
              className={cn("docs-nav-item", isActive && "docs-nav-item-active")}
              style={{ paddingLeft: `${(depth + (node.children.length > 0 || depth > 0 ? 1 : 0)) * 12 + 8}px` }}
            >
              <FileText className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{basename(file.name)}</span>
            </button>
          );
        })}
      </div>
    );
  };

  const sidebarContent = (
    <nav className="space-y-4">
      {/* Search */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search docs..."
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

      {/* Tree */}
      {listLoading ? (
        <p className="px-2 py-4 text-sm text-muted-foreground">Loading docs...</p>
      ) : files.length === 0 ? (
        <p className="px-2 py-4 text-sm text-muted-foreground">No markdown files found.</p>
      ) : tree.length === 0 ? (
        <p className="px-2 py-4 text-sm text-muted-foreground">No results for &ldquo;{searchQuery}&rdquo;</p>
      ) : (
        groupedTree.map(({ group, sections }) => (
          <div key={group} className="space-y-2 rounded-xl border border-border/50 bg-muted/[0.15] p-1.5">
            <button
              type="button"
              onClick={() => toggleGroup(group)}
              className={cn(
                "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-muted/40",
                activeGroup === group && "bg-background/80",
              )}
            >
              {collapsedGroups.has(group) && searchQuery.length === 0 ? (
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              )}
              <span className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                {getGroupLabel(group)}
              </span>
            </button>

            {!(searchQuery.length === 0 && collapsedGroups.has(group)) && (
              <div className="space-y-1 pb-1">
                {sections.map(({ section, root }) => {
                  const sectionKey = getSectionKey(group, section);
                  const sectionCollapsed = searchQuery.length === 0 && collapsedSections.has(sectionKey);
                  const isActiveSection = selectedFile?.section === section;
                  return (
                    <div key={section} className="space-y-1">
                      <button
                        type="button"
                        onClick={() => toggleSection(group, section)}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-muted/40",
                          isActiveSection && "bg-background/80",
                        )}
                      >
                        {sectionCollapsed ? (
                          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        )}
                        {sectionCollapsed ? (
                          <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        ) : (
                          <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        )}
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">
                          {getSectionLabel(section)}
                        </span>
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          {countNodeFiles(root)}
                        </span>
                      </button>

                      {!sectionCollapsed && (
                        <div className="ml-4 border-l border-border/50 pl-2">
                          {renderNode(root, 0)}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))
      )}
    </nav>
  );

  /* ── TOC component ── */
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

  /* ── error state ── */
  if (listError) {
    return (
      <div className="space-y-4">
        <DocsHeader />
        <Card className="border-destructive/40 bg-destructive/5">
          <CardHeader>
            <CardTitle className="text-base">Docs unavailable</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">{listError}</CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <DocsHeader />

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
        {selectedFile && (
          <span className="truncate text-sm text-muted-foreground">{selectedFile.name}</span>
        )}
      </div>

      {/* Mobile sidebar overlay */}
      {mobileSidebarOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={() => setMobileSidebarOpen(false)} />
          <div className="fixed inset-y-0 left-0 z-50 w-80 max-w-[calc(100vw-3rem)] overflow-y-auto border-r bg-background shadow-lg">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <span className="text-sm font-semibold">Documentation</span>
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
      <div className="md:grid md:grid-cols-[16rem_minmax(0,1fr)] md:gap-6 xl:grid-cols-[16rem_minmax(0,1fr)_11rem] xl:gap-10">
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

          {/* Breadcrumbs */}
          {breadcrumbs.length > 0 && (
            <nav className="mb-3 flex items-center gap-1 overflow-x-auto text-sm">
              {breadcrumbs.map((segment, i) => (
                <React.Fragment key={i}>
                  {i > 0 && <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />}
                  <span
                    className={cn(
                      "shrink-0",
                      i === breadcrumbs.length - 1
                        ? "font-medium text-foreground"
                        : "text-muted-foreground",
                    )}
                  >
                    {segment}
                  </span>
                </React.Fragment>
              ))}
            </nav>
          )}

          {/* Document title + metadata */}
          {selectedFile && (
            <div className="mb-6 space-y-2 border-b border-border/50 pb-4">
              <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
                {basename(selectedFile.name)}
              </h1>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{getSectionLabel(selectedFile.section)}</Badge>
                <span className="text-xs text-muted-foreground">{selectedFile.path}</span>
              </div>
            </div>
          )}

          {/* Content */}
          <div ref={contentRef}>
            {contentLoading ? (
              <p className="py-8 text-sm text-muted-foreground">Loading content...</p>
            ) : contentError ? (
              <p className="py-8 text-sm text-muted-foreground">{contentError}</p>
            ) : !content.trim() ? (
              <p className="py-8 text-sm text-muted-foreground">No content available.</p>
            ) : (
              <article className="docs-prose pb-16">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                  {content}
                </ReactMarkdown>
              </article>
            )}
          </div>
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

/* ── small sub-components ── */

function DocsHeader() {
  return (
    <div className="space-y-1">
      <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
        Docs Library
      </p>
      <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Documentation</h1>
      <p className="text-sm text-muted-foreground">
        Browse markdown documentation grouped by repo ownership across cortana-external and OpenClaw.
      </p>
    </div>
  );
}
