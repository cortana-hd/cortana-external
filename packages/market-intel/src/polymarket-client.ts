import type {
  MarketIntelLogger,
  PolymarketRawEvent,
  PolymarketRawMarket,
  RegistryEntry,
  SelectionSource,
} from "./types.js";
import { matchesKeyword, matchesSelectorFilters } from "./registry.js";
import { getMarketIntelRuntimeConfig } from "./runtime-config.js";
const KEYWORD_PAGE_LIMIT = 200;
const KEYWORD_MAX_PAGES = 5;

export interface PolymarketClientOptions {
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
  retries?: number;
  logger?: MarketIntelLogger;
}

export interface CandidateMarket {
  market: PolymarketRawMarket;
  event: PolymarketRawEvent | null;
  selectionSource: SelectionSource;
}

export class PolymarketClient {
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly logger?: MarketIntelLogger;

  constructor(options: PolymarketClientOptions = {}) {
    const runtimeConfig = getMarketIntelRuntimeConfig();

    this.fetchImpl = options.fetchImpl ?? fetch;
    this.baseUrl = normalizePublicBaseUrl(
      options.baseUrl ?? runtimeConfig.polymarketPublicBaseUrl,
    );
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.retries = options.retries ?? 2;
    this.logger = options.logger;
  }

  async fetchRegistryEntryCandidates(entry: RegistryEntry): Promise<CandidateMarket[]> {
    const exactByMarket = (await this.fetchByMarketSlugs(entry.selectors.marketSlugs)).filter(
      (candidate) =>
        matchesSelectorFilters(
          entry,
          marketHaystack(candidate.event ?? {}, candidate.market),
        ),
    );
    const exactByEvent = (await this.fetchByEventSlugs(entry.selectors.eventSlugs)).filter(
      (candidate) =>
        matchesSelectorFilters(
          entry,
          marketHaystack(candidate.event ?? {}, candidate.market),
        ),
    );
    const combined = dedupeCandidates([...exactByMarket, ...exactByEvent]);

    if (combined.length > 0) {
      return combined;
    }

    if (entry.selectors.keywords.length === 0) {
      return [];
    }

    const fallback = await this.fetchByKeywords(entry);
    return dedupeCandidates(fallback);
  }

  async fetchByMarketSlugs(slugs: string[]): Promise<CandidateMarket[]> {
    const results = await Promise.all(
      slugs.map(async (slug) => {
        const markets = await this.requestCollection<PolymarketRawMarket>("/markets", { slug }, "markets");
        return markets.map((market) => ({
          market,
          event: market.events?.[0] ?? null,
          selectionSource: "market_slug" as const,
        }));
      }),
    );

    return results.flat();
  }

  async fetchByEventSlugs(slugs: string[]): Promise<CandidateMarket[]> {
    const results = await Promise.all(
      slugs.map(async (slug) => {
        const events = await this.requestCollection<PolymarketRawEvent>("/events", { slug }, "events");
        return events.flatMap((event) =>
          (event.markets ?? []).map((market) => ({
            market,
            event,
            selectionSource: "event_slug" as const,
          })),
        );
      }),
    );

    return results.flat();
  }

  async fetchByKeywords(entry: RegistryEntry): Promise<CandidateMarket[]> {
    const events = await this.fetchActiveEvents();

    return events
      .flatMap((event) =>
        (event.markets ?? [])
          .filter((market) =>
            matchesKeyword(entry, marketHaystack(event, market)) &&
            matchesSelectorFilters(entry, marketHaystack(event, market)),
          )
          .map((market) => ({
            market,
            event,
            selectionSource: "keyword_fallback" as const,
          })),
      );
  }

