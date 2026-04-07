import prisma from "@/lib/prisma";
import { unstable_noStore as noStore } from "next/cache";
import { getAgentModelDisplay } from "@/lib/agent-models";
import { deriveEvidenceGrade, deriveLaunchPhase, extractProviderPath } from "@/lib/run-intelligence";
import { refreshOpenClawState, deriveAssignmentLabel, latestRunOrder, type RunWithAgent, type AgentStatus, type RunStatus, type Severity } from "@/lib/data-helpers";
import { getAgents } from "@/lib/agents";

type GetRunsInput = {
  take?: number;
  cursor?: string;
  agentId?: string;
};

export type RunsPage = {
  runs: RunWithAgent[];
  nextCursor: string | null;
  hasMore: boolean;
};

export const getRuns = async ({ take = 20, cursor, agentId }: GetRunsInput = {}): Promise<RunsPage> => {
  noStore();
  await refreshOpenClawState();

  const normalizedTake = Math.max(1, Math.min(take, 100));

  const runs = await prisma.run.findMany({
    include: { agent: true },
    where: agentId ? { agentId } : undefined,
    orderBy: latestRunOrder,
    take: normalizedTake + 1,
    ...(cursor
      ? {
          cursor: { id: cursor },
          skip: 1,
        }
      : {}),
  });

  const hasMore = runs.length > normalizedTake;
  const pageRuns = hasMore ? runs.slice(0, normalizedTake) : runs;
  const nextCursor = hasMore ? pageRuns[pageRuns.length - 1]?.id ?? null : null;

  const enrichedRuns = pageRuns.map((run) => {
    const modelInfo = run.agent ? getAgentModelDisplay(run.agent.name, run.agent.model) : null;

    return {
      ...run,
      modelDisplay: modelInfo?.displayName ?? null,
      confidence: deriveEvidenceGrade(run),
      launchPhase: deriveLaunchPhase(run),
      providerPath: extractProviderPath(run.payload ?? null),
      assignmentLabel: deriveAssignmentLabel(run),
    };
  });

  return {
    runs: enrichedRuns,
    hasMore,
    nextCursor,
  };
};

export const getEvents = async () => {
  noStore();
  await refreshOpenClawState();
  return prisma.event.findMany({
    include: { agent: true, run: true },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
};

export const getDashboardSummary = async () => {
  noStore();
  await refreshOpenClawState();
  const [agents, runs, events] = await Promise.all([
    getAgents({ refreshRuns: false }),
    prisma.run.findMany({
      include: { agent: true },
      orderBy: latestRunOrder,
      take: 10,
    }),
    prisma.event.findMany({
      include: { agent: true },
      orderBy: { createdAt: "desc" },
      take: 8,
    }),
  ]);

  const agentCounts = agents.reduce<{ total: number; byStatus: Record<AgentStatus, number> }>(
    (acc, agent) => {
      acc.total += 1;
      const status = agent.status as AgentStatus;
      acc.byStatus[status] = (acc.byStatus[status] || 0) + 1;
      return acc;
    },
    { total: 0, byStatus: {} as Record<AgentStatus, number> }
  );

  const runCounts = runs.reduce<{ total: number; byStatus: Record<RunStatus, number> }>(
    (acc, run) => {
      acc.total += 1;
      const status = run.status as RunStatus;
      acc.byStatus[status] = (acc.byStatus[status] || 0) + 1;
      return acc;
    },
    { total: 0, byStatus: {} as Record<RunStatus, number> }
  );

  const alertCounts = events.reduce<{ total: number; bySeverity: Record<Severity, number> }>(
    (acc, event) => {
      acc.total += 1;
      const severity = event.severity as Severity;
      acc.bySeverity[severity] =
        (acc.bySeverity[severity] || 0) + 1;
      return acc;
    },
    { total: 0, bySeverity: {} as Record<Severity, number> }
  );

  return {
    agents,
    runs: runs.map((run) => ({
      ...run,
      assignmentLabel: deriveAssignmentLabel(run),
    })),
    events,
    metrics: {
      agents: agentCounts,
      runs: runCounts,
      alerts: alertCounts,
    },
  };
};
