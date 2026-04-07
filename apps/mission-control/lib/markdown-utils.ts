import * as React from "react";

export type Heading = {
  id: string;
  text: string;
  level: number;
};

/**
 * Parse markdown source and return an array of headings with slugified ids.
 * Duplicate ids are suffixed with `-2`, `-3`, etc.
 */
export function extractHeadings(markdown: string): Heading[] {
  const headingRegex = /^(#{1,6})\s+(.+)$/gm;
  const headings: Heading[] = [];
  const usedIds = new Set<string>();
  let match: RegExpExecArray | null;

  while ((match = headingRegex.exec(markdown)) !== null) {
    const level = match[1].length;
    const text = match[2]
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/`(.+?)`/g, "$1")
      .replace(/\[(.+?)\]\(.+?\)/g, "$1")
      .trim();
    let id = text
      .toLowerCase()
      .replace(/[^\w\s-]/g, "")
      .replace(/\s+/g, "-");

    if (usedIds.has(id)) {
      let n = 2;
      while (usedIds.has(`${id}-${n}`)) n++;
      id = `${id}-${n}`;
    }
    usedIds.add(id);

    headings.push({ id, text, level });
  }

  return headings;
}

/**
 * Recursively extract the text content from a React node tree.
 */
export function getTextContent(children: React.ReactNode): string {
  if (typeof children === "string") return children;
  if (typeof children === "number") return String(children);
  if (!children) return "";
  if (Array.isArray(children)) return children.map(getTextContent).join("");
  if (React.isValidElement(children)) {
    return getTextContent((children.props as { children?: React.ReactNode }).children);
  }
  return "";
}

/**
 * Convert text to a URL-safe slug.
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-");
}
