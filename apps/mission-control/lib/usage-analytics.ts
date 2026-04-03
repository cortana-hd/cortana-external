import { runOpenclaw } from "@/lib/openclaw-cli";

const DEFAULT_MINUTES = 1440;

type RawSession = Record<string, unknown>;

export type UsageSession = {
  key: string | null;
  sessionId: string | null;
  updatedAt: number | null;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  model: string | null;
  agentId: string | null;
  estimatedCost: number;
};

export type UsageBreakdownRow = {
  model: string;
  sessions: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
};

export type UsageAnalytics = {
  windowMinutes: number;
  totals: {
    sessions: number;
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
    estimatedCost: number;
  };
  byModel: UsageBreakdownRow[];
  byAgent: Array<UsageBreakdownRow & { agentId: string }>;
  sessions: UsageSession[];
};

const RATE_TABLE: Record<string, { input: number; output: number }> = {
  opus: { input: 15, output: 75 },
  sonnet: { input: 3, output: 15 },
  codex: { input: 2, output: 8 },
  "gpt-5.1": { input: 1, output: 4 },
};

const parseJson = (raw: string) => {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const toNumber = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const toTimestamp = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.getTime();
  return null;
};

const toStringValue = (value: unknown) => {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
};

const getSessionList = (payload: unknown): RawSession[] => {
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  const sessions = record.sessions;
  return Array.isArray(sessions) ? (sessions as RawSession[]) : [];
};

const getModelFamily = (model: string) => {
  const lower = model.toLowerCase();
  if (lower.includes("gpt-5.1")) return "gpt-5.1";
  if (lower.includes("opus")) return "opus";
  if (lower.includes("sonnet")) return "sonnet";
  if (lower.includes("codex")) return "codex";
  return "unknown";
};

const getCostTokens = (session: {
  totalTokens: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
}) => {
  const totalTokens = session.totalTokens;
  let costInput = session.inputTokens;
  let costOutput = session.outputTokens;

  if (costInput === null && costOutput === null) {
    if (totalTokens !== null) {
      costInput = totalTokens / 2;
      costOutput = totalTokens / 2;
    } else {
      costInput = 0;
      costOutput = 0;
    }
  } else if (costInput === null && costOutput !== null) {
    costInput = totalTokens !== null ? Math.max(totalTokens - costOutput, 0) : 0;
  } else if (costInput !== null && costOutput === null) {
    costOutput = totalTokens !== null ? Math.max(totalTokens - costInput, 0) : 0;
  }

  return {
    costInputTokens: costInput ?? 0,
    costOutputTokens: costOutput ?? 0,
  };
};

const estimateCost = (model: string | null, inputTokens: number, outputTokens: number) => {
  if (!model) return 0;
  const family = getModelFamily(model);
  const rates = RATE_TABLE[family];
  if (!rates) return 0;
  return (inputTokens * rates.input + outputTokens * rates.output) / 1_000_000;
};

const normalizeSession = (session: RawSession): UsageSession => {
  const totalTokensRaw = toNumber(session.totalTokens ?? session.total_tokens) ?? 0;
  const inputTokensRaw = toNumber(session.inputTokens ?? session.input_tokens);
  const outputTokensRaw = toNumber(session.outputTokens ?? session.output_tokens);
  const model = toStringValue(session.model ?? session.modelOverride ?? session.model_override);
  const { costInputTokens, costOutputTokens } = getCostTokens({
    totalTokens: totalTokensRaw,
    inputTokens: inputTokensRaw,
    outputTokens: outputTokensRaw,
  });

  return {
    key: toStringValue(session.key ?? session.sessionKey ?? session.id),
    sessionId: toStringValue(session.sessionId ?? session.id),
    updatedAt: toTimestamp(session.updatedAt ?? session.updated_at ?? session.lastUpdatedAt),
    totalTokens: totalTokensRaw,
    inputTokens: inputTokensRaw ?? costInputTokens,
    outputTokens: outputTokensRaw ?? costOutputTokens,
    model,
    agentId: toStringValue(session.agentId ?? session.agent_id) ?? "unknown",
    estimatedCost: estimateCost(model, costInputTokens, costOutputTokens),
  };
};

const parseMinutes = (value: string | null) => {
  if (!value) return DEFAULT_MINUTES;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MINUTES;
  return Math.floor(parsed);
};

const summarizeByModel = (sessions: UsageSession[]): UsageBreakdownRow[] => {
  const groups = new Map<string, UsageBreakdownRow>();

  for (const session of sessions) {
    const key = session.model ?? "unknown";
    const current = groups.get(key) ?? {
      model: key,
      sessions: 0,
      totalTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCost: 0,
    };

    current.sessions += 1;
    current.totalTokens += session.totalTokens;
    current.inputTokens += session.inputTokens;
    current.outputTokens += session.outputTokens;
    current.estimatedCost += session.estimatedCost;
    groups.set(key, current);
  }

  return [...groups.values()].sort((a, b) => b.estimatedCost - a.estimatedCost);
};

const summarizeByAgent = (sessions: UsageSession[]): Array<UsageBreakdownRow & { agentId: string }> => {
  const groups = new Map<string, UsageBreakdownRow & { agentId: string }>();

  for (const session of sessions) {
    const key = session.agentId ?? "unknown";
    const current = groups.get(key) ?? {
      agentId: key,
      model: "n/a",
      sessions: 0,
      totalTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCost: 0,
    };

    current.sessions += 1;
    current.totalTokens += session.totalTokens;
    current.inputTokens += session.inputTokens;
    current.outputTokens += session.outputTokens;
    current.estimatedCost += session.estimatedCost;
    groups.set(key, current);
  }

  return [...groups.values()].sort((a, b) => b.estimatedCost - a.estimatedCost);
};

export function buildUsageAnalytics(payload: unknown, minutes: number): UsageAnalytics {
  const sessions = getSessionList(payload).map(normalizeSession);

  const totals = sessions.reduce(
    (acc, session) => ({
      sessions: acc.sessions + 1,
      totalTokens: acc.totalTokens + session.totalTokens,
      inputTokens: acc.inputTokens + session.inputTokens,
      outputTokens: acc.outputTokens + session.outputTokens,
      estimatedCost: acc.estimatedCost + session.estimatedCost,
    }),
    {
      sessions: 0,
      totalTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCost: 0,
    }
  );

  const byModel = summarizeByModel(sessions);
  const byAgent = summarizeByAgent(sessions);

  return {
    windowMinutes: minutes,
    totals,
    byModel,
    byAgent,
    sessions,
  };
}

export async function getUsageAnalytics(minutesInput: string | null): Promise<UsageAnalytics> {
  const minutes = parseMinutes(minutesInput);
  const raw = await runOpenclaw(["sessions", "--json", "--all-agents", "--active", String(minutes)]);
  const parsed = parseJson(raw);

  if (!parsed) {
    throw new Error("Failed to parse OpenClaw sessions output");
  }

  return buildUsageAnalytics(parsed, minutes);
}
