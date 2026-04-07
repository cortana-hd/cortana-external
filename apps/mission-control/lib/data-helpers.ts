import { syncOpenClawRunsFromStore } from "@/lib/openclaw-sync";

export type AgentStatus = "active" | "idle" | "degraded" | "offline";
export type RunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type Severity = "info" | "warning" | "critical";

export type JsonValue = unknown;
export type AgentSummary = {
  id: string;
  name: string;
  role: string;
  model: string | null;
  status: string;
  description: string | null;
  capabilities: string | null;
  healthScore: number | null;
  lastSeen: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type RunWithAgent = {
  id: string;
  agentId: string | null;
  agent: Pick<AgentSummary, "id" | "name" | "model"> | null;
  jobType: string;
  status: string;
  summary: string | null;
  payload: JsonValue | null;
  startedAt: Date;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  externalStatus: string | null;
  [key: string]: unknown;
};

export type CortanaTaskWithEpic = {
  id: number;
  title: string;
  description: string | null;
  priority: number;
  status: string;
  dueAt: Date | null;
  remindAt: Date | null;
  executeAt: Date | null;
  autoExecutable: boolean;
  executionPlan: string | null;
  dependsOn: number[];
  completedAt: Date | null;
  outcome: string | null;
  metadata: JsonValue | null;
  epicId: number | null;
  parentId: number | null;
  assignedTo: string | null;
  source: string | null;
  createdAt: Date;
  updatedAt: Date;
  epic?: {
    id: number;
    title: string;
    status: string;
    deadline: Date | null;
    metadata: JsonValue | null;
  } | null;
  [key: string]: unknown;
};

export const normalizeIdentity = (value?: string | null) =>
  (value || "").trim().toLowerCase();

export const asObject = (value: JsonValue | null | undefined): Record<string, unknown> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

export const stringValue = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

export const deriveAssignmentLabel = (run: {
  agent?: { name: string } | null;
  payload?: JsonValue | null;
  jobType: string;
}): string | null => {
  if (run.agent?.name) return run.agent.name;

  const payload = asObject(run.payload);
  const metadata = asObject((payload?.metadata as JsonValue | undefined) ?? null);

  const candidates = [
    stringValue(payload?.assigned_to),
    stringValue(metadata?.assigned_to),
    stringValue(payload?.agent),
    stringValue(metadata?.agent),
    stringValue(payload?.role),
    stringValue(metadata?.role),
    stringValue(payload?.label),
    stringValue(metadata?.label),
    run.jobType && run.jobType !== "openclaw-subagent" ? run.jobType : null,
  ];

  return candidates.find(Boolean) ?? null;
};

export const refreshOpenClawState = async () => {
  await syncOpenClawRunsFromStore();
};

export const latestRunOrder: unknown[] = [
  { createdAt: "desc" },
  { updatedAt: "desc" },
  { startedAt: "desc" },
  { id: "desc" },
];
