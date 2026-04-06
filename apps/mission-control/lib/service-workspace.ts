import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export type WorkspaceFileId = "external" | "missionControl";
export type WorkspaceFieldInput = "text" | "secret" | "textarea" | "select";
export type WorkspaceHealthTone = "healthy" | "degraded" | "unhealthy" | "unknown";

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

export type WorkspaceHealthItem = {
  id: string;
  label: string;
  tone: WorkspaceHealthTone;
  summary: string;
  detail: string;
  checkedAt: string;
  raw: unknown;
};

export type WorkspaceData = {
  generatedAt: string;
  files: WorkspaceEnvFile[];
  sections: WorkspaceSection[];
  health: WorkspaceHealthItem[];
  openclawDocsPath: string;
};

type WorkspaceFieldDefinition = {
  key: string;
  label: string;
  help: string;
  fileId: WorkspaceFileId;
  sectionId: string;
  input?: WorkspaceFieldInput;
  defaultValue?: string;
  placeholder?: string;
  options?: WorkspaceFieldOption[];
};

type ParsedEnv = {
  path: string;
  exists: boolean;
  values: Record<string, string>;
};

type FieldChange = {
  fileId: WorkspaceFileId;
  key: string;
  value: string | null;
};

type WorkspaceOptions = {
  rootDir?: string;
};

type EnvAssignmentLine = {
  leading: string;
  exportPrefix: string;
  key: string;
  separator: string;
  valueSource: string;
  trailingComment: string;
};

export class ServicesWorkspaceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServicesWorkspaceValidationError";
  }
}

const WORKSPACE_FILES: Record<WorkspaceFileId, { label: string; relativePath: string }> = {
  external: { label: "External Service", relativePath: ".env" },
  missionControl: { label: "Mission Control", relativePath: path.join("apps", "mission-control", ".env.local") },
};

const WORKSPACE_SECTIONS: Array<Pick<WorkspaceSection, "id" | "label" | "description" | "fileId">> = [
  {
    id: "openclaw-bridge",
    label: "OpenClaw Bridge",
    description: "Mission Control runtime, data sources, and the OpenClaw lifecycle bridge.",
    fileId: "missionControl",
  },
  {
    id: "service-runtime",
    label: "Service Runtime",
    description: "Network, TLS, cache, and external-service runtime settings.",
    fileId: "external",
  },
  {
    id: "market-data",
    label: "Market Data",
    description: "Universe sources, Schwab streamer policy, and broker-facing controls.",
    fileId: "external",
  },
  {
    id: "recovery-stack",
    label: "Recovery Stack",
    description: "Whoop, Tonal, and market-data provider credentials and storage.",
    fileId: "external",
  },
  {
    id: "alpaca-execution",
    label: "Alpaca Execution",
    description: "Alpaca keys, environment targeting, and execution-side routing.",
    fileId: "external",
  },
];

