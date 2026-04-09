"use client";

import * as React from "react";
import {
  Activity,
  ChevronDown,
  Database,
  ExternalLink,
  KeyRound,
  PlugZap,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { TabLayout } from "./tabs/shared";
import type {
  WorkspaceData,
  WorkspaceEnvFile,
  WorkspaceField,
  WorkspaceHealthItem,
  WorkspaceHealthTone,
  WorkspaceSection,
} from "@/lib/service-workspace";

type WorkspaceRouteResponse =
  | { status: "ok"; data: WorkspaceData }
  | { status: "error"; message: string };

const POLL_MS = 45_000;
const CACHE_MAX_AGE_MS = 5 * 60_000;

/* ── module-level cache so data survives tab switches ── */
let cachedWorkspace: WorkspaceData | null = null;
let cachedAt = 0;

const toneStyles: Record<WorkspaceHealthTone, { badge: React.ComponentProps<typeof Badge>["variant"]; dot: string; border: string }> = {
  healthy: { badge: "success", dot: "bg-emerald-500", border: "border-l-emerald-500 dark:border-l-emerald-400" },
  degraded: { badge: "warning", dot: "bg-amber-500", border: "border-l-amber-500 dark:border-l-amber-400" },
  unhealthy: { badge: "destructive", dot: "bg-red-500", border: "border-l-red-500 dark:border-l-red-400" },
  unknown: { badge: "outline", dot: "bg-muted-foreground", border: "border-l-border" },
};

const formatUpdatedAt = (value: string) => {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "Unknown" : d.toLocaleString();
};

const makeFieldId = (field: Pick<WorkspaceField, "fileId" | "key">) => `${field.fileId}:${field.key}`;

async function requestWorkspace(init?: RequestInit): Promise<WorkspaceData> {
  const response = await fetch("/api/services/workspace", { cache: "no-store", ...init });
  const payload = (await response.json()) as WorkspaceRouteResponse;
  if (!response.ok || payload.status !== "ok") throw new Error(payload.status === "error" ? payload.message : "Request failed");
  return payload.data;
}

async function requestActionUrl(action: "whoop-auth-url" | "schwab-auth-url") {
  const response = await fetch(`/api/services/actions/${action}`, { cache: "no-store" });
  const payload = (await response.json()) as { status: "ok"; url: string } | { status: "error"; message: string };
  if (!response.ok || payload.status !== "ok") throw new Error(payload.status === "error" ? payload.message : "Action failed");
  return payload.url;
}

function hydrateDrafts(data: WorkspaceData) {
  const drafts: Record<string, string> = {};
  for (const field of data.sections.flatMap((s) => s.fields)) {
    drafts[makeFieldId(field)] = field.input === "secret" ? "" : field.currentValue;
  }
  return drafts;
}

function sectionDirtyCount(section: WorkspaceSection, drafts: Record<string, string>, clearRequested: Record<string, boolean>) {
  return section.fields.filter((f) => isFieldDirty(f, drafts, clearRequested)).length;
}

function isFieldDirty(field: WorkspaceField, drafts: Record<string, string>, clearRequested: Record<string, boolean>) {
  const id = makeFieldId(field);
  if (field.input === "secret") return Boolean(clearRequested[id]) || (drafts[id]?.trim().length ?? 0) > 0;
  return (drafts[id] ?? "") !== field.currentValue;
}

function buildUpdates(data: WorkspaceData, drafts: Record<string, string>, clearRequested: Record<string, boolean>) {
  return data.sections.flatMap((section) =>
    section.fields.flatMap((field) => {
      const id = makeFieldId(field);
      const next = drafts[id] ?? "";
      if (field.input === "secret") {
        if (clearRequested[id]) return [{ fileId: field.fileId, key: field.key, value: null }];
        if (next.trim().length > 0) return [{ fileId: field.fileId, key: field.key, value: next }];
        return [];
      }
      if (next === field.currentValue) return [];
      return [{ fileId: field.fileId, key: field.key, value: next.trim().length > 0 ? next : null }];
    }),
  );
}

/* ── main component ── */

export default function ServicesClient() {
  const [data, setData] = React.useState<WorkspaceData | null>(() => cachedWorkspace);
  const [drafts, setDrafts] = React.useState<Record<string, string>>(() =>
    cachedWorkspace ? hydrateDrafts(cachedWorkspace) : {},
  );
  const [clearRequested, setClearRequested] = React.useState<Record<string, boolean>>({});
  const [loading, setLoading] = React.useState(!cachedWorkspace);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [isSaving, startSaving] = React.useTransition();
  const [isRefreshing, startRefreshing] = React.useTransition();
  const [authAction, setAuthAction] = React.useState<"whoop-auth-url" | "schwab-auth-url" | null>(null);
  const [collapsedSections, setCollapsedSections] = React.useState<Set<string>>(new Set());

  const loadWorkspace = React.useCallback(async (options?: { preserveDrafts?: boolean }) => {
    const nextData = await requestWorkspace();
    cachedWorkspace = nextData;
    cachedAt = Date.now();
    setData(nextData);
    if (!options?.preserveDrafts) { setDrafts(hydrateDrafts(nextData)); setClearRequested({}); }
  }, []);

  React.useEffect(() => {
    let active = true;
    const cacheAge = Date.now() - cachedAt;
    if (cachedWorkspace && cacheAge < CACHE_MAX_AGE_MS) return;
    const run = async () => {
      try {
        setLoading(true); setError(null);
        const nextData = await requestWorkspace();
        if (!active) return;
        cachedWorkspace = nextData;
        cachedAt = Date.now();
        setData(nextData); setDrafts(hydrateDrafts(nextData)); setClearRequested({});
      } catch (e) { if (active) setError(e instanceof Error ? e.message : "Failed to load."); }
      finally { if (active) setLoading(false); }
    };
    void run();
    return () => { active = false; };
  }, []);

  const dirtyCount = React.useMemo(() => {
    if (!data) return 0;
    return data.sections.reduce((t, s) => t + sectionDirtyCount(s, drafts, clearRequested), 0);
  }, [clearRequested, data, drafts]);

  React.useEffect(() => {
    const interval = window.setInterval(() => {
      if (dirtyCount > 0) return;
      startRefreshing(() => { void loadWorkspace({ preserveDrafts: false }).catch(() => {}); });
    }, POLL_MS);
    return () => window.clearInterval(interval);
  }, [dirtyCount, loadWorkspace]);

  const handleSave = () => {
    if (!data) return;
    setNotice(null); setError(null);
    const updates = buildUpdates(data, drafts, clearRequested);
    if (updates.length === 0) { setNotice("No changes to save."); return; }
    startSaving(() => {
      void (async () => {
        try {
          const nextData = await requestWorkspace({ method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ updates }) });
          cachedWorkspace = nextData;
          cachedAt = Date.now();
          setData(nextData); setDrafts(hydrateDrafts(nextData)); setClearRequested({});
          setNotice("Configuration saved. Restart the affected service to apply env changes.");
        } catch (e) { setError(e instanceof Error ? e.message : "Save failed."); }
      })();
    });
  };

  const [manualRefreshing, setManualRefreshing] = React.useState(false);
  const handleRefresh = () => {
    setNotice(null); setError(null); setManualRefreshing(true);
    void loadWorkspace({ preserveDrafts: dirtyCount > 0 })
      .catch((e) => { setError(e instanceof Error ? e.message : "Refresh failed."); })
      .finally(() => setManualRefreshing(false));
  };

  const handleAuth = (action: "whoop-auth-url" | "schwab-auth-url") => {
    setAuthAction(action); setError(null); setNotice(null);
    void (async () => {
      try {
        const url = await requestActionUrl(action);
        window.open(url, "_blank", "noopener,noreferrer");
        setNotice(action === "whoop-auth-url" ? "Opened Whoop OAuth flow in a new tab." : "Opened Schwab OAuth flow in a new tab.");
      } catch (e) { setError(e instanceof Error ? e.message : "Failed to launch auth flow."); }
      finally { setAuthAction(null); }
    })();
  };

  const toggleSection = (id: string) => {
    setCollapsedSections((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };

  if (!data && !loading) return <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm">{error ?? "Services workspace unavailable."}</div>;

  const isLoading = loading && !data;

  return (
    <TabLayout
      title="Configuration"
      subtitle={data ? `${data.sections.length} config groups · ${data.files.length} env files · Updated ${formatUpdatedAt(data.generatedAt)}` : undefined}
      badge={dirtyCount > 0 ? <Badge variant="warning" className="text-[10px]">{dirtyCount} unsaved</Badge> : undefined}
      actions={
        <>
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={manualRefreshing || isSaving || isLoading}>
            <RefreshCw className={cn("h-3.5 w-3.5", manualRefreshing && "animate-spin")} />
            Refresh
          </Button>
          <Button size="sm" onClick={handleSave} disabled={isSaving || dirtyCount === 0 || isLoading}>
            <Save className="h-3.5 w-3.5" />
            {isSaving ? "Saving..." : `Save${dirtyCount > 0 ? ` (${dirtyCount})` : ""}`}
          </Button>
        </>
      }
    >

      {/* ── Notices ── */}
      {error && <div className="rounded-lg border border-red-200 bg-red-50/70 px-4 py-2.5 text-sm text-red-900 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-200">{error}</div>}
      {notice && <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 px-4 py-2.5 text-sm text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-200">{notice}</div>}

      {/* ── OAuth quick actions ── */}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => handleAuth("schwab-auth-url")} disabled={authAction != null || isLoading}>
          <ExternalLink className="h-3.5 w-3.5" /> Schwab OAuth
        </Button>
        <Button variant="outline" size="sm" onClick={() => handleAuth("whoop-auth-url")} disabled={authAction != null || isLoading}>
          <ExternalLink className="h-3.5 w-3.5" /> Whoop OAuth
        </Button>
      </div>

      {/* ── Health strip ── */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-lg border border-border/50 bg-card/40 p-3 animate-pulse">
              <div className="h-3 w-24 rounded bg-muted/50" />
              <div className="mt-2 h-4 w-32 rounded bg-muted/50" />
              <div className="mt-1 h-3 w-40 rounded bg-muted/40" />
            </div>
          ))
        ) : data ? (
          data.health.slice(0, 4).map((item) => (
            <HealthCard key={item.id} item={item} />
          ))
        ) : null}
      </div>

      {/* ── Additional health (collapsible) ── */}
      {data && data.health.length > 4 && (
        <details className="rounded-lg border border-border/50 bg-muted/10 px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
            {(data?.health.length ?? 0) - 4} more health checks
          </summary>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {data?.health.slice(4).map((item) => (
              <HealthCard key={item.id} item={item} />
            ))}
          </div>
        </details>
      )}

      {/* ── Config sections (collapsible) ── */}
      {isLoading && (
        Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-border/50 bg-card/30 animate-pulse">
            <div className="flex items-center justify-between px-4 py-3">
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <div className="h-4 w-32 rounded bg-muted/50" />
                  <div className="h-4 w-14 rounded-full bg-muted/40" />
                </div>
                <div className="h-3 w-48 rounded bg-muted/40" />
              </div>
              <div className="h-4 w-4 rounded bg-muted/30" />
            </div>
            <div className="border-t border-border/40 px-4 py-4">
              <div className="grid gap-3 md:grid-cols-2">
                {Array.from({ length: i === 0 ? 4 : 3 }).map((_, j) => (
                  <div key={j} className="space-y-1.5 rounded-lg border border-border/30 bg-muted/5 p-3">
                    <div className="h-3 w-20 rounded bg-muted/40" />
                    <div className="h-8 w-full rounded bg-muted/30" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))
      )}
      {data?.sections.map((section) => {
        const dirty = sectionDirtyCount(section, drafts, clearRequested);
        const isCollapsed = collapsedSections.has(section.id);

        return (
          <section key={section.id} id={section.id} className="rounded-lg border border-border/50 bg-card/30">
            <button
              type="button"
              onClick={() => toggleSection(section.id)}
              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold">{section.label}</h3>
                  <Badge variant="outline" className="text-[10px]">{section.fields.length} fields</Badge>
                  {dirty > 0 ? <Badge variant="warning" className="text-[10px]">{dirty} pending</Badge> : <Badge variant="success" className="text-[10px]">synced</Badge>}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">{section.description}</p>
              </div>
              <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", !isCollapsed && "rotate-180")} />
            </button>

            {!isCollapsed && (
              <div className="border-t border-border/40 px-4 py-4">
                <div className="grid gap-3 md:grid-cols-2">
                  {section.fields.map((field) => {
                    const fieldId = makeFieldId(field);
                    return (
                      <FieldEditor
                        key={fieldId}
                        field={field}
                        value={drafts[fieldId] ?? ""}
                        clearRequested={Boolean(clearRequested[fieldId])}
                        onChange={(v) => setDrafts((c) => ({ ...c, [fieldId]: v }))}
                        onToggleClear={() => setClearRequested((c) => ({ ...c, [fieldId]: !c[fieldId] }))}
                      />
                    );
                  })}
                </div>
              </div>
            )}
          </section>
        );
      })}

      {/* ── Env files (collapsible) ── */}
      {data && (
        <details className="rounded-lg border border-border/50 bg-card/30 px-4 py-3">
          <summary className="cursor-pointer text-sm font-semibold">
            Env file inventory
            <span className="ml-2 text-xs font-normal text-muted-foreground">{data.files.length} files</span>
          </summary>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            {data.files.map((file) => <EnvFileCard key={file.id} file={file} />)}
          </div>
        </details>
      )}

      {/* ── Post-save guidance ── */}
      <div className="rounded-lg border border-border/50 bg-muted/10 px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">After you save</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <GuideItem icon={Database} title="Mission Control" body="Restart after .env.local changes." />
          <GuideItem icon={PlugZap} title="External Service" body="Restart after root .env changes." />
          <GuideItem icon={ShieldCheck} title="OAuth" body="Keep TLS paths aligned with callback URLs." />
          <GuideItem icon={Sparkles} title="Docs" body={data?.openclawDocsPath ?? "—"} />
        </div>
      </div>
    </TabLayout>
  );
}

