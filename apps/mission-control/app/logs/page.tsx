import Link from "next/link";
import { AutoRefresh } from "@/components/auto-refresh";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { LogFilters, getLogEntries } from "@/lib/logs";
import { TranscriptFilters, getTranscriptMessages } from "@/lib/transcripts";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const ranges = [6, 24, 48, 168];

const timeFmt = new Intl.DateTimeFormat("en-US", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

const formatTimestamp = (iso: string) => timeFmt.format(new Date(iso));

const parseNum = (value?: string) => {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const normalizeFilter = (value?: string) => {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "all") return undefined;
  return trimmed;
};

const humanize = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (m) => m.toUpperCase());

const severityVariant = (value: string) => {
  const normalized = value.toLowerCase();
  if (["critical", "error", "failed"].some((key) => normalized.includes(key))) return "destructive" as const;
  if (normalized.includes("warn")) return "warning" as const;
  if (["success", "ok", "done"].some((key) => normalized.includes(key))) return "success" as const;
  return "info" as const;
};

const statusVariant = (value: string) => {
  const normalized = value.toLowerCase();
  if (normalized === "running") return "info" as const;
  if (normalized === "decided") return "success" as const;
  if (normalized === "failed") return "destructive" as const;
  return "secondary" as const;
};

const buildHref = (params: URLSearchParams, updates: Record<string, string | undefined>) => {
  const next = new URLSearchParams(params.toString());
  Object.entries(updates).forEach(([key, value]) => {
    if (!value || value === "all") next.delete(key);
    else next.set(key, value);
  });
  const query = next.toString();
  return query ? `/logs?${query}` : "/logs";
};

const pruneParamsForView = (params: URLSearchParams, view: "logs" | "transcripts") => {
  const transcriptKeys = new Set(["sessionId", "speakerId", "messageType"]);
  const logKeys = new Set(["severity", "source", "eventType"]);
  const next = new URLSearchParams();

  params.forEach((value, key) => {
    if (view === "logs" && transcriptKeys.has(key)) return;
    if (view === "transcripts" && logKeys.has(key)) return;
    next.set(key, value);
  });

  next.set("view", view);
  return next;
};

const SearchForm = ({
  params,
  placeholder,
}: {
  params: URLSearchParams;
  placeholder: string;
}) => {
  const entries = Array.from(params.entries()).filter(([key]) => key !== "query");
  return (
    <form action="/logs" method="get" className="flex flex-wrap items-center gap-2">
      {entries.map(([key, value]) => (
        <input key={`${key}-${value}`} type="hidden" name={key} value={value} />
      ))}
      <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center">
        <Input name="query" placeholder={placeholder} defaultValue={params.get("query") ?? ""} />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" variant="secondary">Search</Button>
          {params.get("query") ? (
            <Link href={buildHref(params, { query: undefined })} className="text-xs text-muted-foreground hover:text-foreground">
              Clear
            </Link>
          ) : null}
        </div>
      </div>
    </form>
  );
};

