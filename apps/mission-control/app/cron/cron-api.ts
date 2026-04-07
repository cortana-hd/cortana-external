import type { CronListResponse, CronRunsResponse, FormState } from "./cron-types";

const REQUEST_HEADERS = { "Content-Type": "application/json" };

const requestJson = async <T,>(url: string, options?: RequestInit): Promise<T> => {
  const response = await fetch(url, { cache: "no-store", ...options });
  let payload: T;
  try {
    payload = (await response.json()) as T;
  } catch {
    throw new Error(`Request failed (${response.status})`);
  }

  if (!response.ok) {
    const errorPayload = payload as { error?: string };
    throw new Error(errorPayload.error || `Request failed (${response.status})`);
  }

  return payload;
};

export const buildPayload = (state: FormState, includeEmpty = false) => {
  const payload: Record<string, unknown> = {};
  const pushValue = (key: keyof FormState, value: unknown) => {
    if (!includeEmpty) {
      if (typeof value === "string" && value.trim() === "") return;
      if (value === undefined || value === null) return;
    }
    payload[key] = value;
  };

  pushValue("name", state.name.trim());
  pushValue("scheduleKind", state.scheduleKind);
  pushValue("scheduleExpr", state.scheduleExpr.trim());
  pushValue("sessionTarget", state.sessionTarget.trim());
  pushValue("payloadKind", state.payloadKind.trim());
  pushValue("payloadMessage", state.payloadMessage.trim());
  pushValue("payloadModel", state.payloadModel.trim());
  pushValue("payloadTimeout", state.payloadTimeout.trim());
  pushValue("deliveryMode", state.deliveryMode.trim());
  pushValue("agentId", state.agentId.trim());
  pushValue("enabled", state.enabled);
  pushValue("isolated", state.isolated);
  pushValue("agentTurn", state.agentTurn);

  return payload;
};

export async function fetchCronJobs(): Promise<CronListResponse> {
  return requestJson<CronListResponse>("/api/cron");
}

export async function fetchCronRuns(jobId: string): Promise<CronRunsResponse> {
  return requestJson<CronRunsResponse>(`/api/cron/${encodeURIComponent(jobId)}/runs`);
}

export async function createCronJob(form: FormState): Promise<unknown> {
  const payload = buildPayload(form);
  return requestJson("/api/cron", {
    method: "POST",
    headers: REQUEST_HEADERS,
    body: JSON.stringify(payload),
  });
}

export async function updateCronJob(jobId: string, form: FormState): Promise<unknown> {
  const payload = buildPayload(form);
  return requestJson(`/api/cron/${encodeURIComponent(jobId)}`, {
    method: "PATCH",
    headers: REQUEST_HEADERS,
    body: JSON.stringify(payload),
  });
}

export async function deleteCronJob(jobId: string): Promise<unknown> {
  return requestJson(`/api/cron/${encodeURIComponent(jobId)}`, { method: "DELETE" });
}

export async function triggerCronJob(jobId: string): Promise<unknown> {
  return requestJson(`/api/cron/${encodeURIComponent(jobId)}/run`, { method: "POST" });
}

export async function toggleCronJob(jobId: string, enabled: boolean): Promise<unknown> {
  return requestJson(`/api/cron/${encodeURIComponent(jobId)}/toggle`, {
    method: "POST",
    headers: REQUEST_HEADERS,
    body: JSON.stringify({ enabled }),
  });
}
