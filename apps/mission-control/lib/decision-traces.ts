import prisma from "@/lib/prisma";
import { getTaskPrisma, isPrimaryDatabaseCortana } from "@/lib/task-prisma";

export type DecisionFilters = {
  rangeHours?: number;
  actionType?: string;
  triggerType?: string;
  outcome?: "success" | "fail" | "unknown" | "all";
  confidenceMin?: number;
  confidenceMax?: number;
  limit?: number;
};

export type DecisionTrace = {
  id: number;
  traceId: string;
  eventId: number | null;
  taskId: number | null;
  runId: string | null;
  triggerType: string;
  actionType: string;
  actionName: string;
  reasoning: string | null;
  confidence: number | null;
  outcome: string;
  dataInputs: Record<string, unknown>;
  metadata: Record<string, unknown>;
  createdAt: string;
  completedAt: string | null;
  triggerEvent: {
    id: number;
    timestamp: string;
    source: string;
    eventType: string;
    severity: string;
    message: string;
    metadata: Record<string, unknown>;
  } | null;
};

type DecisionRow = {
  id: number;
  trace_id: string;
  event_id: number | null;
  task_id: number | null;
  run_id: string | null;
  trigger_type: string;
  action_type: string;
  action_name: string;
  reasoning: string | null;
  confidence: number | null;
  outcome: string;
  data_inputs: unknown;
  metadata: unknown;
  created_at: Date;
  completed_at: Date | null;
  trigger_timestamp: Date | null;
  trigger_source: string | null;
  trigger_event_type: string | null;
  trigger_severity: string | null;
  trigger_message: string | null;
  trigger_metadata: unknown;
};

const normalizeObject = (value: unknown): Record<string, unknown> => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
};

const escapeLiteral = (value: string) => value.replaceAll("'", "''");
const clampDecisionRangeHours = (rangeHours?: number) =>
  Math.max(1, Math.min(rangeHours ?? 24 * 90, 24 * 90));

const normalizeOutcome = (value?: string) => {
  const normalized = (value || "").toLowerCase();
  if (!normalized || normalized === "all") return null;
  if (["success", "ok", "done", "completed"].includes(normalized)) return "success";
  if (["fail", "failed", "error", "timeout", "cancelled", "canceled"].includes(normalized)) {
    return "fail";
  }
  return normalized;
};

const asJsonbLiteral = (value: unknown) => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;

export async function createDecisionTrace(input: {
  traceId: string;
  eventId?: number | null;
  taskId?: number | null;
  runId?: string | null;
  triggerType: string;
  actionType: string;
  actionName: string;
  reasoning?: string | null;
  confidence?: number | null;
  outcome?: string | null;
  dataInputs?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  createdAt?: string | null;
  completedAt?: string | null;
}): Promise<void> {
  const taskPrisma = getTaskPrisma();
  const preferred = taskPrisma ?? prisma;

  const traceId = escapeLiteral(input.traceId);
  const eventId = typeof input.eventId === "number" && Number.isFinite(input.eventId)
    ? `${Math.trunc(input.eventId)}`
    : "NULL";
  const taskId = typeof input.taskId === "number" && Number.isFinite(input.taskId)
    ? `${Math.trunc(input.taskId)}`
    : "NULL";
  const runId = input.runId ? `'${escapeLiteral(input.runId)}'` : "NULL";
  const reasoning = input.reasoning ? `'${escapeLiteral(input.reasoning)}'` : "NULL";
  const confidence = typeof input.confidence === "number" && Number.isFinite(input.confidence)
    ? `${Number(input.confidence)}`
    : "NULL";
  const outcome = input.outcome ? `'${escapeLiteral(input.outcome)}'` : "'unknown'";
  const dataInputs = asJsonbLiteral(input.dataInputs ?? {});
  const metadata = asJsonbLiteral(input.metadata ?? {});
  const createdAt = input.createdAt ? `'${escapeLiteral(input.createdAt)}'::timestamptz` : "NOW()";
  const completedAt = input.completedAt ? `'${escapeLiteral(input.completedAt)}'::timestamptz` : "NULL";

  const sql = `
    INSERT INTO cortana_decision_traces (
      trace_id,
      event_id,
      task_id,
      run_id,
      trigger_type,
      action_type,
      action_name,
      reasoning,
      confidence,
      outcome,
      data_inputs,
      metadata,
      created_at,
      completed_at
    ) VALUES (
      '${traceId}',
      ${eventId},
      ${taskId},
      ${runId},
      '${escapeLiteral(input.triggerType)}',
      '${escapeLiteral(input.actionType)}',
      '${escapeLiteral(input.actionName)}',
      ${reasoning},
      ${confidence},
      ${outcome},
      ${dataInputs},
      ${metadata},
      ${createdAt},
      ${completedAt}
    )
    ON CONFLICT (trace_id) DO UPDATE
    SET
      event_id = COALESCE(EXCLUDED.event_id, cortana_decision_traces.event_id),
      task_id = COALESCE(EXCLUDED.task_id, cortana_decision_traces.task_id),
      run_id = COALESCE(EXCLUDED.run_id, cortana_decision_traces.run_id),
      trigger_type = EXCLUDED.trigger_type,
      action_type = EXCLUDED.action_type,
      action_name = EXCLUDED.action_name,
      reasoning = COALESCE(EXCLUDED.reasoning, cortana_decision_traces.reasoning),
      confidence = COALESCE(EXCLUDED.confidence, cortana_decision_traces.confidence),
      outcome = EXCLUDED.outcome,
      data_inputs = EXCLUDED.data_inputs,
      metadata = EXCLUDED.metadata,
      completed_at = COALESCE(EXCLUDED.completed_at, cortana_decision_traces.completed_at)
  `;

  const run = async (client: typeof prisma) => {
    await client.$executeRawUnsafe(sql);
  };

  try {
    await run(preferred);
  } catch (error) {
    if (!taskPrisma) throw error;
    await run(prisma);
  }
}

