"use client";

import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type DocFile = { id: string; name: string; path: string; section: string };

type DocsListResponse =
  | { status: "ok"; files: DocFile[] }
  | { status: "error"; message: string };

type DocContentResponse =
  | { status: "ok"; name: string; content: string }
  | { status: "error"; message: string };

export default function DocsClient() {
  const [files, setFiles] = React.useState<DocFile[]>([]);
  const [selectedFileId, setSelectedFileId] = React.useState<string | null>(null);
  const [content, setContent] = React.useState<string>("");
  const [mobileBrowseOpen, setMobileBrowseOpen] = React.useState(false);
  const [listLoading, setListLoading] = React.useState(true);
  const [contentLoading, setContentLoading] = React.useState(false);
  const [listError, setListError] = React.useState<string | null>(null);
  const [contentError, setContentError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;

    const loadList = async () => {
      try {
        setListLoading(true);
        const response = await fetch("/api/docs", { cache: "no-store" });
        const payload = (await response.json()) as DocsListResponse;
        if (!response.ok || payload.status !== "ok") {
          const message =
            payload.status === "error" ? payload.message : "Failed to load docs.";
          throw new Error(message);
        }

        if (active) {
          setFiles(payload.files);
          setSelectedFileId(payload.files[0]?.id ?? null);
          setMobileBrowseOpen(false);
          setListError(null);
        }
      } catch (error) {
        if (active) {
          setListError(error instanceof Error ? error.message : "Failed to load docs.");
        }
      } finally {
        if (active) setListLoading(false);
      }
    };

    void loadList();

    return () => {
      active = false;
    };
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
        const response = await fetch(`/api/docs?file=${encodeURIComponent(selectedFileId)}`, {
          cache: "no-store",
        });
        const payload = (await response.json()) as DocContentResponse;
        if (!response.ok || payload.status !== "ok") {
          const message =
            payload.status === "error" ? payload.message : "Failed to load doc.";
          throw new Error(message);
        }

        if (active) {
          setContent(payload.content);
          setContentError(null);
        }
      } catch (error) {
        if (active) {
          setContentError(error instanceof Error ? error.message : "Failed to load doc.");
        }
      } finally {
        if (active) setContentLoading(false);
      }
    };

    void loadDoc();

    return () => {
      active = false;
    };
  }, [selectedFileId]);

  const selectedFile = React.useMemo(
    () => files.find((file) => file.id === selectedFileId) ?? null,
    [files, selectedFileId]
  );

  const filesBySection = React.useMemo(() => {
    return files.reduce<Record<string, DocFile[]>>((acc, file) => {
      acc[file.section] ||= [];
      acc[file.section].push(file);
      return acc;
    }, {});
  }, [files]);

  const sections = React.useMemo(
    () =>
      Object.entries(filesBySection).map(([section, sectionFiles]) => ({
        section,
        files: sectionFiles,
      })),
    [filesBySection]
  );

  const renderFileList = (options?: { compact?: boolean; onSelect?: () => void }) => (
    <div className={cn("space-y-3", options?.compact && "space-y-2")}>
      {listLoading ? (
        <p className="px-2 py-4 text-sm text-muted-foreground">Loading docs...</p>
      ) : files.length === 0 ? (
        <p className="px-2 py-4 text-sm text-muted-foreground">No markdown files found.</p>
      ) : (
        sections.map(({ section, files: sectionFiles }) => (
          <div key={section} className="space-y-1.5">
            <div className="flex items-center justify-between gap-2 px-2 pt-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                {section}
              </p>
              <Badge variant="outline" className="text-[10px]">
                {sectionFiles.length}
              </Badge>
            </div>
            <div className="space-y-1">
              {sectionFiles.map((file) => {
                const isActive = file.id === selectedFileId;
                return (
                  <button
                    key={file.id}
                    type="button"
                    onClick={() => {
                      setSelectedFileId(file.id);
                      options?.onSelect?.();
                    }}
                    aria-pressed={isActive}
                    className={cn(
                      "flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left text-sm transition-colors",
                      isActive
                        ? "border-primary/30 bg-primary/10 text-foreground"
                        : "border-transparent text-muted-foreground hover:border-border hover:bg-muted/30"
                    )}
                  >
                    <span className="min-w-0 truncate font-medium text-foreground">{file.name}</span>
                    {isActive ? <span className="text-[10px] uppercase tracking-wide text-primary">Open</span> : null}
                  </button>
                );
              })}
            </div>
          </div>
        ))
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
          Docs Library
        </p>
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Docs</h1>
        <p className="text-sm text-muted-foreground">
          Browse markdown documentation from the external repo, backtester, and OpenClaw knowledge bases.
        </p>
      </div>

      {listError ? (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardHeader>
            <CardTitle className="text-base">Docs unavailable</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">{listError}</CardContent>
        </Card>
      ) : (
        <div className="space-y-4 md:grid md:grid-cols-[260px_minmax(0,1fr)] md:items-start md:gap-6 md:space-y-0">
          <Card className="overflow-hidden md:hidden">
            <CardHeader className="border-b">
              <CardTitle className="flex items-center justify-between gap-3 text-base">
                <div className="min-w-0">
                  <span>Browse docs</span>
                  <p className="mt-1 truncate text-xs font-normal text-muted-foreground">
                    {selectedFile?.section ?? "Choose a section"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{files.length}</Badge>
                  <button
                    type="button"
                    onClick={() => setMobileBrowseOpen((open) => !open)}
                    aria-controls="mobile-docs-library"
                    aria-expanded={mobileBrowseOpen}
                    className="rounded-md border px-2 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted/40"
                  >
                    {mobileBrowseOpen ? "Hide" : "Browse"}
                  </button>
                </div>
              </CardTitle>
            </CardHeader>
            {mobileBrowseOpen ? (
              <CardContent id="mobile-docs-library" className="space-y-4 px-3 py-3">
                {renderFileList({
                  compact: true,
                  onSelect: () => setMobileBrowseOpen(false),
                })}
              </CardContent>
            ) : null}
          </Card>

          <div className="hidden md:block md:sticky md:top-8">
            <Card className="overflow-hidden">
              <CardHeader className="border-b">
                <CardTitle className="flex items-center justify-between text-base">
                  Library
                  <Badge variant="secondary">{files.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 px-3 py-4">
                {renderFileList()}
              </CardContent>
            </Card>
          </div>

          <Card className="overflow-hidden">
            <CardHeader className="border-b">
              <CardTitle className="flex flex-wrap items-center justify-between gap-3 text-base">
                <span>{selectedFile?.name ?? "Documentation"}</span>
                {selectedFile ? <Badge variant="outline">{selectedFile.section}</Badge> : null}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {contentLoading ? (
                <p className="text-sm text-muted-foreground">Loading content...</p>
              ) : contentError ? (
                <p className="text-sm text-muted-foreground">{contentError}</p>
              ) : !content.trim() ? (
                <p className="text-sm text-muted-foreground">No content available.</p>
              ) : (
                <div className="prose prose-slate max-w-none dark:prose-invert prose-headings:text-foreground prose-p:text-muted-foreground prose-a:text-primary prose-strong:text-foreground prose-code:text-foreground prose-pre:bg-muted/40">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
