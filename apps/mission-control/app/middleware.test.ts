import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";

const originalMissionControlToken = process.env.MISSION_CONTROL_API_TOKEN;
const originalOpenClawToken = process.env.OPENCLAW_EVENT_TOKEN;

afterEach(() => {
  if (originalMissionControlToken === undefined) {
    delete process.env.MISSION_CONTROL_API_TOKEN;
  } else {
    process.env.MISSION_CONTROL_API_TOKEN = originalMissionControlToken;
  }

  if (originalOpenClawToken === undefined) {
    delete process.env.OPENCLAW_EVENT_TOKEN;
  } else {
    process.env.OPENCLAW_EVENT_TOKEN = originalOpenClawToken;
  }
});

describe("mission control middleware", () => {
  it("allows remote browser GET requests without token bootstrap", () => {
    delete process.env.MISSION_CONTROL_API_TOKEN;
    const request = new NextRequest("http://100.120.198.12:3000/api/services/workspace", {
      headers: { host: "100.120.198.12:3000" },
    });

    const response = middleware(request);
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("allows same-origin browser mutations", () => {
    const request = new NextRequest("http://100.120.198.12:3000/api/vacation-ops/actions/enable", {
      method: "POST",
      headers: {
        host: "100.120.198.12:3000",
        origin: "http://100.120.198.12:3000",
      },
    });

    const response = middleware(request);
    expect(response.status).toBe(200);
  });

  it("rejects forged browser mutation origins", () => {
    const request = new NextRequest("http://100.120.198.12:3000/api/services/workspace", {
      method: "PATCH",
      headers: {
        host: "100.120.198.12:3000",
        origin: "https://evil.test",
      },
    });

    const response = middleware(request);
    expect(response.status).toBe(403);
  });

  it("keeps machine ingress endpoints token protected", () => {
    process.env.OPENCLAW_EVENT_TOKEN = "openclaw-secret";
    const request = new NextRequest("http://100.120.198.12:3000/api/openclaw/subagent-events", {
      method: "POST",
      headers: { host: "100.120.198.12:3000" },
    });

    const response = middleware(request);
    expect(response.status).toBe(401);
  });

  it("accepts valid machine ingress tokens", () => {
    process.env.OPENCLAW_EVENT_TOKEN = "openclaw-secret";
    const request = new NextRequest("http://100.120.198.12:3000/api/openclaw/subagent-events", {
      method: "POST",
      headers: {
        host: "100.120.198.12:3000",
        authorization: "Bearer openclaw-secret",
      },
    });

    const response = middleware(request);
    expect(response.status).toBe(200);
  });
});
