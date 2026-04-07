import * as React from "react";
import { describe, expect, it } from "vitest";
import { extractHeadings, getTextContent, slugify } from "@/lib/markdown-utils";

describe("lib/markdown-utils", () => {
  describe("extractHeadings", () => {
    it("parses h1-h3 headings with correct ids and levels", () => {
      const md = [
        "# Introduction",
        "Some text here.",
        "## Getting Started",
        "More text.",
        "### Installation",
      ].join("\n");

      const headings = extractHeadings(md);

      expect(headings).toEqual([
        { id: "introduction", text: "Introduction", level: 1 },
        { id: "getting-started", text: "Getting Started", level: 2 },
        { id: "installation", text: "Installation", level: 3 },
      ]);
    });

    it("strips bold, code, and link markdown from heading text", () => {
      const md = [
        "## **Bold heading**",
        "## `Code heading`",
        "## [Link heading](http://example.com)",
      ].join("\n");

      const headings = extractHeadings(md);

      expect(headings).toEqual([
        { id: "bold-heading", text: "Bold heading", level: 2 },
        { id: "code-heading", text: "Code heading", level: 2 },
        { id: "link-heading", text: "Link heading", level: 2 },
      ]);
    });

    it("generates unique suffixed ids for duplicate headings", () => {
      const md = [
        "## Overview",
        "## Details",
        "## Overview",
        "## Overview",
      ].join("\n");

      const headings = extractHeadings(md);

      expect(headings).toEqual([
        { id: "overview", text: "Overview", level: 2 },
        { id: "details", text: "Details", level: 2 },
        { id: "overview-2", text: "Overview", level: 2 },
        { id: "overview-3", text: "Overview", level: 2 },
      ]);
    });

    it("returns empty array for markdown with no headings", () => {
      expect(extractHeadings("Just some text.\nAnother line.")).toEqual([]);
    });
  });

  describe("slugify", () => {
    it("converts normal text to lowercase hyphenated slug", () => {
      expect(slugify("Hello World")).toBe("hello-world");
    });

    it("removes special characters", () => {
      expect(slugify("What's new? (v2.0)")).toBe("whats-new-v20");
    });

    it("collapses multiple spaces into single hyphens", () => {
      expect(slugify("too   many   spaces")).toBe("too-many-spaces");
    });

    it("handles already-slugified text", () => {
      expect(slugify("already-a-slug")).toBe("already-a-slug");
    });

    it("handles empty string", () => {
      expect(slugify("")).toBe("");
    });
  });

  describe("getTextContent", () => {
    it("returns strings as-is", () => {
      expect(getTextContent("hello")).toBe("hello");
    });

    it("converts numbers to strings", () => {
      expect(getTextContent(42)).toBe("42");
    });

    it("returns empty string for null/undefined", () => {
      expect(getTextContent(null)).toBe("");
      expect(getTextContent(undefined)).toBe("");
    });

    it("joins arrays of text children", () => {
      expect(getTextContent(["hello", " ", "world"])).toBe("hello world");
    });

    it("extracts text from React elements", () => {
      const element = React.createElement("span", null, "nested text");
      expect(getTextContent(element)).toBe("nested text");
    });

    it("handles deeply nested React elements", () => {
      const element = React.createElement(
        "div",
        null,
        React.createElement("span", null, "deep"),
        " ",
        "text",
      );
      expect(getTextContent(element)).toBe("deep text");
    });
  });
});
