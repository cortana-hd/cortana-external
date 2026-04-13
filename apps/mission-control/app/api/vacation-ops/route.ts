import { NextResponse } from "next/server";
import { getVacationOpsSnapshot } from "@/lib/vacation-ops";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(_request: Request) {
  try {
    const data = await getVacationOpsSnapshot();
    return NextResponse.json({ status: "ok", data });
  } catch (error) {
    return NextResponse.json(
      {
        status: "error",
        message: error instanceof Error ? error.message : "Failed to load Vacation Ops status",
      },
      { status: 500 },
    );
  }
}
