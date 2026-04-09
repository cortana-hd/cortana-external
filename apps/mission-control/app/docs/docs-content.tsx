"use client";

import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChevronRight, Hash } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { getTextContent, slugify } from "@/lib/markdown-utils";
import { CodeBlock } from "@/components/docs/code-block";
import type { DocFile } from "./docs-types";
import { getSectionLabel, basename } from "./docs-tree-utils";

type DocsContentProps = {
  selectedFile: DocFile | null;
  files: DocFile[];
  content: string;
  contentLoading: boolean;
  contentError: string | null;
  breadcrumbs: string[];
  contentRef: React.RefObject<HTMLDivElement | null>;
  onNavigate: (id: string) => void;
};

const DOC_ROOT_PREFIXES = [
  "docs",
  "knowledge",
  "research",
  "cortical-loop",
  "hooks",
  "immune-system",
  "proprioception",
  "sae",
  "backtester",
  "apps",
  "external-service",
  "cortana",
  "cortana-external",
] as const;

function resolveDocHref(currentName: string | null, href: string, files: DocFile[]): DocFile | null {
  const exactPath = files.find((f) => f.path === href);
  if (exactPath) return exactPath;

  const currentDir = currentName ? currentName.split("/").slice(0, -1).join("/") : "";
  const parts = [...(currentDir ? currentDir.split("/") : []), ...href.split("/")];
  const resolved: string[] = [];

  for (const part of parts) {
    if (part === "..") resolved.pop();
    else if (part !== "." && part !== "") resolved.push(part);
  }

  const targetPath = resolved.join("/");
  const candidates = new Set<string>([targetPath]);

  for (const prefix of DOC_ROOT_PREFIXES) {
    const marker = `${prefix}/`;
    if (targetPath.startsWith(marker)) {
      candidates.add(targetPath.slice(marker.length));
    }
  }

  for (const candidate of candidates) {
    const exact = files.find((f) => f.name === candidate);
    if (exact) return exact;
  }

  for (const candidate of candidates) {
    const suffix = files.find((f) => f.name.endsWith(`/${candidate}`));
    if (suffix) return suffix;
  }

  return null;
}

export function DocsContent({
  selectedFile,
  files,
  content,
  contentLoading,
  contentError,
  breadcrumbs,
  contentRef,
  onNavigate,
}: DocsContentProps) {
  const markdownComponents = React.useMemo(() => {
    const make = (Tag: "h1" | "h2" | "h3" | "h4" | "h5" | "h6") => {
      const Comp = ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => {
        const text = getTextContent(children);
        const id = slugify(text);
        return (
          <Tag id={id} className="group relative" {...props}>
            {children}
            <a href={`#${id}`} className="docs-heading-anchor" aria-label="Link to this section">
              <Hash className="h-4 w-4" />
            </a>
          </Tag>
        );
      };
      Comp.displayName = Tag;
      return Comp;
    };

    const DocPre = ({ children, ...props }: React.HTMLAttributes<HTMLPreElement>) => {
      if (React.isValidElement(children)) {
        const childProps = children.props as { className?: string; children?: React.ReactNode };
        const className = childProps.className ?? "";
        const lang = className.replace(/^language-/, "") || null;
        const text = getTextContent(childProps.children);
        return <CodeBlock code={text} language={lang} />;
      }
      return <pre {...props}>{children}</pre>;
    };
    DocPre.displayName = "DocPre";

    const DocLink = ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => {
      if (href && !href.startsWith("http") && !href.startsWith("#") && href.endsWith(".md")) {
        return (
          <a
            {...props}
            href={href}
            onClick={(e) => {
              e.preventDefault();
              const match = resolveDocHref(selectedFile?.name ?? null, href, files);
              if (match) {
                onNavigate(match.id);
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
      pre: DocPre,
    };
  }, [selectedFile, files, onNavigate]);

  return (
    <>
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
    </>
  );
}
