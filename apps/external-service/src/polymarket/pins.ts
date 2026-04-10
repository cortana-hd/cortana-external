import fs from "node:fs";

import { readJsonFile, resolveFromCwd, writeJsonFileAtomic } from "../lib/files.js";

export type PinnedPolymarketMarket = {
  marketSlug: string;
  bucket: "events" | "sports";
  title: string;
  eventTitle: string | null;
  league: string | null;
  pinnedAt: string;
};

type PinsFilePayload = {
  version: 1;
  markets: PinnedPolymarketMarket[];
};

export class PolymarketPinsStore {
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async list(): Promise<PinnedPolymarketMarket[]> {
    await this.writeChain;
    const payload = await this.read();
    return payload.markets;
  }

  async upsert(market: Omit<PinnedPolymarketMarket, "pinnedAt">): Promise<PinnedPolymarketMarket[]> {
    return this.withWriteLock(async () => {
      const payload = await this.read();
      const nextMarket: PinnedPolymarketMarket = {
        ...market,
        pinnedAt: new Date().toISOString(),
      };
      const deduped = payload.markets.filter((entry) => entry.marketSlug !== market.marketSlug);
      deduped.unshift(nextMarket);
      await this.write({ version: 1, markets: deduped });
      return deduped;
    });
  }

  async remove(marketSlug: string): Promise<PinnedPolymarketMarket[]> {
    return this.withWriteLock(async () => {
      const payload = await this.read();
      const next = payload.markets.filter((entry) => entry.marketSlug !== marketSlug);
      await this.write({ version: 1, markets: next });
      return next;
    });
  }

  private async read(): Promise<PinsFilePayload> {
    const resolved = resolveFromCwd(this.filePath);
    if (!fs.existsSync(resolved)) {
      return { version: 1, markets: [] };
    }

    try {
      const payload = await readJsonFile<PinsFilePayload>(this.filePath);
      return {
        version: 1,
        markets: Array.isArray(payload?.markets) ? payload.markets.filter(isPinnedMarket) : [],
      };
    } catch {
      return { version: 1, markets: [] };
    }
  }

  private async write(payload: PinsFilePayload): Promise<void> {
    await writeJsonFileAtomic(this.filePath, payload);
  }

  private async withWriteLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.writeChain;
    let release = () => {};
    this.writeChain = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

function isPinnedMarket(value: unknown): value is PinnedPolymarketMarket {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  const bucket = record.bucket;
  return (
    typeof record.marketSlug === "string" &&
    typeof record.title === "string" &&
    (bucket === "events" || bucket === "sports")
  );
}
