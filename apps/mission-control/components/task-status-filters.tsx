"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, Clock, GripVertical, Loader2, Sparkles, Zap } from "lucide-react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  closestCorners,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TaskBoardTask } from "@/lib/data";
import { cn } from "@/lib/utils";

type CompletedPagination = {
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  nextOffset: number;
};

type ColumnDef = {
  key: string;
  label: string;
  icon: React.ReactNode;
  empty: string;
  filter: (task: TaskBoardTask) => boolean;
};

const COLUMNS: ColumnDef[] = [
  {
    key: "backlog",
    label: "Backlog",
    icon: <Clock className="h-3.5 w-3.5" />,
    empty: "No backlog tasks.",
    filter: (t) => t.status === "backlog",
  },
  {
    key: "ready",
    label: "Ready",
    icon: <Zap className="h-3.5 w-3.5" />,
    empty: "No ready tasks.",
    filter: (t) => t.status === "ready",
  },
  {
    key: "in_progress",
    label: "In Progress",
    icon: <Loader2 className="h-3.5 w-3.5" />,
    empty: "Nothing in progress.",
    filter: (t) => t.status === "in_progress",
  },
  {
    key: "done",
    label: "Done",
    icon: <CheckCircle2 className="h-3.5 w-3.5" />,
    empty: "No completed tasks.",
    filter: () => false, // handled separately
  },
];

const priorityClass = (p: number) => {
  if (p <= 1) return "kanban-priority-1";
  if (p <= 2) return "kanban-priority-2";
  if (p <= 3) return "kanban-priority-3";
  return "kanban-priority-4";
};

const formatDue = (date: Date) =>
  new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);

/* ── Droppable column wrapper ── */

function DroppableColumn({ id, children }: { id: string; children: React.ReactNode }) {
  const { isOver, setNodeRef } = useDroppable({ id });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "kanban-column min-h-[12rem] transition-colors duration-150",
        isOver && "ring-2 ring-primary/30 bg-primary/5",
      )}
    >
      {children}
    </div>
  );
}

