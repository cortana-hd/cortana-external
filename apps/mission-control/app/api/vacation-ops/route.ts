import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { getVacationOpsSnapshot } from "@/lib/vacation-ops";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const auth = requireApiAuth(request, {
    requireConfiguredToken: true,
    allowLoopbackWithoutToken: true,
  });

  if (!auth.ok) {
    return auth.response;
  }

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
