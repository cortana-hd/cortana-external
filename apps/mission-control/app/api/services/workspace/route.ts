import { NextResponse } from "next/server";
import {
  ServicesWorkspaceValidationError,
  getServicesWorkspaceData,
  updateServicesWorkspaceData,
} from "@/lib/service-workspace";

type PatchPayload = {
  updates?: Array<{
    fileId: "external" | "missionControl";
    key: string;
    value: string | null;
  }>;
};

export const dynamic = "force-dynamic";

export async function GET(_request: Request) {
  try {
    const data = await getServicesWorkspaceData();
    return NextResponse.json({ status: "ok", data });
  } catch (error) {
    return NextResponse.json(
      {
        status: "error",
        message: error instanceof Error ? error.message : "Failed to load services workspace",
      },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const payload = (await request.json()) as PatchPayload;
    if (!payload || typeof payload !== "object") {
      return NextResponse.json(
        {
          status: "error",
          message: "Invalid request payload",
        },
        { status: 400 },
      );
    }

    const updates = Array.isArray(payload.updates) ? payload.updates : [];
    const data = await updateServicesWorkspaceData(updates);
    return NextResponse.json({ status: "ok", data });
  } catch (error) {
    const status =
      error instanceof ServicesWorkspaceValidationError || error instanceof SyntaxError ? 400 : 500;
    return NextResponse.json(
      {
        status: "error",
        message: error instanceof Error ? error.message : "Failed to update services workspace",
      },
      { status },
    );
  }
}
