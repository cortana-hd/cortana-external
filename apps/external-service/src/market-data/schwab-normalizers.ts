import type { MarketDataQuote } from "./types.js";

interface JsonRecord {
  [key: string]: unknown;
}

export interface SchwabQuoteEnvelope {
  quote: MarketDataQuote;
  metadata: Record<string, unknown>;
  fundamentals: Record<string, unknown>;
}

export function normalizeSchwabQuoteEnvelope(
  payload: JsonRecord,
  symbol: string,
  asOfDate: string,
): SchwabQuoteEnvelope {
  const candidate =
    (payload[symbol] as JsonRecord | undefined) ??
    (((payload.quotes as JsonRecord | undefined)?.[symbol] as JsonRecord | undefined) ?? {}) ??
    {};
  const quote = ((candidate.quote as JsonRecord | undefined) ?? candidate) as JsonRecord;
  const fundamental = ((candidate.fundamental as JsonRecord | undefined) ?? {}) as JsonRecord;
  const reference = ((candidate.reference as JsonRecord | undefined) ?? {}) as JsonRecord;

  if (!Object.keys(quote).length && !Object.keys(fundamental).length && !Object.keys(reference).length) {
    throw new Error(`Schwab returned no quote payload for ${symbol}`);
  }

  return {
    quote: {
      symbol,
      price: firstNumber(quote.lastPrice, quote.mark, quote.closePrice, quote.bidPrice),
      change: firstNumber(quote.netChange, quote.markChange),
      changePercent: firstNumber(quote.netPercentChange, quote.markPercentChange),
      timestamp: quote.tradeTimeInLong ? new Date(Number(quote.tradeTimeInLong)).toISOString() : new Date().toISOString(),
      currency: firstString(quote.currency, reference.currency) ?? "USD",
      volume: firstNumber(quote.totalVolume, fundamental.avg10DaysVolume),
      week52High: firstNumber(quote["52WeekHigh"], fundamental.high52, fundamental.week52High),
      week52Low: firstNumber(quote["52WeekLow"], fundamental.low52, fundamental.week52Low),
      securityStatus: firstString(quote.securityStatus, quote.securityStatusCd),
    },
    metadata: compactRecord({
      name: firstString(reference.description, quote.description, reference.symbolName, symbol),
      description: firstString(reference.description, quote.description),
      exchange: firstString(reference.exchangeName, reference.exchange),
      asset_main_type: firstString(reference.assetMainType),
      asset_sub_type: firstString(reference.assetSubType),
      cusip: firstString(reference.cusip),
      market_cap: firstNumber(fundamental.marketCap),
      beta: firstNumber(fundamental.beta),
      pe_ratio: firstNumber(fundamental.peRatio),
      dividend_yield: firstNumber(fundamental.dividendYield),
      float_shares: firstNumber(fundamental.floatShares),
      shares_outstanding: firstNumber(fundamental.sharesOutstanding),
      week52_high: firstNumber(quote["52WeekHigh"], fundamental.high52, fundamental.week52High),
      week52_low: firstNumber(quote["52WeekLow"], fundamental.low52, fundamental.week52Low),
      security_status: firstString(quote.securityStatus, quote.securityStatusCd),
      currency: firstString(quote.currency, reference.currency) ?? "USD",
    }),
    fundamentals: compactRecord({
      symbol,
      as_of_date: asOfDate,
      eps_growth: percentOrNone(firstNumber(fundamental.epsChangePercentTTM, fundamental.epsChangePercent)),
      annual_eps_growth: percentOrNone(firstNumber(fundamental.epsChangeYear)),
      revenue_growth: percentOrNone(firstNumber(fundamental.revChangeYear, fundamental.revenueChangePercent)),
      institutional_pct: percentOrNone(firstNumber(fundamental.institutionalOwnership)),
      float_shares: firstNumber(fundamental.floatShares),
      shares_outstanding: firstNumber(fundamental.sharesOutstanding),
      short_ratio: firstNumber(fundamental.shortRatio),
      short_pct_of_float: percentOrNone(firstNumber(fundamental.shortPercentOfFloat)),
      market_cap: firstNumber(fundamental.marketCap),
      beta: firstNumber(fundamental.beta),
      pe_ratio: firstNumber(fundamental.peRatio),
      dividend_yield: percentOrNone(firstNumber(fundamental.dividendYield)),
      sector: firstString(reference.sector),
      industry: firstString(reference.industry),
      earnings_event_window: [],
      last_earnings_date: null,
      next_earnings_date: null,
      earnings_history: [],
      quarterly_financials: [],
      institutional_holders: [],
    }),
  };
}

function compactRecord(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return undefined;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return undefined;
}

function percentOrNone(value: number | undefined): number | null {
  if (value == null || !Number.isFinite(value)) {
    return null;
  }
  if (Math.abs(value) <= 2) {
    return value * 100;
  }
  return value;
}
