import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";
import type { SerializedAgent } from "./shared";

export function AgentsTab({ coreAgents, workerAgents }: { coreAgents: SerializedAgent[]; workerAgents: SerializedAgent[] }) {
  return (
    <div className="space-y-4">
      {workerAgents.length > 0 && (
        <Card className="gap-3 border-primary/25 bg-primary/5 py-4">
          <CardHeader className="gap-1 px-5">
            <CardTitle className="text-sm font-semibold uppercase tracking-wide">Execution Workers</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 px-5">
            {workerAgents.map((agent) => (
              <Link
                key={agent.id}
                href={`/agents/${agent.id}`}
                className="block rounded-lg border bg-background/90 p-3 transition-colors hover:bg-muted/40"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold">{agent.name}</p>
                    <p className="text-sm text-muted-foreground">{agent.role}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Last seen: {agent.lastSeen ? new Date(agent.lastSeen).toLocaleString() : "Unknown"}
                    </p>
                  </div>
                  <StatusBadge value={agent.status} variant="agent" />
                </div>
                {(agent.modelDisplay || agent.model) && (
                  <p className="mt-2 font-mono text-[11px] text-muted-foreground">{agent.modelDisplay || agent.model}</p>
                )}
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      <Card className="gap-3 py-4">
        <CardHeader className="gap-1 px-5">
          <CardTitle className="text-sm font-semibold uppercase tracking-wide">Core Agent Directory</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto px-5">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/70 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Agent</th>
                <th className="px-3 py-2">Role</th>
                <th className="hidden px-3 py-2 sm:table-cell">Capabilities</th>
                <th className="hidden px-3 py-2 sm:table-cell">Model</th>
                <th className="px-3 py-2 text-right">Health</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {coreAgents.map((agent) => (
                <tr key={agent.id} className="border-t transition-colors hover:bg-muted/30">
                  <td className="px-3 py-3">
                    <Link href={`/agents/${agent.id}`} className="group block">
                      <p className="font-semibold group-hover:text-primary">{agent.name}</p>
                      <p className="text-xs text-muted-foreground">
                        Last seen: {agent.lastSeen ? new Date(agent.lastSeen).toLocaleString() : "Unknown"}
                      </p>
                    </Link>
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">{agent.role}</td>
                  <td className="hidden px-3 py-3 text-sm text-muted-foreground sm:table-cell">{agent.capabilities}</td>
                  <td className="hidden px-3 py-3 sm:table-cell">
                    <span className="font-mono text-xs text-muted-foreground">{agent.modelDisplay || agent.model || "—"}</span>
                  </td>
                  <td className="px-3 py-3 text-right text-muted-foreground">
                    {typeof agent.healthScore === "number" ? agent.healthScore.toFixed(1) : "—"}
                  </td>
                  <td className="px-3 py-3"><StatusBadge value={agent.status} variant="agent" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