  async fetchActiveEvents(limit = KEYWORD_PAGE_LIMIT, maxPages = KEYWORD_MAX_PAGES): Promise<PolymarketRawEvent[]> {
    const allEvents: PolymarketRawEvent[] = [];

    for (let page = 0; page < maxPages; page += 1) {
      const offset = page * limit;
      const events = await this.requestCollection<PolymarketRawEvent>("/events", {
        active: "true",
        closed: "false",
        limit: String(limit),
        offset: String(offset),
      }, "events");

      allEvents.push(...events);

      if (events.length < limit) {
        break;
      }
    }

    return allEvents;
  }

  async request<T>(pathname: string, query: Record<string, string>): Promise<T> {
    return (await this.requestJson(pathname, query)) as T;
  }

  private async requestCollection<T>(
    pathname: string,
    query: Record<string, string>,
    collectionKey: string,
  ): Promise<T[]> {
    const payload = await this.requestJson(pathname, query);
    return unwrapCollection<T>(payload, collectionKey);
  }

  private async requestJson(pathname: string, query: Record<string, string>): Promise<unknown> {
    const url = new URL(normalizePathname(pathname), this.baseUrl);
    Object.entries(query).forEach(([key, value]) => url.searchParams.set(key, value));

    let lastError: unknown;

    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      const attemptNumber = attempt + 1;

      try {
        this.logger?.debug("polymarket_request_start", {
          pathname,
          query,
          attempt: attemptNumber,
        });
        const response = await this.fetchImpl(url.toString(), {
          method: "GET",
          signal: controller.signal,
          headers: {
            Accept: "application/json",
            "User-Agent": "cortana-market-intel/0.1",
          },
        });

        if (!response.ok) {
          throw new Error(`Polymarket request failed: ${response.status} ${response.statusText}`);
        }

        const parsed = await response.json();
        this.logger?.debug("polymarket_request_success", {
          pathname,
          query,
          attempt: attemptNumber,
        });
        return parsed;
      } catch (error) {
        lastError = error;
        const context = {
          pathname,
          query,
          attempt: attemptNumber,
          error: error instanceof Error ? error.message : String(error),
        };
        if (attempt === this.retries) {
          this.logger?.error("polymarket_request_failed", context);
          throw error;
        }
        this.logger?.warn("polymarket_request_retry", context);
      } finally {
        clearTimeout(timeout);
      }
    }

    throw lastError;
  }
}

function dedupeCandidates(candidates: CandidateMarket[]): CandidateMarket[] {
  const seen = new Set<string>();
  const deduped: CandidateMarket[] = [];

  for (const candidate of candidates) {
    const marketId = String(candidate.market.id ?? candidate.market.slug ?? "");
    const eventId = String(candidate.event?.id ?? candidate.event?.slug ?? "");
    const key = `${marketId}:${eventId}`;

    if (!marketId || seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(candidate);
  }

  return deduped;
}

function marketHaystack(event: PolymarketRawEvent | null, market: PolymarketRawMarket): string {
  return [event?.title, event?.slug, market.question, market.slug, market.description]
    .filter(Boolean)
    .join(" ");
}

function normalizePublicBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/u, "");
  const versioned = trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
  return `${versioned}/`;
}

function normalizePathname(pathname: string): string {
  return pathname.replace(/^\/+/u, "");
}

function unwrapCollection<T>(payload: unknown, collectionKey: string): T[] {
  if (Array.isArray(payload)) {
    return payload as T[];
  }

  if (!payload || typeof payload !== "object") {
    throw new Error(`Polymarket response for ${collectionKey} was not an array or object envelope`);
  }

  const collection = (payload as Record<string, unknown>)[collectionKey];
  if (Array.isArray(collection)) {
    return collection as T[];
  }

  const singularKey =
    collectionKey.endsWith("s") && collectionKey.length > 1
      ? collectionKey.slice(0, -1)
      : collectionKey;
  const singular = (payload as Record<string, unknown>)[singularKey];
  if (singular && typeof singular === "object") {
    return [singular as T];
  }

  throw new Error(`Polymarket response was missing the ${collectionKey} collection`);
}
