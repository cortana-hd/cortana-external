/**
 * Re-export barrel for backward compatibility.
 *
 * New code should import directly from the domain modules:
 * - @/lib/agents (getAgents, getAgentDetail)
 * - @/lib/runs (getRuns, getEvents, getDashboardSummary)
 * - @/lib/task-board-data (getTaskBoard, TaskBoardTask)
 */
export { getAgents, getAgentDetail } from "@/lib/agents";
export { getRuns, getEvents, getDashboardSummary } from "@/lib/runs";
export type { RunsPage } from "@/lib/runs";
export { getTaskBoard } from "@/lib/task-board-data";
export type { TaskBoardTask } from "@/lib/task-board-data";
