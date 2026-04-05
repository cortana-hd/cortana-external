export interface WhoopTokenData {
  access_token: string;
  refresh_token: string;
  expires_at: string;
  last_refresh_at?: string;
}

export interface WhoopTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  token_type?: string;
}

export interface WhoopData {
  profile: Record<string, unknown>;
  body_measurement: Record<string, unknown>;
  cycles: Record<string, unknown>[];
  recovery: Record<string, unknown>[];
  sleep: Record<string, unknown>[];
  workouts: Record<string, unknown>[];
  quality?: WhoopQuality;
}

export interface WhoopQuality {
  fetched_at: string;
  page_count: number;
  next_tokens: string[];
  repeated_next_token_detected: boolean;
  workout_record_count: number;
  unique_workout_count: number;
  duplicate_workout_ids_removed: number;
}

export interface WhoopCollectionResponse {
  records: Record<string, unknown>[];
  next_token?: string;
}

export interface WhoopServiceOptions {
  clientId: string;
  clientSecret: string;
  redirectUrl: string;
  tokenPath: string;
  dataPath: string;
  loggerPrefix?: string;
  fetchImpl?: typeof fetch;
}

export interface WhoopFactoryConfig {
  WHOOP_CLIENT_ID: string;
  WHOOP_CLIENT_SECRET: string;
  WHOOP_REDIRECT_URL: string;
  WHOOP_TOKEN_PATH: string;
  WHOOP_DATA_PATH: string;
}
