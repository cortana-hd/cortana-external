import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getTaskPrisma } from "@/lib/task-prisma";
import { getTaskBoard } from "@/lib/task-board-data";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const completedLimit = Number(searchParams.get("completedLimit") ?? "20");
    const completedOffset = Number(searchParams.get("completedOffset") ?? "0");

    const data = await getTaskBoard({ completedLimit, completedOffset });

    return NextResponse.json({
      completedTasks: data.completedTasks,
      completedPagination: data.completedPagination,
    });
  } catch (error) {
    console.error("Task board GET error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch task board" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { taskId, status } = body as { taskId: number; status: string };

    if (!taskId || !status) {
      return NextResponse.json({ error: "taskId and status required" }, { status: 400 });
    }

    const validStatuses = ["backlog", "ready", "in_progress", "done"];
    if (!validStatuses.includes(status)) {
      return NextResponse.json({ error: `Invalid status: ${status}` }, { status: 400 });
    }

    // Map kanban column names to actual DB status values
    const dbStatus = status === "done" ? "completed" : status;

    const taskPrisma = getTaskPrisma();
    const db = taskPrisma ?? prisma;

    await db.cortanaTask.update({
      where: { id: taskId },
      data: {
        status: dbStatus,
        ...(dbStatus === "completed" ? { completedAt: new Date() } : { completedAt: null }),
      },
    });

    return NextResponse.json({ ok: true, taskId, status: dbStatus });
  } catch (error) {
    console.error("Task update error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update task" },
      { status: 500 },
    );
  }
}