export default async function LogsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | undefined>>;
}) {
  const params = (await searchParams) ?? {};
  const view = params.view === "transcripts" ? "transcripts" : "logs";

  const rangeHours = parseNum(params.rangeHours) ?? 24;
  const limit = parseNum(params.limit) ?? 160;

  const logFilters: LogFilters = {
    rangeHours,
    limit,
    severity: normalizeFilter(params.severity),
    source: normalizeFilter(params.source),
    eventType: normalizeFilter(params.eventType),
    query: normalizeFilter(params.query),
  };

  const transcriptFilters: TranscriptFilters = {
    rangeHours,
    limit,
    sessionId: normalizeFilter(params.sessionId),
    speakerId: normalizeFilter(params.speakerId),
    messageType: normalizeFilter(params.messageType),
    query: normalizeFilter(params.query),
  };

  const baseParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value) baseParams.set(key, value);
  });
  const activeParams = pruneParamsForView(baseParams, view);

  const [logsData, transcriptData] = await Promise.all([
    view === "logs" ? getLogEntries(logFilters) : Promise.resolve(null),
    view === "transcripts" ? getTranscriptMessages(transcriptFilters) : Promise.resolve(null),
  ]);

  const severityOptions = logsData?.facets.severities.length
    ? logsData.facets.severities
    : ["info", "warning", "error", "critical"];
  const sourceOptions = logsData?.facets.sources ?? [];

  const speakerOptions = transcriptData?.facets.speakers ?? [];
  const messageTypeOptions = transcriptData?.facets.messageTypes ?? [];
  const sessionOptions = transcriptData?.facets.sessions ?? [];

  return (
    <div className="space-y-6">
      <AutoRefresh />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">Observability</p>
          <h1 className="text-3xl font-semibold tracking-tight">Logs & Transcripts</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Review system events and browse council transcripts with quick filters.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href={buildHref(pruneParamsForView(activeParams, "logs"), { view: "logs" })}>
            <Badge variant={view === "logs" ? "secondary" : "outline"}>Logs</Badge>
          </Link>
          <Link href={buildHref(pruneParamsForView(activeParams, "transcripts"), { view: "transcripts" })}>
            <Badge variant={view === "transcripts" ? "secondary" : "outline"}>Transcripts</Badge>
          </Link>
        </div>
      </div>

      {view === "logs" && logsData ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{logsData.logs.length} entries</Badge>
            <Badge variant="outline">source: {logsData.source}</Badge>
          </div>

          {logsData.warning ? (
            <Card className="border-warning/40 bg-warning/10">
              <CardHeader>
                <CardTitle className="text-base">Fallback mode</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">{logsData.warning}</CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Log filters</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Range</span>
                {ranges.map((hours) => (
                  <Link key={hours} href={buildHref(activeParams, { rangeHours: String(hours) })}>
                    <Badge variant={String(rangeHours) === String(hours) ? "secondary" : "outline"}>
                      {hours < 24 ? `${hours}h` : `${Math.round(hours / 24)}d`}
                    </Badge>
                  </Link>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Severity</span>
                <Link href={buildHref(activeParams, { severity: "all" })}>
                  <Badge variant={!logFilters.severity ? "secondary" : "outline"}>All</Badge>
                </Link>
                {severityOptions.map((severity) => (
                  <Link key={severity} href={buildHref(activeParams, { severity })}>
                    <Badge variant={logFilters.severity === severity ? "secondary" : "outline"}>
                      {humanize(severity)}
                    </Badge>
                  </Link>
                ))}
              </div>

              {sourceOptions.length > 0 ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Source</span>
                  <Link href={buildHref(activeParams, { source: "all" })}>
                    <Badge variant={!logFilters.source ? "secondary" : "outline"}>All</Badge>
                  </Link>
                  {sourceOptions.map((source) => (
                    <Link key={source} href={buildHref(activeParams, { source })}>
                      <Badge variant={logFilters.source === source ? "secondary" : "outline"}>{source}</Badge>
                    </Link>
                  ))}
                </div>
              ) : null}

              <SearchForm params={activeParams} placeholder="Search message, event type, or source" />
            </CardContent>
          </Card>

          <div className="space-y-3">
            {logsData.logs.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-sm text-muted-foreground">No log entries match the current filters.</CardContent>
              </Card>
            ) : (
              logsData.logs.map((entry) => (
                <div
                  key={entry.id}
                  className="rounded-lg border bg-card/60 p-3 shadow-sm"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted-foreground">{formatTimestamp(entry.timestamp)}</span>
                    <Badge variant={severityVariant(entry.severity)}>{humanize(entry.severity)}</Badge>
                    <Badge variant="outline" className="font-mono text-[10px]">{entry.source}</Badge>
                    <span className="text-xs uppercase tracking-wide text-muted-foreground">{entry.eventType.replaceAll("_", " ")}</span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-foreground/90">{entry.message || entry.eventType}</p>
                </div>
              ))
            )}
          </div>
        </>
      ) : null}

      {view === "transcripts" && transcriptData ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{transcriptData.messages.length} messages</Badge>
            <Badge variant="outline">source: {transcriptData.source}</Badge>
          </div>

          {transcriptData.warning ? (
            <Card className="border-warning/40 bg-warning/10">
              <CardHeader>
                <CardTitle className="text-base">Fallback mode</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">{transcriptData.warning}</CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Transcript filters</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Range</span>
                {ranges.map((hours) => (
                  <Link key={hours} href={buildHref(activeParams, { rangeHours: String(hours) })}>
                    <Badge variant={String(rangeHours) === String(hours) ? "secondary" : "outline"}>
                      {hours < 24 ? `${hours}h` : `${Math.round(hours / 24)}d`}
                    </Badge>
                  </Link>
                ))}
              </div>

              {messageTypeOptions.length > 0 ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Message Type</span>
                  <Link href={buildHref(activeParams, { messageType: "all" })}>
                    <Badge variant={!transcriptFilters.messageType ? "secondary" : "outline"}>All</Badge>
                  </Link>
                  {messageTypeOptions.map((type) => (
                    <Link key={type} href={buildHref(activeParams, { messageType: type })}>
                      <Badge variant={transcriptFilters.messageType === type ? "secondary" : "outline"}>{type}</Badge>
                    </Link>
                  ))}
                </div>
              ) : null}

              {speakerOptions.length > 0 ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Speaker</span>
                  <Link href={buildHref(activeParams, { speakerId: "all" })}>
                    <Badge variant={!transcriptFilters.speakerId ? "secondary" : "outline"}>All</Badge>
                  </Link>
                  {speakerOptions.map((speaker) => (
                    <Link key={speaker} href={buildHref(activeParams, { speakerId: speaker })}>
                      <Badge variant={transcriptFilters.speakerId === speaker ? "secondary" : "outline"}>{speaker}</Badge>
                    </Link>
                  ))}
                </div>
              ) : null}

              {sessionOptions.length > 0 ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Session</span>
                  <Link href={buildHref(activeParams, { sessionId: "all" })}>
                    <Badge variant={!transcriptFilters.sessionId ? "secondary" : "outline"}>All</Badge>
                  </Link>
                  {sessionOptions.slice(0, 6).map((session) => (
                    <Link key={session.id} href={buildHref(activeParams, { sessionId: session.id })}>
                      <Badge
                        variant={transcriptFilters.sessionId === session.id ? "secondary" : "outline"}
                        className="max-w-[180px]"
                        title={session.id}
                      >
                        <span className="truncate">{session.topic || session.id}</span>
                      </Badge>
                    </Link>
                  ))}
                </div>
              ) : null}

              <SearchForm params={activeParams} placeholder="Search speaker, topic, or content" />
            </CardContent>
          </Card>

          <div className="space-y-3">
            {transcriptData.messages.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-sm text-muted-foreground">No transcript messages match the current filters.</CardContent>
              </Card>
            ) : (
              transcriptData.messages.map((message) => (
                <div
                  key={message.id}
                  className="rounded-lg border bg-card/60 p-3 shadow-sm"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted-foreground">{formatTimestamp(message.createdAt)}</span>
                    <Badge variant="outline" className="font-mono text-[10px]">T{message.turnNo}</Badge>
                    <Badge variant="secondary" className="text-[10px]">{message.speakerId}</Badge>
                    <Badge variant="outline" className="text-[10px]">{message.messageType}</Badge>
                    <Badge variant={statusVariant(message.sessionStatus)} className="text-[10px]">
                      {message.sessionStatus}
                    </Badge>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground/80">{message.sessionTopic}</span>
                    <span className="rounded border border-border px-1.5 py-0.5 text-[10px] font-mono">
                      {message.sessionId}
                    </span>
                    <span className="text-[10px] uppercase tracking-wide">{message.sessionMode}</span>
                  </div>
                  <p className={cn("mt-2 whitespace-pre-wrap text-sm text-foreground/90")}>{message.content}</p>
                </div>
              ))
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