export function TaskStatusFilters({
  activeTasks,
  initialCompletedTasks,
  initialCompletedPagination,
  overdueTasks,
  dueSoonTasks,
}: {
  activeTasks: TaskBoardTask[];
  initialCompletedTasks: TaskBoardTask[];
  initialCompletedPagination: CompletedPagination;
  overdueTasks?: TaskBoardTask[];
  dueSoonTasks?: TaskBoardTask[];
}) {
  const [completedTasks, setCompletedTasks] = useState<TaskBoardTask[]>(initialCompletedTasks);
  const [pagination, setPagination] = useState<CompletedPagination>(initialCompletedPagination);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [doneCollapsed, setDoneCollapsed] = useState(true);

  /* mobile: track which column is expanded */
  const [mobileExpanded, setMobileExpanded] = useState<string>("ready");

  /* ── Drag-and-drop state ── */
  const [localActiveTasks, setLocalActiveTasks] = useState<TaskBoardTask[]>(activeTasks);
  const [localCompletedTasks, setLocalCompletedTasks] = useState<TaskBoardTask[]>(completedTasks);
  const [activeTask, setActiveTask] = useState<TaskBoardTask | null>(null);

  // Sync local state when server props change
  const prevActiveRef = useRef(activeTasks);
  const prevCompletedRef = useRef(completedTasks);

  useEffect(() => {
    if (prevActiveRef.current !== activeTasks) {
      setLocalActiveTasks(activeTasks);
      prevActiveRef.current = activeTasks;
    }
  }, [activeTasks]);

  useEffect(() => {
    if (prevCompletedRef.current !== completedTasks) {
      setLocalCompletedTasks(completedTasks);
      prevCompletedRef.current = completedTasks;
    }
  }, [completedTasks]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const task = (event.active.data.current as { task: TaskBoardTask } | undefined)?.task ?? null;
    setActiveTask(task);
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveTask(null);
      const { active, over } = event;
      if (!over) return;

      const dragData = active.data.current as { task: TaskBoardTask; column: string } | undefined;
      if (!dragData) return;

      const { task, column: fromColumn } = dragData;

      // Resolve drop target to a column key — over.id may be a column id
      // or a card id (e.g. "task-42") if closestCorners picks a card.
      const columnKeys = COLUMNS.map((c) => c.key);
      let toColumn = over.id as string;
      if (!columnKeys.includes(toColumn)) {
        const overData = over.data.current as { task?: TaskBoardTask; column?: string } | undefined;
        toColumn = overData?.column ?? "";
        if (!toColumn) return;
      }

      if (fromColumn === toColumn) return;

      // Optimistic update
      const prevActive = localActiveTasks;
      const prevCompleted = localCompletedTasks;

      // Remove from source
      if (fromColumn === "done") {
        setLocalCompletedTasks((prev) => prev.filter((t) => t.id !== task.id));
      } else {
        setLocalActiveTasks((prev) => prev.filter((t) => t.id !== task.id));
      }

      // Build moved task with new status
      const movedTask: TaskBoardTask = {
        ...task,
        status: toColumn,
        completedAt: toColumn === "done" ? new Date() : null,
      };

      // Add to destination
      if (toColumn === "done") {
        setLocalCompletedTasks((prev) => [movedTask, ...prev]);
      } else {
        setLocalActiveTasks((prev) => [...prev, movedTask]);
      }

      // PATCH API
      fetch("/api/task-board", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: task.id, status: toColumn }),
      })
        .then((res) => {
          if (!res.ok) throw new Error(`PATCH failed: ${res.status}`);
        })
        .catch(() => {
          // Revert on failure
          setLocalActiveTasks(prevActive);
          setLocalCompletedTasks(prevCompleted);
        });
    },
    [localActiveTasks, localCompletedTasks],
  );

  const columnData = useMemo(() => {
    return COLUMNS.map((col) => {
      const tasks = col.key === "done" ? localCompletedTasks : localActiveTasks.filter(col.filter);
      return { ...col, tasks, count: col.key === "done" ? pagination.total : tasks.length };
    });
  }, [localActiveTasks, localCompletedTasks, pagination.total]);

  const canLoadMore = pagination.hasMore && !loadingMore;

  const loadMoreCompleted = async () => {
    if (!canLoadMore) return;
    setLoadingMore(true);
    setLoadError(null);
    try {
      const response = await fetch(
        `/api/task-board?completedLimit=${pagination.limit}&completedOffset=${pagination.nextOffset}`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error(`Request failed with ${response.status}`);
      const data = (await response.json()) as {
        completedTasks?: TaskBoardTask[];
        completedPagination?: CompletedPagination;
      };
      const incoming: TaskBoardTask[] = data.completedTasks ?? [];
      setCompletedTasks((current) => {
        const seen = new Set(current.map((t) => t.id));
        return [...current, ...incoming.filter((t) => !seen.has(t.id))];
      });
      if (data.completedPagination) setPagination(data.completedPagination);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Failed to load.");
    } finally {
      setLoadingMore(false);
    }
  };

  const overdueCount = overdueTasks?.length ?? 0;
  const dueSoonCount = dueSoonTasks?.length ?? 0;

  return (
    <div className="space-y-3">
      {/* Alerts strip */}
      {(overdueCount > 0 || dueSoonCount > 0) && (
        <div className="flex flex-wrap gap-2">
          {overdueCount > 0 && (
            <div className="inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50/60 px-3 py-1.5 text-xs font-medium text-red-900 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-200">
              <AlertTriangle className="h-3.5 w-3.5" />
              {overdueCount} overdue
            </div>
          )}
          {dueSoonCount > 0 && (
            <div className="inline-flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50/60 px-3 py-1.5 text-xs font-medium text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-200">
              <Clock className="h-3.5 w-3.5" />
              {dueSoonCount} due within 48h
            </div>
          )}
        </div>
      )}

      {/* Desktop: horizontal kanban columns with drag-and-drop */}
      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="hidden md:grid md:grid-cols-4 md:gap-3">
          {columnData.map((col) => (
            <DroppableColumn key={col.key} id={col.key}>
              <div className="kanban-column-header">
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">{col.icon}</span>
                  <span className="text-sm font-semibold">{col.label}</span>
                </div>
                <Badge variant="secondary" className="text-[10px]">{col.count}</Badge>
              </div>
              <div className="flex-1 space-y-2 p-2">
                {col.key === "done" ? (
                  <>
                    {doneCollapsed ? (
                      <>
                        {localCompletedTasks.slice(0, 3).map((task) => (
                          <KanbanCard key={task.id} task={task} columnKey="done" compact />
                        ))}
                        {pagination.total > 3 && (
                          <button
                            type="button"
                            onClick={() => setDoneCollapsed(false)}
                            className="w-full rounded-md border border-dashed border-border/50 py-2 text-xs text-muted-foreground hover:text-foreground"
                          >
                            Show {pagination.total - 3} more
                          </button>
                        )}
                      </>
                    ) : (
                      <>
                        {localCompletedTasks.map((task) => (
                          <KanbanCard key={task.id} task={task} columnKey="done" compact />
                        ))}
                        {canLoadMore && (
                          <Button type="button" size="sm" variant="outline" onClick={loadMoreCompleted} disabled={loadingMore} className="w-full text-xs">
                            {loadingMore ? "Loading..." : `Load more (${localCompletedTasks.length}/${pagination.total})`}
                          </Button>
                        )}
                        {loadError && <p className="text-xs text-destructive">{loadError}</p>}
                        <button
                          type="button"
                          onClick={() => setDoneCollapsed(true)}
                          className="w-full rounded-md border border-dashed border-border/50 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                        >
                          Collapse
                        </button>
                      </>
                    )}
                  </>
                ) : col.tasks.length === 0 ? (
                  <p className="px-1 py-4 text-center text-xs text-muted-foreground">{col.empty}</p>
                ) : (
                  col.tasks.map((task) => <KanbanCard key={task.id} task={task} columnKey={col.key} />)
                )}
              </div>
            </DroppableColumn>
          ))}
        </div>
        <DragOverlay dropAnimation={null}>
          {activeTask ? (
            <div className={cn(
              "kanban-card w-64 scale-105 rotate-2 border-2 border-primary/30 shadow-2xl",
              priorityClass(activeTask.priority),
            )}>
              <div className="flex items-start gap-1.5">
                <GripVertical className="mt-0.5 h-4 w-4 text-muted-foreground/40" />
                <p className="min-w-0 flex-1 truncate text-sm font-medium leading-tight">{activeTask.title}</p>
              </div>
              {activeTask.description && (
                <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{activeTask.description}</p>
              )}
              <div className="mt-2 flex flex-wrap gap-1">
                <Badge variant="secondary" className="text-[10px]">P{activeTask.priority}</Badge>
                {activeTask.epic && (
                  <Badge variant="outline" className="max-w-[10rem] truncate text-[10px]">{activeTask.epic.title}</Badge>
                )}
              </div>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* Mobile: collapsible column sections */}
      <div className="space-y-2 md:hidden">
        {columnData.map((col) => {
          const isExpanded = mobileExpanded === col.key;
          return (
            <div key={col.key} className="kanban-column">
              <button
                type="button"
                onClick={() => setMobileExpanded(isExpanded ? "" : col.key)}
                className="kanban-column-header w-full"
              >
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">{col.icon}</span>
                  <span className="text-sm font-semibold">{col.label}</span>
                  <Badge variant="secondary" className="text-[10px]">{col.count}</Badge>
                </div>
                <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", isExpanded && "rotate-180")} />
              </button>
              {isExpanded && (
                <div className="space-y-2 p-2">
                  {col.key === "done" ? (
                    <>
                      {completedTasks.slice(0, 5).map((task) => (
                        <KanbanCard key={task.id} task={task} columnKey="done" compact />
                      ))}
                      {canLoadMore && (
                        <Button type="button" size="sm" variant="outline" onClick={loadMoreCompleted} disabled={loadingMore} className="w-full text-xs">
                          {loadingMore ? "Loading..." : `Load more (${completedTasks.length}/${pagination.total})`}
                        </Button>
                      )}
                    </>
                  ) : col.tasks.length === 0 ? (
                    <p className="px-1 py-3 text-center text-xs text-muted-foreground">{col.empty}</p>
                  ) : (
                    col.tasks.map((task) => <KanbanCard key={task.id} task={task} />)
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Kanban card ── */

function KanbanCard({ task, compact, columnKey }: { task: TaskBoardTask; compact?: boolean; columnKey?: string }) {
  const isOverdue = task.dueAt && task.dueAt < new Date();

  let pillar: string | null = null;
  let feedbackId: string | null = null;
  if (task.metadata && typeof task.metadata === "object" && !Array.isArray(task.metadata)) {
    const meta = task.metadata as Record<string, unknown>;
    if (typeof meta.pillar === "string") pillar = meta.pillar;
    if (typeof meta.feedback_id === "string" && meta.feedback_id.trim()) feedbackId = meta.feedback_id.trim();
  }

  if (compact) {
    return (
      <div className={cn("kanban-card", priorityClass(task.priority))}>
        <div className="flex items-center justify-between gap-2">
          <p className="min-w-0 truncate text-sm font-medium">{task.title}</p>
          {task.outcome && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />}
        </div>
        {task.outcome && (
          <p className="mt-1 truncate text-xs text-muted-foreground">{task.outcome}</p>
        )}
        {task.completedAt && (
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            {new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(task.completedAt)}
          </p>
        )}
      </div>
    );
  }

  return <DraggableCard task={task} columnKey={columnKey} isOverdue={isOverdue} pillar={pillar} feedbackId={feedbackId} />;
}

function DraggableCard({
  task,
  columnKey,
  isOverdue,
  pillar,
  feedbackId,
}: {
  task: TaskBoardTask;
  columnKey?: string;
  isOverdue: boolean | null;
  pillar: string | null;
  feedbackId: string | null;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `task-${task.id}`,
    data: { task, column: columnKey },
  });

  const style: React.CSSProperties | undefined = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn("kanban-card", priorityClass(task.priority), isDragging && "opacity-30")}
    >
      {/* Title row */}
      <div className="flex items-start gap-1.5">
        <button
          {...listeners}
          {...attributes}
          type="button"
          className="mt-0.5 cursor-grab touch-none text-muted-foreground/40 hover:text-muted-foreground active:cursor-grabbing"
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="min-w-0 text-sm font-medium leading-tight">{task.title}</p>
            <div className="flex shrink-0 items-center gap-1">
              {task.autoExecutable && (
                <span title="Auto-executable"><Sparkles className="h-3.5 w-3.5 text-amber-500" /></span>
              )}
              {task.dependencyReady ? (
                <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" title="Dependencies ready" />
              ) : (
                <span className="inline-block h-2 w-2 rounded-full bg-amber-500" title="Blocked" />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Description */}
      {task.description && (
        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{task.description}</p>
      )}

      {/* Tags */}
      <div className="mt-2 flex flex-wrap gap-1">
        <Badge variant="secondary" className="text-[10px]">P{task.priority}</Badge>
        {task.epic && (
          <Badge variant="outline" className="max-w-[10rem] truncate text-[10px]">{task.epic.title}</Badge>
        )}
        {pillar && (
          <Badge variant="outline" className="text-[10px]">{pillar}</Badge>
        )}
        {!task.dependencyReady && (
          <Badge variant="warning" className="text-[10px]">blocked</Badge>
        )}
      </div>

      {/* Footer: due date, dependencies, feedback */}
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        {task.dueAt && (
          <span className={cn("flex items-center gap-1", isOverdue && "font-medium text-red-600 dark:text-red-400")}>
            <Clock className="h-3 w-3" />
            {isOverdue ? "Overdue" : "Due"} {formatDue(task.dueAt)}
          </span>
        )}
        {task.blockedBy.length > 0 && (
          <span className="flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" />
            {task.blockedBy.length} blocker{task.blockedBy.length > 1 ? "s" : ""}
          </span>
        )}
        {feedbackId && (
          <Link
            href={`/feedback?id=${encodeURIComponent(feedbackId)}`}
            className="hover:text-foreground hover:underline"
          >
            feedback
          </Link>
        )}
      </div>
    </div>
  );
}
