import { NextResponse, type NextRequest } from "next/server";
import { requireApiAuth, requireSameOrigin } from "@/lib/api-auth";

type MachineRule = {
  methods: string[];
  additionalTokens?: () => Array<string | null | undefined>;
};

const MACHINE_RULES = new Map<string, MachineRule>([
  ["/api/openclaw/subagent-events", { methods: ["POST"], additionalTokens: () => [process.env.OPENCLAW_EVENT_TOKEN] }],
  ["/api/github/post-merge-task-autoclose", { methods: ["POST"], additionalTokens: () => [process.env.GITHUB_MERGE_HOOK_TOKEN] }],
  ["/api/council/jobs/deliberate", { methods: ["POST"], additionalTokens: () => [process.env.MISSION_CONTROL_CRON_TOKEN] }],
  ["/api/feedback/ingest", { methods: ["POST"] }],
  ["/api/approvals/ingest", { methods: ["POST"] }],
  ["/api/decisions", { methods: ["POST"] }],
]);

const isUnsafeMethod = (method: string) => !["GET", "HEAD", "OPTIONS"].includes(method);

export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  if (pathname.startsWith("/api")) {
    const machineRule = MACHINE_RULES.get(pathname);
    if (machineRule && machineRule.methods.includes(request.method.toUpperCase())) {
      const auth = requireApiAuth(request, {
        additionalTokens: machineRule.additionalTokens?.(),
        requireConfiguredToken: true,
      });
      if (!auth.ok) {
        return auth.response;
      }
      return NextResponse.next();
    }

    if (isUnsafeMethod(request.method)) {
      const auth = requireSameOrigin(request);
      if (!auth.ok) {
        return auth.response;
      }
    }

    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
