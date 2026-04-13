import { NextResponse } from "next/server";
import { getVacationOpsSnapshot, runVacationOpsAction, type VacationActionKey } from "@/lib/vacation-ops";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type VacationActionBody = {
  startAt?: string;
  endAt?: string;
  timezone?: string;
  windowId?: number;
  reason?: string;
};

const VALID_ACTIONS: VacationActionKey[] = ["prep", "enable", "disable", "unpause"];

export async function POST(
  request: Request,
  { params }: { params: Promise<{ action: string }> },
) {
  const { action } = await params;
  if (!VALID_ACTIONS.includes(action as VacationActionKey)) {
    return NextResponse.json({ status: "error", message: `Unknown Vacation Ops action: ${action}` }, { status: 404 });
  }

  let body: VacationActionBody = {};
  try {
    body = (await request.json()) as VacationActionBody;
  } catch {
    body = {};
  }

  try {
    const result = await runVacationOpsAction(action as VacationActionKey, body);
    const data = await getVacationOpsSnapshot();
    return NextResponse.json({ status: "ok", action, result, data });
  } catch (error) {
    return NextResponse.json(
      {
        status: "error",
        message: error instanceof Error ? error.message : "Vacation Ops action failed",
      },
      { status: 500 },
    );
  }
}
