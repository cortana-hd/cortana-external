import prisma from "@/lib/prisma";
import { unstable_noStore as noStore } from "next/cache";
import { getTaskPrisma } from "@/lib/task-prisma";
import { reconcileTaskBoardSources } from "@/lib/task-reconciliation";
import { getTaskListenerStatus } from "@/lib/task-listener";
import { asObject, stringValue, type CortanaTaskWithEpic, type JsonValue } from "@/lib/data-helpers";

export type TaskBoardTask = CortanaTaskWithEpic & {
  dependencyReady: boolean;
  blockedBy: Array<{ id: number; title: string; status: string }>;
};

const pillarFromMetadata = (metadata: JsonValue | null): string => {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return "Unspecified";
  }

  const pillar = (metadata as Record<string, unknown>).pillar;
  return typeof pillar === "string" && pillar.length > 0 ? pillar : "Unspecified";
};

const feedbackIdFromMetadata = (metadata: JsonValue | null): string | null => {
  const payload = asObject(metadata);
  return stringValue(payload?.feedback_id ?? payload?.feedbackId);
};

const LEGACY_GHOST_TASK_TITLE = "Enable auto-remediation for heartbeat misses";
let ghostTaskPruned = false;

const pruneLegacyGhostTask = async () => {
  if (ghostTaskPruned) return;

  await prisma.cortanaTask.deleteMany({
    where: {
      source: "seed",
      title: LEGACY_GHOST_TASK_TITLE,
    },
  });

  ghostTaskPruned = true;
};

type TaskBoardWarning = {
  code: "task_db_fallback" | "task_source_drift" | "task_listener_disconnected";
  message: string;
  cause?: string;
};

const readTaskBoardTasks = async (
  client: typeof prisma,
  options?: { pruneGhostTask?: boolean }
) => {
  if (options?.pruneGhostTask) {
    await pruneLegacyGhostTask();
  }

  return client.cortanaTask.findMany({
    include: { epic: true },
    orderBy: [{ dueAt: "asc" }, { priority: "asc" }, { createdAt: "desc" }],
  });
};

type GetTaskBoardInput = {
  completedLimit?: number;
  completedOffset?: number;
};

const COMPLETED_STATUSES = new Set(["done", "completed"]);
const DEFAULT_COMPLETED_PAGE_SIZE = 20;
const MAX_COMPLETED_PAGE_SIZE = 100;

const completionTime = (task: TaskBoardTask) => task.completedAt?.getTime() ?? task.updatedAt.getTime();

const activeTaskSortRank = (task: TaskBoardTask) => {
  if (task.status === "in_progress") return 0;
  if (task.status === "blocked") return 1;
  if (task.status === "ready" && !task.dependencyReady) return 1;
  if (task.status === "ready") return 2;
  if (task.status === "scheduled") return 3;
  if (task.status === "backlog") return 4;
  if (task.status === "pending" && !task.dependencyReady) return 5;
  if (task.status === "pending") return 6;
  return 7;
};