const WORKSPACE_FIELDS: WorkspaceFieldDefinition[] = [
  {
    key: "DATABASE_URL",
    label: "Mission Control database URL",
    help: "Primary Prisma/Postgres connection for Mission Control.",
    fileId: "missionControl",
    sectionId: "openclaw-bridge",
    input: "textarea",
    placeholder: "postgres://localhost:5432/mission_control?sslmode=disable",
  },
  {
    key: "CORTANA_DATABASE_URL",
    label: "Cortana source database URL",
    help: "Optional read source for task-board and governance tables.",
    fileId: "missionControl",
    sectionId: "openclaw-bridge",
    input: "textarea",
    placeholder: "postgres://localhost:5432/cortana?sslmode=disable",
  },
  {
    key: "DOCS_PATH",
    label: "Docs path",
    help: "Override the docs library source loaded in Mission Control.",
    fileId: "missionControl",
    sectionId: "openclaw-bridge",
    input: "text",
    placeholder: "/Users/hd/Developer/cortana/docs",
  },
  {
    key: "AGENT_MODELS_PATH",
    label: "Agent models path",
    help: "Maps agent ids to preferred OpenClaw model labels.",
    fileId: "missionControl",
    sectionId: "openclaw-bridge",
    input: "text",
    placeholder: "/Users/hd/Developer/cortana/config/agent-models.json",
  },
  {
    key: "HEARTBEAT_STATE_PATH",
    label: "Heartbeat state path",
    help: "Location of the OpenClaw heartbeat state file Mission Control watches.",
    fileId: "missionControl",
    sectionId: "openclaw-bridge",
    input: "text",
    placeholder: "/Users/hd/.openclaw/memory/heartbeat-state.json",
  },
  {
    key: "OPENCLAW_EVENT_TOKEN",
    label: "OpenClaw event token",
    help: "Bearer token for sub-agent lifecycle ingestion into Mission Control.",
    fileId: "missionControl",
    sectionId: "openclaw-bridge",
    input: "secret",
    placeholder: "Optional bearer token",
  },
  {
    key: "TELEGRAM_BOT_TOKEN",
    label: "Telegram bot token",
    help: "Needed for approval and notification flows inside Mission Control.",
    fileId: "missionControl",
    sectionId: "openclaw-bridge",
    input: "secret",
    placeholder: "Bot token",
  },
  {
    key: "PORT",
    label: "External service port",
    help: "HTTP port for the local Hono external-service runtime.",
    fileId: "external",
    sectionId: "service-runtime",
    input: "text",
    defaultValue: "3033",
    placeholder: "3033",
  },
  {
    key: "EXTERNAL_SERVICE_TLS_PORT",
    label: "TLS port",
    help: "HTTPS callback and TLS listener port for OAuth flows.",
    fileId: "external",
    sectionId: "service-runtime",
    input: "text",
    defaultValue: "8182",
    placeholder: "8182",
  },
  {
    key: "EXTERNAL_SERVICE_TLS_CERT_PATH",
    label: "TLS certificate path",
    help: "Certificate file used for local TLS/OAuth callbacks.",
    fileId: "external",
    sectionId: "service-runtime",
    input: "text",
    placeholder: "/absolute/path/to/cert.pem",
  },
  {
    key: "EXTERNAL_SERVICE_TLS_KEY_PATH",
    label: "TLS key path",
    help: "Private key paired with the external-service TLS certificate.",
    fileId: "external",
    sectionId: "service-runtime",
    input: "text",
    placeholder: "/absolute/path/to/key.pem",
  },
  {
    key: "MARKET_DATA_CACHE_DIR",
    label: "Market-data cache directory",
    help: "Disk cache for universe snapshots and provider artifacts.",
    fileId: "external",
    sectionId: "service-runtime",
    input: "text",
    defaultValue: ".cache/market_data",
    placeholder: ".cache/market_data",
  },
  {
    key: "MARKET_DATA_REQUEST_TIMEOUT_MS",
    label: "Request timeout (ms)",
    help: "Default timeout applied to market-data upstream requests.",
    fileId: "external",
    sectionId: "service-runtime",
    input: "text",
    defaultValue: "30000",
    placeholder: "30000",
  },
  {
    key: "MARKET_DATA_UNIVERSE_SOURCE_LADDER",
    label: "Universe source ladder",
    help: "Ordered provider strategy used to assemble the trading universe.",
    fileId: "external",
    sectionId: "market-data",
    input: "text",
    defaultValue: "local_json",
    placeholder: "local_json",
  },
  {
    key: "MARKET_DATA_UNIVERSE_REMOTE_JSON_URL",
    label: "Remote universe JSON URL",
    help: "Optional remote universe source before falling back to local JSON.",
    fileId: "external",
    sectionId: "market-data",
    input: "text",
    placeholder: "https://example.com/universe.json",
  },
  {
    key: "MARKET_DATA_UNIVERSE_LOCAL_JSON_PATH",
    label: "Local universe JSON path",
    help: "Fallback local universe file used when remote sources fail.",
    fileId: "external",
    sectionId: "market-data",
    input: "text",
    defaultValue: "config/universe/sp500-constituents.json",
    placeholder: "config/universe/sp500-constituents.json",
  },
  {
    key: "SCHWAB_REDIRECT_URL",
    label: "Schwab redirect URL",
    help: "OAuth callback URL registered with the Schwab developer app.",
    fileId: "external",
    sectionId: "market-data",
    input: "text",
    defaultValue: "https://127.0.0.1:8182/auth/schwab/callback",
    placeholder: "https://127.0.0.1:8182/auth/schwab/callback",
  },
  {
    key: "SCHWAB_TOKEN_PATH",
    label: "Schwab token path",
    help: "Cached token file used for REST and streamer sessions.",
    fileId: "external",
    sectionId: "market-data",
    input: "text",
    defaultValue: ".cache/market_data/schwab-token.json",
    placeholder: ".cache/market_data/schwab-token.json",
  },
  {
    key: "SCHWAB_STREAMER_ROLE",
    label: "Schwab streamer role",
    help: "Leader/follower mode for the shared Schwab streamer session.",
    fileId: "external",
    sectionId: "market-data",
    input: "select",
    defaultValue: "leader",
    options: [
      { label: "Auto", value: "auto" },
      { label: "Leader", value: "leader" },
      { label: "Follower", value: "follower" },
      { label: "Disabled", value: "disabled" },
    ],
  },
  {
    key: "SCHWAB_STREAMER_SHARED_STATE_BACKEND",
    label: "Shared state backend",
    help: "Where shared streamer coordination state is stored.",
    fileId: "external",
    sectionId: "market-data",
    input: "select",
    defaultValue: "postgres",
    options: [
      { label: "Postgres", value: "postgres" },
      { label: "File", value: "file" },
    ],
  },
  {
    key: "SCHWAB_STREAMER_ENABLED",
    label: "Streamer enabled",
    help: "Turns the Schwab streamer on or off.",
    fileId: "external",
    sectionId: "market-data",
    input: "select",
    defaultValue: "1",
    options: [
      { label: "Enabled", value: "1" },
      { label: "Disabled", value: "0" },
    ],
  },
  {
    key: "SCHWAB_STREAMER_SYMBOL_SOFT_CAP",
    label: "Streamer symbol soft cap",
    help: "Soft ceiling for live symbol subscriptions before fallback behavior.",
    fileId: "external",
    sectionId: "market-data",
    input: "text",
    defaultValue: "250",
    placeholder: "250",
  },
  {
    key: "SCHWAB_STREAMER_CACHE_SOFT_CAP",
    label: "Streamer cache soft cap",
    help: "Recent quote cache retention target for streamer-backed symbols.",
    fileId: "external",
    sectionId: "market-data",
    input: "text",
    defaultValue: "500",
    placeholder: "500",
  },
  {
    key: "SCHWAB_USER_PREFERENCES_URL",
    label: "Schwab user preferences URL",
    help: "Optional override for Schwab user preferences endpoint.",
    fileId: "external",
    sectionId: "market-data",
    input: "text",
    placeholder: "https://api.schwabapi.com/trader/v1/userPreference",
  },
  {
    key: "SCHWAB_CLIENT_ID",
    label: "Schwab client id",
    help: "OAuth client id for Schwab REST and streamer access.",
    fileId: "external",
    sectionId: "recovery-stack",
    input: "text",
    placeholder: "Client id",
  },
  {
    key: "SCHWAB_CLIENT_SECRET",
    label: "Schwab client secret",
    help: "OAuth client secret for the Schwab developer app.",
    fileId: "external",
    sectionId: "recovery-stack",
    input: "secret",
    placeholder: "Client secret",
  },
  {
    key: "WHOOP_CLIENT_ID",
    label: "Whoop client id",
    help: "OAuth client id for the Whoop recovery integration.",
    fileId: "external",
    sectionId: "recovery-stack",
    input: "text",
    placeholder: "Client id",
  },
  {
    key: "WHOOP_CLIENT_SECRET",
    label: "Whoop client secret",
    help: "OAuth client secret used to refresh Whoop tokens.",
    fileId: "external",
    sectionId: "recovery-stack",
    input: "secret",
    placeholder: "Client secret",
  },
  {
    key: "WHOOP_REDIRECT_URL",
    label: "Whoop redirect URL",
    help: "Callback URL registered with the Whoop OAuth app.",
    fileId: "external",
    sectionId: "recovery-stack",
    input: "text",
    defaultValue: "http://localhost:3033/auth/callback",
    placeholder: "http://localhost:3033/auth/callback",
  },
  {
    key: "WHOOP_TOKEN_PATH",
    label: "Whoop token path",
    help: "Disk location for cached Whoop access and refresh tokens.",
    fileId: "external",
    sectionId: "recovery-stack",
    input: "text",
    defaultValue: "whoop_tokens.json",
    placeholder: "whoop_tokens.json",
  },
  {
    key: "WHOOP_DATA_PATH",
    label: "Whoop data cache path",
    help: "Cached Whoop recovery and sleep payloads.",
    fileId: "external",
    sectionId: "recovery-stack",
    input: "text",
    defaultValue: "whoop_data.json",
    placeholder: "whoop_data.json",
  },
  {
    key: "TONAL_EMAIL",
    label: "Tonal account email",
    help: "Email address used for Tonal authentication.",
    fileId: "external",
    sectionId: "recovery-stack",
    input: "text",
    placeholder: "name@example.com",
  },
  {
    key: "TONAL_PASSWORD",
    label: "Tonal account password",
    help: "Password used for Tonal token acquisition.",
    fileId: "external",
    sectionId: "recovery-stack",
    input: "secret",
    placeholder: "Password",
  },
  {
    key: "TONAL_TOKEN_PATH",
    label: "Tonal token path",
    help: "Cached Tonal token location on disk.",
    fileId: "external",
    sectionId: "recovery-stack",
    input: "text",
    defaultValue: "tonal_tokens.json",
    placeholder: "tonal_tokens.json",
  },
  {
    key: "TONAL_DATA_PATH",
    label: "Tonal data cache path",
    help: "Cached Tonal workout and profile data.",
    fileId: "external",
    sectionId: "recovery-stack",
    input: "text",
    defaultValue: "tonal_data.json",
    placeholder: "tonal_data.json",
  },
  {
    key: "COINMARKETCAP_API_KEY",
    label: "CoinMarketCap API key",
    help: "Crypto quote/history provider key used by the market-data chain.",
    fileId: "external",
    sectionId: "recovery-stack",
    input: "secret",
    placeholder: "API key",
  },
  {
    key: "COINMARKETCAP_API_BASE_URL",
    label: "CoinMarketCap base URL",
    help: "Optional override for the CoinMarketCap API host.",
    fileId: "external",
    sectionId: "recovery-stack",
    input: "text",
    defaultValue: "https://pro-api.coinmarketcap.com",
    placeholder: "https://pro-api.coinmarketcap.com",
  },
  {
    key: "FRED_API_KEY",
    label: "FRED API key",
    help: "Macro data key used by market-data support endpoints.",
    fileId: "external",
    sectionId: "recovery-stack",
    input: "secret",
    placeholder: "API key",
  },
  {
    key: "ALPACA_KEYS_PATH",
    label: "Alpaca keys path",
    help: "Optional JSON key file path if you do not want to use direct env keys.",
    fileId: "external",
    sectionId: "alpaca-execution",
    input: "text",
    placeholder: "/absolute/path/to/alpaca_keys.json",
  },
  {
    key: "ALPACA_KEY",
    label: "Alpaca key id",
    help: "Direct Alpaca key id if you are not using a JSON key file.",
    fileId: "external",
    sectionId: "alpaca-execution",
    input: "text",
    placeholder: "Key id",
  },
  {
    key: "ALPACA_SECRET_KEY",
    label: "Alpaca secret key",
    help: "Direct Alpaca secret for account and execution requests.",
    fileId: "external",
    sectionId: "alpaca-execution",
    input: "secret",
    placeholder: "Secret key",
  },
  {
    key: "ALPACA_ENDPOINT",
    label: "Alpaca endpoint",
    help: "Broker API base URL used when keys are supplied directly.",
    fileId: "external",
    sectionId: "alpaca-execution",
    input: "text",
    placeholder: "https://paper-api.alpaca.markets",
  },
  {
    key: "ALPACA_TARGET_ENVIRONMENT",
    label: "Alpaca target environment",
    help: "Target environment reported in Mission Control health surfaces.",
    fileId: "external",
    sectionId: "alpaca-execution",
    input: "select",
    defaultValue: "live",
    options: [
      { label: "Live", value: "live" },
      { label: "Paper", value: "paper" },
    ],
  },
];