/* ── sub-components ── */

function HealthCard({ item }: { item: WorkspaceHealthItem }) {
  const tone = toneStyles[item.tone];
  const Icon = item.id === "openclaw-gateway" ? ShieldCheck : item.id === "external-service" ? Activity : item.id === "market-data" ? Database : KeyRound;

  return (
    <div className={cn("rounded-lg border border-border/50 bg-card/40 p-3 border-l-[3px]", tone.border)}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-semibold uppercase tracking-wide">{item.label}</span>
        </div>
        <Badge variant={tone.badge} className="text-[10px]">{item.tone}</Badge>
      </div>
      <p className="mt-1.5 text-sm font-medium">{item.summary}</p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{item.detail}</p>
    </div>
  );
}

function FieldEditor({ field, value, clearRequested, onChange, onToggleClear }: {
  field: WorkspaceField; value: string; clearRequested: boolean;
  onChange: (v: string) => void; onToggleClear: () => void;
}) {
  const fieldId = makeFieldId(field);
  const dirty = field.input === "secret" ? clearRequested || value.trim().length > 0 : value !== field.currentValue;

  return (
    <div className="rounded-lg border border-border/40 bg-muted/10 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <Label htmlFor={fieldId} className="text-sm font-medium">{field.label}</Label>
        <div className="flex flex-wrap items-center gap-1">
          {dirty && <Badge variant="warning" className="text-[10px]">dirty</Badge>}
          {field.input === "secret" ? (
            field.hasValue ? <Badge variant="outline" className="text-[10px]">{field.secretPreview}</Badge> : <Badge variant="outline" className="text-[10px]">empty</Badge>
          ) : field.hasValue ? (
            <Badge variant="success" className="text-[10px]">set</Badge>
          ) : field.usesDefault ? (
            <Badge variant="secondary" className="text-[10px]">default</Badge>
          ) : (
            <Badge variant="outline" className="text-[10px]">unset</Badge>
          )}
          {clearRequested && <Badge variant="destructive" className="text-[10px]">clear</Badge>}
        </div>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">{field.help}</p>

      <div className="mt-2">
        {field.input === "textarea" ? (
          <Textarea id={fieldId} value={value} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder} className="min-h-[80px] bg-background/80 text-sm" />
        ) : field.input === "select" ? (
          <Select value={value || field.defaultValue || ""} onValueChange={onChange}>
            <SelectTrigger id={fieldId} className="bg-background/80 text-sm"><SelectValue placeholder={field.placeholder ?? "Select"} /></SelectTrigger>
            <SelectContent>{(field.options ?? []).map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
          </Select>
        ) : (
          <Input id={fieldId} type={field.input === "secret" ? "password" : "text"} value={value} onChange={(e) => onChange(e.target.value)} placeholder={field.input === "secret" && field.hasValue ? "Paste new value to replace" : field.placeholder} className="bg-background/80 text-sm" />
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span>Source: {field.hasValue ? "env file" : field.usesDefault ? `default (${field.defaultValue})` : "not set"}</span>
        {field.input === "secret" && field.hasValue && (
          <button type="button" onClick={onToggleClear} className="text-[11px] text-muted-foreground hover:text-foreground hover:underline">
            {clearRequested ? "Keep stored" : "Clear value"}
          </button>
        )}
      </div>
    </div>
  );
}

function EnvFileCard({ file }: { file: WorkspaceEnvFile }) {
  return (
    <div className="rounded-lg border border-border/40 bg-muted/10 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{file.label}</span>
          <Badge variant={file.exists ? "success" : "warning"} className="text-[10px]">{file.exists ? "present" : "will create"}</Badge>
        </div>
        <Badge variant="outline" className="text-[10px]">{file.modeledKeys} modeled</Badge>
      </div>
      <p className="mt-1 font-mono text-[11px] text-muted-foreground">{file.path}</p>
      {file.extraKeys.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {file.extraKeys.map((k) => <Badge key={k} variant="outline" className="text-[10px]">{k}</Badge>)}
        </div>
      )}
    </div>
  );
}

function GuideItem({ icon: Icon, title, body }: { icon: React.ComponentType<{ className?: string }>; title: string; body: string }) {
  return (
    <div className="flex items-start gap-2 text-xs">
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <div>
        <p className="font-medium">{title}</p>
        <p className="text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}

