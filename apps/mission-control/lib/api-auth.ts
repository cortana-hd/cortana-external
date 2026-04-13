import { NextResponse } from "next/server";

const normalizeToken = (value?: string | null) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

const safeEqual = (left: string, right: string) => {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let i = 0; i < left.length; i += 1) {
    result |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return result === 0;
};

type TokenSource = "authorization" | "api-key";

const extractToken = (request: Request): { token: string; source: TokenSource } | null => {
  const authHeader = normalizeToken(request.headers.get("authorization"));
  if (authHeader?.toLowerCase().startsWith("bearer ")) {
    const token = normalizeToken(authHeader.slice(7));
    if (token) return { token, source: "authorization" };
  }

  const apiKey = normalizeToken(request.headers.get("x-api-key"));
  if (apiKey) return { token: apiKey, source: "api-key" };

  return null;
};

const resolveExpectedTokens = (additionalTokens?: Array<string | null | undefined>) => {
  const tokens = [normalizeToken(process.env.MISSION_CONTROL_API_TOKEN), ...(additionalTokens ?? [])];
  return tokens.map((token) => normalizeToken(token)).filter((token): token is string => Boolean(token));
};

const isSafeMethod = (method: string) =>
  method === "GET" || method === "HEAD" || method === "OPTIONS";

const isSameOrigin = (request: Request) => {
  const originHeader = normalizeToken(request.headers.get("origin"));
  const refererHeader = normalizeToken(request.headers.get("referer"));
  const hostHeader = normalizeToken(request.headers.get("host"));
  const expectedOrigin = normalizeToken(process.env.MISSION_CONTROL_URL);

  const originValue = originHeader ?? refererHeader;
  if (!originValue || !hostHeader) return false;

  try {
    const origin = new URL(originValue);
    if (origin.host === hostHeader) return true;
    if (expectedOrigin) {
      const expected = new URL(expectedOrigin);
      return expected.host === origin.host;
    }
  } catch {
    return false;
  }

  return false;
};

type AuthResult =
  | { ok: true; tokenConfigured: boolean }
  | { ok: false; response: NextResponse };

export const requireApiAuth = (
  request: Request,
  options?: {
    additionalTokens?: Array<string | null | undefined>;
    requireConfiguredToken?: boolean;
  },
): AuthResult => {
  const expectedTokens = resolveExpectedTokens(options?.additionalTokens);

  if (expectedTokens.length === 0) {
    if (options?.requireConfiguredToken) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "MISSION_CONTROL_API_TOKEN must be configured for this endpoint" },
          { status: 503 },
        ),
      };
    }

    return { ok: true, tokenConfigured: false };
  }

  const provided = extractToken(request);
  if (!provided) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  const matches = expectedTokens.some((expected) => safeEqual(provided.token, expected));
  if (!matches) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  return { ok: true, tokenConfigured: true };
};

export const requireSameOrigin = (request: Request): AuthResult => {
  if (isSafeMethod(request.method)) {
    return { ok: true, tokenConfigured: false };
  }

  if (!isSameOrigin(request)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  return { ok: true, tokenConfigured: false };
};
