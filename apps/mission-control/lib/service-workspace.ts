import fs from "node:fs";
import path from "node:path";

import {
  parseEnvFileContent,
  readEnvFile,
  updateEnvContent,
  writeEnvFileAtomically,
} from "@/lib/workspace-io";
import type { ParsedEnv } from "@/lib/workspace-io";

import { getAllHealthItems } from "@/lib/workspace-health";
import type { WorkspaceHealthItem, WorkspaceHealthTone } from "@/lib/workspace-health";

import {
  WORKSPACE_FILES,
  WORKSPACE_SECTIONS,
  WORKSPACE_FIELDS,
  WORKSPACE_FIELD_LOOKUP,
} from "@/lib/workspace-fields";
import type { WorkspaceFieldDefinition } from "@/lib/workspace-fields";

/* ── re-exports for backward compatibility ── */

export { parseEnvFileContent, updateEnvContent, writeEnvFileAtomically } from "@/lib/workspace-io";
export type { WorkspaceHealthItem, WorkspaceHealthTone } from "@/lib/workspace-health";

/* ── types ── */

export type WorkspaceFileId = "external" | "missionControl";
export type WorkspaceFieldInput = "text" | "secret" | "textarea" | "select";

export type WorkspaceFieldOption = {
  label: string;
  value: string;
};

export type WorkspaceField = {
  key: string;
  label: string;
  help: string;
  fileId: WorkspaceFileId;
  input: WorkspaceFieldInput;
  currentValue: string;
  hasValue: boolean;
  defaultValue: string | null;
  usesDefault: boolean;
  placeholder?: string;
  secretPreview?: string;
  options?: WorkspaceFieldOption[];
};

export type WorkspaceSection = {
  id: string;
  label: string;
  description: string;
  fileId: WorkspaceFileId;
  fields: WorkspaceField[];
};

export type WorkspaceEnvFile = {
  id: WorkspaceFileId;
  label: string;
  path: string;
  exists: boolean;
  modeledKeys: number;
  extraKeys: string[];
};

export type WorkspaceData = {
  generatedAt: string;
  files: WorkspaceEnvFile[];
  sections: WorkspaceSection[];
  health: WorkspaceHealthItem[];
  openclawDocsPath: string;
};

type FieldChange = {
  fileId: WorkspaceFileId;
  key: string;
  value: string | null;
};

type WorkspaceOptions = {
  rootDir?: string;
};

export class ServicesWorkspaceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServicesWorkspaceValidationError";
  }
}

/* ── helpers ── */

export function findWorkspaceRoot(start = process.cwd()): string {
  let current = path.resolve(start);

  while (true) {
    if (fs.existsSync(path.join(current, ".git"))) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return path.resolve(start, "..", "..");
    }
    current = parent;
  }
}

function getFilePath(root: string, fileId: WorkspaceFileId): string {
  return path.join(root, WORKSPACE_FILES[fileId].relativePath);
}

function maskSecretPreview(value: string): string {
  if (!value) return "Not configured";
  if (value.length <= 4) return "Configured";
  return `${value.slice(0, 2)}••••${value.slice(-2)}`;
}

function readTrimmedValue(values: Record<string, string>, key: string): string {
  return (values[key] ?? "").trim();
}

function buildField(definition: WorkspaceFieldDefinition, env: ParsedEnv): WorkspaceField {
  const rawValue = readTrimmedValue(env.values, definition.key);
  const hasValue = rawValue.length > 0;
  const usesDefault = !hasValue && Boolean(definition.defaultValue);

  return {
    key: definition.key,
    label: definition.label,
    help: definition.help,
    fileId: definition.fileId,
    input: definition.input ?? "text",
    currentValue: definition.input === "secret" ? "" : rawValue,
    hasValue,
    defaultValue: definition.defaultValue ?? null,
    usesDefault,
    placeholder: definition.placeholder,
    secretPreview: definition.input === "secret" ? maskSecretPreview(rawValue) : undefined,
    options: definition.options,
  };
}

function createEnvFiles(root: string) {
  const parsed = {
    external: readEnvFile(getFilePath(root, "external")),
    missionControl: readEnvFile(getFilePath(root, "missionControl")),
  } satisfies Record<WorkspaceFileId, ParsedEnv>;

  const modeledKeysByFile = {
    external: new Set(WORKSPACE_FIELDS.filter((field) => field.fileId === "external").map((field) => field.key)),
    missionControl: new Set(
      WORKSPACE_FIELDS.filter((field) => field.fileId === "missionControl").map((field) => field.key),
    ),
  } satisfies Record<WorkspaceFileId, Set<string>>;

  const files: WorkspaceEnvFile[] = (Object.keys(WORKSPACE_FILES) as WorkspaceFileId[]).map((fileId) => {
    const env = parsed[fileId];
    return {
      id: fileId,
      label: WORKSPACE_FILES[fileId].label,
      path: env.path,
      exists: env.exists,
      modeledKeys: [...modeledKeysByFile[fileId]].length,
      extraKeys: Object.keys(env.values)
        .filter((key) => !modeledKeysByFile[fileId].has(key))
        .sort((a, b) => a.localeCompare(b)),
    };
  });

  return { parsed, files };
}

/* ── main orchestration ── */

export async function getServicesWorkspaceData(options: WorkspaceOptions = {}): Promise<WorkspaceData> {
  const root = options.rootDir ? path.resolve(options.rootDir) : findWorkspaceRoot();
  const { parsed, files } = createEnvFiles(root);
  const externalPort = readTrimmedValue(parsed.external.values, "PORT") || "3033";
  const baseUrl = `http://127.0.0.1:${externalPort}`;
  const sections = WORKSPACE_SECTIONS.map((section) => {
    const env = parsed[section.fileId];
    return {
      ...section,
      fields: WORKSPACE_FIELDS.filter((field) => field.sectionId === section.id).map((field) =>
        buildField(field, env),
      ),
    };
  });

  const health = await getAllHealthItems(baseUrl);

  return {
    generatedAt: new Date().toISOString(),
    files,
    sections,
    health,
    openclawDocsPath: path.join(root, "docs", "source", "architecture", "mission-control.md"),
  };
}

function normalizeIncomingValue(value: string | null): string | null {
  if (value == null) return null;
  const normalized = value.replace(/\r\n/g, "\n").trim();
  return normalized.length > 0 ? normalized : null;
}

export async function updateServicesWorkspaceData(
  changes: FieldChange[],
  options: WorkspaceOptions = {},
): Promise<WorkspaceData> {
  const root = options.rootDir ? path.resolve(options.rootDir) : findWorkspaceRoot();
  const grouped = new Map<WorkspaceFileId, FieldChange[]>();

  for (const change of changes) {
    const definition = WORKSPACE_FIELD_LOOKUP.get(`${change.fileId}:${change.key}`);
    if (!definition) {
      throw new ServicesWorkspaceValidationError(
        `Unknown workspace field: ${change.fileId}:${change.key}`,
      );
    }

    const next = grouped.get(change.fileId) ?? [];
    next.push({
      ...change,
      value: normalizeIncomingValue(change.value),
    });
    grouped.set(change.fileId, next);
  }

  for (const [fileId, fileChanges] of grouped) {
    const filePath = getFilePath(root, fileId);
    const exists = fs.existsSync(filePath);
    let content = exists ? fs.readFileSync(filePath, "utf8") : "";

    for (const change of fileChanges) {
      content = updateEnvContent(content, change.key, change.value);
    }

    writeEnvFileAtomically(filePath, content);
  }

  return getServicesWorkspaceData({ rootDir: root });
}
