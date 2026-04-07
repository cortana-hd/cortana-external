import fs from "node:fs";
import path from "node:path";

export type EnvAssignmentLine = {
  leading: string;
  exportPrefix: string;
  key: string;
  separator: string;
  valueSource: string;
  trailingComment: string;
};

export type ParsedEnv = {
  path: string;
  exists: boolean;
  values: Record<string, string>;
};

function splitEnvValueComment(rawValue: string): { valueSource: string; trailingComment: string } {
  const leadingTrimmed = rawValue.trimStart();

  if (leadingTrimmed.startsWith('"') || leadingTrimmed.startsWith("'")) {
    const quote = leadingTrimmed[0];
    let escaped = false;

    for (let index = 1; index < leadingTrimmed.length; index += 1) {
      const char = leadingTrimmed[index];

      if (quote === '"' && char === "\\" && !escaped) {
        escaped = true;
        continue;
      }

      if (char === quote && !escaped) {
        const closingIndex = index + 1;
        return {
          valueSource: rawValue.slice(0, rawValue.length - leadingTrimmed.length + closingIndex),
          trailingComment: leadingTrimmed.slice(closingIndex),
        };
      }

      escaped = false;
    }
  }

  const commentMatch = rawValue.match(/^([\s\S]*?)(\s+#.*)$/);
  if (!commentMatch) {
    return { valueSource: rawValue, trailingComment: "" };
  }

  return {
    valueSource: commentMatch[1] ?? rawValue,
    trailingComment: commentMatch[2] ?? "",
  };
}

export function parseEnvAssignmentLine(rawLine: string): EnvAssignmentLine | null {
  const match = rawLine.match(/^(\s*)(export\s+)?([A-Za-z_][A-Za-z0-9_]*)(\s*=\s*)(.*)$/);
  if (!match) return null;

  const [, leading = "", exportPrefix = "", key = "", separator = "=", rawValue = ""] = match;
  const { valueSource, trailingComment } = splitEnvValueComment(rawValue);

  return {
    leading,
    exportPrefix,
    key,
    separator,
    valueSource,
    trailingComment,
  };
}

function parseEnvValue(valueSource: string): string {
  const value = valueSource.trim();

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    if (value.startsWith('"')) {
      try {
        const parsed = JSON.parse(value) as unknown;
        return typeof parsed === "string" ? parsed : String(parsed);
      } catch {
        return value.slice(1, -1);
      }
    }

    return value.slice(1, -1);
  }

  return value;
}

export function parseEnvFileContent(content: string): Record<string, string> {
  const values: Record<string, string> = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const assignment = parseEnvAssignmentLine(rawLine);
    if (!assignment) continue;

    const value = parseEnvValue(assignment.valueSource);
    if (value.length > 0 || assignment.valueSource.trim() === '""' || assignment.valueSource.trim() === "''") {
      values[assignment.key] = value;
      continue;
    }

    values[assignment.key] = value;
  }

  return values;
}

export function readEnvFile(filePath: string): ParsedEnv {
  if (!fs.existsSync(filePath)) {
    return {
      path: filePath,
      exists: false,
      values: {},
    };
  }

  const content = fs.readFileSync(filePath, "utf8");
  return {
    path: filePath,
    exists: true,
    values: parseEnvFileContent(content),
  };
}

function serializeEnvValue(value: string): string {
  if (value === "") {
    return '""';
  }

  if (/^[A-Za-z0-9_./:@%+=,\-]+$/.test(value)) {
    return value;
  }

  return JSON.stringify(value);
}

export function updateEnvContent(content: string, key: string, value: string | null): string {
  const lines = content.length > 0 ? content.split(/\r?\n/) : [];
  const nextLines: string[] = [];
  let wroteReplacement = false;

  for (const line of lines) {
    const assignment = parseEnvAssignmentLine(line);

    if (!assignment || assignment.key !== key) {
      nextLines.push(line);
      continue;
    }

    if (!wroteReplacement && value != null) {
      nextLines.push(
        `${assignment.leading}${assignment.exportPrefix}${key}${assignment.separator}${serializeEnvValue(value)}${assignment.trailingComment}`,
      );
      wroteReplacement = true;
    }
  }

  if (!wroteReplacement && value != null) {
    if (nextLines.length > 0 && nextLines[nextLines.length - 1]?.trim() !== "") {
      nextLines.push("");
    }
    nextLines.push(`${key}=${serializeEnvValue(value)}`);
  }

  const normalized = nextLines.join("\n").replace(/\n{3,}/g, "\n\n");
  return normalized.endsWith("\n") ? normalized : `${normalized}\n`;
}

export function writeEnvFileAtomically(filePath: string, content: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;

  try {
    fs.writeFileSync(tempPath, content, "utf8");
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
    throw error;
  }
}