const WORKSPACE_FIELD_LOOKUP = new Map(
  WORKSPACE_FIELDS.map((field) => [`${field.fileId}:${field.key}`, field] as const),
);

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

function parseEnvAssignmentLine(rawLine: string): EnvAssignmentLine | null {
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

function readEnvFile(filePath: string): ParsedEnv {
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

async function fetchJson(
  url: string,
  timeoutMs = 4_000,
): Promise<{ ok: boolean; status: number; body: unknown; error?: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
    });

    const text = await response.text();
    const body = text.length > 0 ? tryParseJson(text) : null;

    return {
      ok: response.ok,
      status: response.status,
      body: body ?? text,
      error: response.ok ? undefined : `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      body: null,
      error: error instanceof Error ? error.message : "Request failed",
    };
  } finally {
    clearTimeout(timeout);
  }
}

function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function toneFromOpenClawOutput(output: string): WorkspaceHealthTone {
  const normalized = output.toLowerCase();
  if (normalized.includes("running") || normalized.includes("active") || normalized.includes("started")) {
    return "healthy";
  }
  if (normalized.includes("stopped") || normalized.includes("inactive")) {
    return "unhealthy";
  }
  return "degraded";
}

function toneFromExternalStatus(status: unknown): WorkspaceHealthTone {
  if (status === "healthy" || status === "ok") return "healthy";
  if (status === "degraded") return "degraded";
  if (status === "unhealthy" || status === "error") return "unhealthy";
  return "unknown";
}

function readObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function buildUnknownHealth(id: string, label: string, detail: string, raw: unknown): WorkspaceHealthItem {
  return {
    id,
    label,
    tone: "unknown",
    summary: "Unavailable",
    detail,
    checkedAt: new Date().toISOString(),
    raw,
  };
}

async function getOpenClawHealth(): Promise<WorkspaceHealthItem> {
  try {
    const output = execSync("openclaw gateway status", {
      encoding: "utf8",
      timeout: 4_000,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();

    return {
      id: "openclaw-gateway",
      label: "OpenClaw gateway",
      tone: toneFromOpenClawOutput(output),
      summary: output.split("\n")[0] || "Gateway responded",
      detail: "CLI heartbeat from `openclaw gateway status`.",
      checkedAt: new Date().toISOString(),
      raw: output,
    };
  } catch (error) {
    return buildUnknownHealth(
      "openclaw-gateway",
      "OpenClaw gateway",
      error instanceof Error ? error.message : "OpenClaw CLI unavailable",
      null,
    );
  }
}

async function getExternalHealth(baseUrl: string): Promise<WorkspaceHealthItem> {
  const result = await fetchJson(`${baseUrl}/health`);
  const body = readObject(result.body);
  const status = String(body.status ?? (result.ok ? "ok" : "unknown"));

  if (!result.ok && result.status === 0) {
    return buildUnknownHealth("external-service", "External service", result.error ?? "Request failed", result.body);
  }

  return {
    id: "external-service",
    label: "External service",
    tone: toneFromExternalStatus(status),
    summary: status,
    detail: result.ok
      ? "Aggregate health across Whoop, Tonal, Alpaca, and market data."
      : result.error ?? "Health endpoint returned an error.",
    checkedAt: new Date().toISOString(),
    raw: body,
  };
}

async function getWhoopHealth(baseUrl: string): Promise<WorkspaceHealthItem> {
  const [healthResult, authResult] = await Promise.all([
    fetchJson(`${baseUrl}/whoop/health`),
    fetchJson(`${baseUrl}/auth/status`),
  ]);

  if (!healthResult.ok && healthResult.status === 0 && !authResult.ok && authResult.status === 0) {
    return buildUnknownHealth("whoop", "Whoop", healthResult.error ?? "Request failed", null);
  }

  const healthBody = readObject(healthResult.body);
  const authBody = readObject(authResult.body);
  const authenticated = Boolean(
    healthBody.authenticated ??
      authBody.has_token ??
      authBody.refresh_token_present,
  );
  const tone = authenticated
    ? toneFromExternalStatus(healthBody.status ?? "ok")
    : healthResult.ok || authResult.ok
      ? "degraded"
      : "unknown";

  return {
    id: "whoop",
    label: "Whoop",
    tone,
    summary: authenticated ? "Authenticated" : "Needs OAuth",
    detail:
      typeof authBody.error === "string"
        ? authBody.error
        : "Recovery and sleep ingestion via the local Whoop integration.",
    checkedAt: new Date().toISOString(),
    raw: {
      health: healthBody,
      auth: authBody,
    },
  };
}

async function getTonalHealth(baseUrl: string): Promise<WorkspaceHealthItem> {
  const result = await fetchJson(`${baseUrl}/tonal/health`);
  const body = readObject(result.body);
  const status = String(body.status ?? (result.ok ? "ok" : "unknown"));

  return {
    id: "tonal",
    label: "Tonal",
    tone: toneFromExternalStatus(status),
    summary: status === "healthy" ? "Authenticated" : status,
    detail:
      typeof body.details === "string"
        ? body.details
        : typeof body.error === "string"
          ? body.error
          : "Tonal profile and strength-score ingestion.",
    checkedAt: new Date().toISOString(),
    raw: body,
  };
}

async function getMarketDataHealth(baseUrl: string): Promise<WorkspaceHealthItem> {
  const [readyResult, authResult, opsResult] = await Promise.all([
    fetchJson(`${baseUrl}/market-data/ready`),
    fetchJson(`${baseUrl}/auth/schwab/status`),
    fetchJson(`${baseUrl}/market-data/ops`),
  ]);

  if (!readyResult.ok && readyResult.status === 0 && !authResult.ok && authResult.status === 0) {
    return buildUnknownHealth("market-data", "Market data", readyResult.error ?? "Request failed", null);
  }

  const readyBody = readObject(readyResult.body);
  const authWrapper = readObject(authResult.body);
  const authData = readObject(authWrapper.data);
  const opsWrapper = readObject(opsResult.body);
  const opsData = readObject(opsWrapper.data);
  const ready = Boolean(readObject(readyBody.data).ready ?? false);
  const readyData = readObject(readyBody.data);
  const operatorState =
    typeof readyData.operatorState === "string"
      ? readyData.operatorState
      : authData.pendingStateIssuedAt
        ? "pending"
        : "unknown";
  const refreshTokenPresent = Boolean(authData.refreshTokenPresent);

  return {
    id: "market-data",
    label: "Market data",
    tone: ready ? "healthy" : refreshTokenPresent ? "degraded" : "unhealthy",
    summary: ready ? "Ready" : operatorState,
    detail: ready
      ? "Market data service is ready for quotes, history, and universe refresh."
      : String(readObject(readyBody.data).operatorAction ?? "Inspect Schwab auth and provider state."),
    checkedAt: new Date().toISOString(),
    raw: {
      ready: readyBody,
      schwabAuth: authWrapper,
      ops: opsData,
    },
  };
}

async function getAlpacaHealth(baseUrl: string): Promise<WorkspaceHealthItem> {
  const result = await fetchJson(`${baseUrl}/alpaca/health`);
  const body = readObject(result.body);
  const status = String(body.status ?? (result.ok ? "healthy" : "unknown"));

  return {
    id: "alpaca",
    label: "Alpaca",
    tone: toneFromExternalStatus(status),
    summary:
      status === "healthy"
        ? `${String(body.environment ?? "connected")} · ${String(body.target_environment ?? "target unset")}`
        : status,
    detail:
      typeof body.error === "string"
        ? body.error
        : "Execution-side broker health and account reachability.",
    checkedAt: new Date().toISOString(),
    raw: body,
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

  const health = await Promise.all([
    getOpenClawHealth(),
    getExternalHealth(baseUrl),
    getMarketDataHealth(baseUrl),
    getWhoopHealth(baseUrl),
    getTonalHealth(baseUrl),
    getAlpacaHealth(baseUrl),
  ]);

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
