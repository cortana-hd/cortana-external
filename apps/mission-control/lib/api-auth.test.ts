import { afterEach, describe, expect, it } from "vitest";
import { requireApiAuth, requireSameOrigin } from "@/lib/api-auth";

const originalToken = process.env.MISSION_CONTROL_API_TOKEN;

const resetEnv = () => {
  if (originalToken === undefined) {
    delete process.env.MISSION_CONTROL_API_TOKEN;
  } else {
    process.env.MISSION_CONTROL_API_TOKEN = originalToken;
  }
};

afterEach(() => {
  resetEnv();
});

const buildRequest = (headers?: Record<string, string>, method = "GET") =>
  new Request("http://localhost/api/test", {
    method,
    headers,
  });

describe("requireApiAuth", () => {
  it("rejects strict machine endpoints when no token is configured", () => {
    delete process.env.MISSION_CONTROL_API_TOKEN;
    const result = requireApiAuth(buildRequest(), { requireConfiguredToken: true });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(503);
    }
  });

  it("rejects requests without credentials when token is configured", () => {
    process.env.MISSION_CONTROL_API_TOKEN = "secret";
    const result = requireApiAuth(buildRequest());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
    }
  });

  it("accepts bearer tokens", () => {
    process.env.MISSION_CONTROL_API_TOKEN = "secret";
    const result = requireApiAuth(buildRequest({ authorization: "Bearer secret" }));
    expect(result.ok).toBe(true);
  });

  it("accepts additional tokens when primary token is unset", () => {
    delete process.env.MISSION_CONTROL_API_TOKEN;
    const result = requireApiAuth(buildRequest({ authorization: "Bearer alt" }), {
      additionalTokens: ["alt"],
    });
    expect(result.ok).toBe(true);
  });

  it("accepts x-api-key tokens", () => {
    process.env.MISSION_CONTROL_API_TOKEN = "secret";
    const result = requireApiAuth(buildRequest({ "x-api-key": "secret" }));
    expect(result.ok).toBe(true);
  });
});

describe("requireSameOrigin", () => {
  it("allows safe methods without origin headers", () => {
    const result = requireSameOrigin(buildRequest());
    expect(result.ok).toBe(true);
  });

  it("allows unsafe methods when origin host matches request host", () => {
    const result = requireSameOrigin(
      buildRequest({ host: "100.120.198.12:3000", origin: "http://100.120.198.12:3000" }, "POST"),
    );
    expect(result.ok).toBe(true);
  });

  it("rejects unsafe methods with a forged origin", () => {
    const result = requireSameOrigin(
      buildRequest({ host: "100.120.198.12:3000", origin: "https://evil.test" }, "POST"),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(403);
    }
  });
});
