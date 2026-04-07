import { getTaskBoard } from "@/lib/data";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TaskStatusFilters } from "@/components/task-status-filters";
import { AutoRefresh } from "@/components/auto-refresh";

export const dynamic = "force-dynamic";

export default async function TaskBoardPage() {
  let data: Awaited<ReturnType<typeof getTaskBoard>> | null = null;
  let error: string | null = null;

  try {
    data = await getTaskBoard();
  } catch (err) {
    console.error("Failed to load task board", err);
    error = "Task board database not reachable. Point DATABASE_URL at the cortana database or run migrations.";
  }

  if (!data) {
    return (
      <Card className="border-destructive/40 bg-destructive/5">
        <CardHeader>
          <CardTitle className="text-lg">Task Board unavailable</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>{error}</p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>Confirm Postgres is running and DATABASE_URL points to cortana db.</li>
            <li>Run <code className="font-mono">pnpm db:migrate</code> to create adapter tables.</li>
            <li>Seed sample data with <code className="font-mono">pnpm db:seed</code>.</li>
          </ol>
        </CardContent>
      </Card>
    );
  }

  const {
    readyNow,
    blocked,
    dueSoon,
    overdue,
    activeTasks,
    completedTasks,
    completedPagination,
    metadata,
  } = data;

  const liveSyncActive = metadata.listener?.connected;

  return (
    <div className="space-y-4">
      <AutoRefresh />

      {/* ── Header ── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">Tasks</p>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Task Board</h1>
          <p className="text-sm text-muted-foreground">
            Live view into the Cortana task queue.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {liveSyncActive ? (
            <Badge variant="success" className="text-[10px]">
              <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
              Live sync
            </Badge>
          ) : (
            <Badge variant="warning" className="text-[10px]">Fallback mode</Badge>
          )}
          {metadata.listener?.lastEventAt && (
            <span className="text-[10px] text-muted-foreground">
              Last event: {new Date(metadata.listener.lastEventAt).toLocaleString()}
            </span>
          )}
        </div>
      </div>

      {/* ── Sync warnings (only in fallback mode) ── */}
      {!liveSyncActive && metadata.warnings.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-4 py-3 text-sm dark:border-amber-900/50 dark:bg-amber-950/20">
          {metadata.warnings.map((warning: (typeof metadata.warnings)[number]) => (
            <p key={`${warning.code}-${warning.message}`} className="text-amber-900 dark:text-amber-200">
              {warning.message}
            </p>
          ))}
        </div>
      )}

      {/* ── Kanban Board ── */}
      <TaskStatusFilters
        activeTasks={activeTasks}
        initialCompletedTasks={completedTasks}
        initialCompletedPagination={completedPagination}
        overdueTasks={overdue}
        dueSoonTasks={dueSoon}
      />
    </div>
  );
}
