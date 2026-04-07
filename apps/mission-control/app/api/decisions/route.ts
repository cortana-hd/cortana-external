import { NextResponse } from "next/server";
import { createDecisionTrace, getDecisionTraces } from "@/lib/decision-traces";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const parseNumber = (value: string | null) => {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    const data = await getDecisionTraces({
      rangeHours: parseNumber(searchParams.get("rangeHours")) ?? 24 * 90,
      actionType: searchParams.get("actionType") || undefined,
      triggerType: searchParams.get("triggerType") || undefined,
      outcome: (searchParams.get("outcome") as "success" | "fail" | "unknown" | "all" | null) ?? "all",
      confidenceMin: parseNumber(searchParams.get("confidenceMin")),
      confidenceMax: parseNumber(searchParams.get("confidenceMax")),
      limit: parseNumber(searchParams.get("limit")) ?? 120,
    });

    return NextResponse.json(data, {
      headers: {
        "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      },
    });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      trace_id?: string;
      event_id?: number | null;
      task_id?: number | null;
      run_id?: string | null;
      trigger_type?: string;
      action_type?: string;
      action_name?: string;
      reasoning?: string | null;
      confidence?: number | null;
      outcome?: string | null;
      data_inputs?: Record<string, unknown>;
      metadata?: Record<string, unknown>;
      created_at?: string | null;
      completed_at?: string | null;
    };

    if (!body.trace_id || !body.trigger_type || !body.action_type || !body.action_name) {
      return NextResponse.json(
        { error: "Missing required fields: trace_id, trigger_type, action_type, action_name" },
        { status: 400 },
      );
    }

    await createDecisionTrace({
      traceId: body.trace_id,
      eventId: body.event_id ?? null,
      taskId: body.task_id ?? null,
      runId: body.run_id ?? null,
      triggerType: body.trigger_type,
      actionType: body.action_type,
      actionName: body.action_name,
      reasoning: body.reasoning ?? null,
      confidence: body.confidence ?? null,
      outcome: body.outcome ?? null,
      dataInputs: body.data_inputs ?? {},
      metadata: body.metadata ?? {},
      createdAt: body.created_at ?? null,
      completedAt: body.completed_at ?? null,
    });

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
