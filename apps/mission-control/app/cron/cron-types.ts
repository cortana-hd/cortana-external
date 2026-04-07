export type CronJob = Record<string, unknown> & {
  id?: string;
  name?: string;
  enabled?: boolean;
  schedule?: Record<string, unknown>;
  state?: Record<string, unknown>;
};

export type CronRun = Record<string, unknown>;

export type CronListResponse = {
  jobs?: CronJob[];
  error?: string;
  details?: string;
};

export type CronRunsResponse = {
  runs?: CronRun[] | Record<string, unknown>;
  raw?: string;
  error?: string;
  details?: string;
};

export type FormMode = "create" | "edit";

export type FormState = {
  name: string;
  scheduleKind: string;
  scheduleExpr: string;
  sessionTarget: string;
  payloadKind: string;
  payloadMessage: string;
  payloadModel: string;
  payloadTimeout: string;
  deliveryMode: string;
  agentId: string;
  enabled: boolean;
  isolated: boolean;
  agentTurn: boolean;
};

export const DEFAULT_FORM: FormState = {
  name: "",
  scheduleKind: "cron",
  scheduleExpr: "",
  sessionTarget: "",
  payloadKind: "message",
  payloadMessage: "",
  payloadModel: "",
  payloadTimeout: "",
  deliveryMode: "none",
  agentId: "",
  enabled: true,
  isolated: true,
  agentTurn: true,
};