export const getTaskBoard = async ({
  completedLimit = DEFAULT_COMPLETED_PAGE_SIZE,
  completedOffset = 0,
}: GetTaskBoardInput = {}) => {
  noStore();

  const preferredTaskPrisma = getTaskPrisma();
  let taskSource: "cortana" | "app" = preferredTaskPrisma ? "cortana" : "app";
  const warnings: TaskBoardWarning[] = [];

  let tasks: CortanaTaskWithEpic[];

  try {
    tasks = await readTaskBoardTasks(preferredTaskPrisma ?? prisma, {
      pruneGhostTask: !preferredTaskPrisma,
    });
  } catch (error) {
    if (!preferredTaskPrisma) {
      throw error;
    }

    console.warn("Task board cortana DB unavailable, falling back to app DB", error);
    taskSource = "app";
    warnings.push({
      code: "task_db_fallback",
      message:
        "Dedicated task database is unavailable. Showing tasks from the app database until cortana DB recovers.",
      cause: error instanceof Error ? error.message : "Unknown task DB error",
    });

    tasks = await readTaskBoardTasks(prisma, { pruneGhostTask: true });
  }

  const listener = getTaskListenerStatus();

  const reconcileReport = await reconcileTaskBoardSources();
  if (reconcileReport?.drift && !listener.connected) {
    warnings.push({
      code: "task_source_drift",
      message: `Source-of-truth drift detected (preferred=${reconcileReport.preferredCount}, app=${reconcileReport.appCount}). Auto-reconcile is monitoring and this UI is anchored to ${taskSource}.`,
      cause: `missingInApp=${reconcileReport.missingInAppSample.join(",") || "none"}; missingInPreferred=${reconcileReport.missingInPreferredSample.join(",") || "none"}`,
    });
  }

  if (listener.enabled && listener.started && !listener.connected) {
    warnings.push({
      code: "task_listener_disconnected",
      message:
        "Live task sync listener is disconnected. Falling back to periodic reconciliation until connection recovers.",
      cause: listener.lastError ?? undefined,
    });
  }

  const tasksMissingFeedback = tasks
    .filter((task) => !feedbackIdFromMetadata(task.metadata ?? null))
    .map((task) => task.id);

  if (tasksMissingFeedback.length > 0) {
    const idsLiteral = tasksMissingFeedback.map((id) => `'${id}'`).join(",");
    const sql = `
      SELECT id, task_id
      FROM mc_feedback_items
      WHERE task_id::text IN (${idsLiteral})
    `;

    const runQuery = async (client: typeof prisma) =>
      client.$queryRawUnsafe<Array<{ id: string; task_id: string | number | null }>>(sql);

    let rows: Array<{ id: string; task_id: string | number | null }> = [];
    try {
      rows = await runQuery(preferredTaskPrisma ?? prisma);
    } catch (error) {
      if (!preferredTaskPrisma) {
        console.warn("Failed to hydrate feedback metadata for task board", error);
      } else {
        try {
          rows = await runQuery(prisma);
        } catch (fallbackError) {
          console.warn("Failed to hydrate feedback metadata for task board", fallbackError);
        }
      }
    }

    if (rows.length > 0) {
      const feedbackByTaskId = new Map<number, string>();
      rows.forEach((row) => {
        if (!row.task_id) return;
        const taskId = Number(row.task_id);
        if (Number.isFinite(taskId)) {
          feedbackByTaskId.set(taskId, row.id);
        }
      });

      if (feedbackByTaskId.size > 0) {
        tasks.forEach((task) => {
          if (feedbackIdFromMetadata(task.metadata ?? null)) return;
          const feedbackId = feedbackByTaskId.get(task.id);
          if (!feedbackId) return;
          const metadata = asObject(task.metadata) ?? {};
          task.metadata = {
            ...metadata,
            feedback_id: feedbackId,
          } satisfies JsonValue;
        });
      }
    }
  }

  const tasksById = tasks.reduce<
    Record<number, CortanaTaskWithEpic>
  >((acc, task) => {
    acc[task.id] = task;
    return acc;
  }, {});

  const annotated: TaskBoardTask[] = tasks.map((task) => {
    const dependencies = task.dependsOn || [];
    const blockers = dependencies
      .map((id: number) => ({ id, task: tasksById[id] }))
      .filter(({ task }: { task: CortanaTaskWithEpic | undefined }) => {
        if (!task) return true;
        const normalized = task.status.toLowerCase();
        return !COMPLETED_STATUSES.has(normalized);
      });

    const blockedBy = blockers.map(({ id, task }: { id: number; task: CortanaTaskWithEpic | undefined }) =>
      task
        ? { id: task.id, title: task.title, status: task.status }
        : { id, title: "Unknown dependency", status: "missing" }
    );

    return {
      ...task,
      dependencyReady: blockers.length === 0,
      blockedBy,
    };
  });

  const safeCompletedLimit = Math.max(1, Math.min(completedLimit, MAX_COMPLETED_PAGE_SIZE));
  const safeCompletedOffset = Math.max(0, completedOffset);

  const completedTasks = annotated
    .filter((task) => COMPLETED_STATUSES.has(task.status.toLowerCase()))
    .sort((a, b) => completionTime(b) - completionTime(a));

  const activeTasks = annotated
    .filter((task) => !COMPLETED_STATUSES.has(task.status.toLowerCase()))
    .sort((a, b) => {
      const rankDiff = activeTaskSortRank(a) - activeTaskSortRank(b);
      if (rankDiff !== 0) return rankDiff;

      const aDue = a.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const bDue = b.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
      if (aDue !== bDue) return aDue - bDue;

      if (a.priority !== b.priority) return a.priority - b.priority;
      return b.createdAt.getTime() - a.createdAt.getTime();
    });

  const pagedCompletedTasks = completedTasks.slice(
    safeCompletedOffset,
    safeCompletedOffset + safeCompletedLimit
  );

  const now = new Date();
  const soon = new Date(now.getTime() + 1000 * 60 * 60 * 48);

  const readyNow = activeTasks.filter(
    (task) =>
      (task.status === "ready" || task.status === "pending") &&
      task.autoExecutable &&
      task.dependencyReady
  );

  const blocked = activeTasks.filter(
    (task) =>
      (task.status === "ready" || task.status === "pending") &&
      (task.dependsOn?.length || 0) > 0 &&
      !task.dependencyReady
  );

  const dueSoon = activeTasks.filter(
    (task) =>
      (task.status === "ready" || task.status === "pending" || task.status === "scheduled") &&
      task.dueAt &&
      task.dueAt >= now &&
      task.dueAt <= soon
  );

  const overdue = activeTasks.filter(
    (task) =>
      (task.status === "ready" || task.status === "pending" || task.status === "scheduled") &&
      task.dueAt &&
      task.dueAt < now
  );

  const byPillar = activeTasks.reduce<Record<string, TaskBoardTask[]>>(
    (acc, task) => {
      const pillar = pillarFromMetadata(task.metadata ?? null);
      if (!acc[pillar]) acc[pillar] = [];
      acc[pillar].push(task);
      return acc;
    },
    {}
  );

  const recentOutcomes = completedTasks.slice(0, 10);

  return {
    tasks: [...activeTasks, ...pagedCompletedTasks],
    activeTasks,
    completedTasks: pagedCompletedTasks,
    completedPagination: {
      total: completedTasks.length,
      offset: safeCompletedOffset,
      limit: safeCompletedLimit,
      hasMore: safeCompletedOffset + pagedCompletedTasks.length < completedTasks.length,
      nextOffset: safeCompletedOffset + pagedCompletedTasks.length,
    },
    readyNow,
    blocked,
    dueSoon,
    overdue,
    byPillar,
    recentOutcomes,
    metadata: {
      source: taskSource,
      warnings,
      reconciliation: reconcileReport,
      listener,
    },
  };
};