export async function getDecisionTraces(filters: DecisionFilters = {}): Promise<{
  traces: DecisionTrace[];
  facets: {
    actionTypes: string[];
    triggerTypes: string[];
    outcomes: string[];
  };
  source: "cortana" | "app";
  warning?: string;
}> {
  const taskPrisma = getTaskPrisma();
  const primaryDatabaseIsCortana = !taskPrisma && isPrimaryDatabaseCortana();
  const preferred = taskPrisma ?? prisma;

  const limit = Math.max(1, Math.min(filters.limit ?? 100, 500));
  const rangeHours = clampDecisionRangeHours(filters.rangeHours);

  const conditions: string[] = [
    `t.created_at >= NOW() - INTERVAL '${rangeHours} hours'`,
  ];

  if (filters.actionType) {
    conditions.push(`t.action_type = '${escapeLiteral(filters.actionType)}'`);
  }
  if (filters.triggerType) {
    conditions.push(`t.trigger_type = '${escapeLiteral(filters.triggerType)}'`);
  }

  const outcome = normalizeOutcome(filters.outcome);
  if (outcome === "success") {
    conditions.push("lower(t.outcome) IN ('success','ok','done','completed')");
  } else if (outcome === "fail") {
    conditions.push("lower(t.outcome) IN ('fail','failed','error','timeout','cancelled','canceled')");
  } else if (outcome) {
    conditions.push(`lower(t.outcome) = '${outcome.replaceAll("'", "''")}'`);
  }

  if (typeof filters.confidenceMin === "number" && Number.isFinite(filters.confidenceMin)) {
    conditions.push(`t.confidence >= ${Number(filters.confidenceMin)}`);
  }
  if (typeof filters.confidenceMax === "number" && Number.isFinite(filters.confidenceMax)) {
    conditions.push(`t.confidence <= ${Number(filters.confidenceMax)}`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const query = `
    SELECT
      t.id,
      t.trace_id,
      t.event_id,
      t.task_id,
      t.run_id,
      t.trigger_type,
      t.action_type,
      t.action_name,
      t.reasoning,
      t.confidence,
      t.outcome,
      t.data_inputs,
      t.metadata,
      t.created_at,
      t.completed_at,
      e.timestamp AS trigger_timestamp,
      e.source AS trigger_source,
      e.event_type AS trigger_event_type,
      e.severity AS trigger_severity,
      e.message AS trigger_message,
      e.metadata AS trigger_metadata
    FROM cortana_decision_traces t
    LEFT JOIN cortana_events e ON e.id = t.event_id
    ${whereClause}
    ORDER BY t.created_at DESC
    LIMIT ${limit}
  `;

  const runQuery = async (client: typeof prisma) =>
    client.$queryRawUnsafe<DecisionRow[]>(query);

  let rows: DecisionRow[] = [];
  let source: "cortana" | "app" = taskPrisma || primaryDatabaseIsCortana ? "cortana" : "app";
  let warning: string | undefined = taskPrisma || primaryDatabaseIsCortana
    ? undefined
    : "CORTANA_DATABASE_URL is not configured; showing decision traces from the Mission Control fallback database.";

  try {
    rows = await runQuery(preferred);
  } catch (error) {
    if (!taskPrisma) throw error;
    source = "app";
    warning = "Decision traces unavailable in the Cortana database; fell back to the Mission Control database.";
    rows = await runQuery(prisma);
  }

  const traces: DecisionTrace[] = rows.map((row) => ({
    id: row.id,
    traceId: row.trace_id,
    eventId: row.event_id,
    taskId: row.task_id,
    runId: row.run_id,
    triggerType: row.trigger_type,
    actionType: row.action_type,
    actionName: row.action_name,
    reasoning: row.reasoning,
    confidence: row.confidence,
    outcome: row.outcome,
    dataInputs: normalizeObject(row.data_inputs),
    metadata: normalizeObject(row.metadata),
    createdAt: row.created_at.toISOString(),
    completedAt: row.completed_at ? row.completed_at.toISOString() : null,
    triggerEvent: row.trigger_timestamp
      ? {
          id: row.event_id ?? 0,
          timestamp: row.trigger_timestamp.toISOString(),
          source: row.trigger_source ?? "unknown",
          eventType: row.trigger_event_type ?? "unknown",
          severity: row.trigger_severity ?? "info",
          message: row.trigger_message ?? "",
          metadata: normalizeObject(row.trigger_metadata),
        }
      : null,
  }));

  const facets = {
    actionTypes: Array.from(new Set(traces.map((trace) => trace.actionType))).sort(),
    triggerTypes: Array.from(new Set(traces.map((trace) => trace.triggerType))).sort(),
    outcomes: Array.from(new Set(traces.map((trace) => trace.outcome))).sort(),
  };

  return { traces, facets, source, warning };
}
