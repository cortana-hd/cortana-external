"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { FormMode, FormState } from "./cron-types";

type CronJobFormProps = {
  form: FormState;
  onChange: React.Dispatch<React.SetStateAction<FormState>>;
  onSubmit: () => void;
  onCancel: () => void;
  mode: FormMode;
  saving?: boolean;
};

export function CronJobForm({ form, onChange, onSubmit, onCancel, mode }: CronJobFormProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6">
      <Card className="w-full max-w-3xl">
        <CardHeader className="border-b">
          <CardTitle className="text-base">
            {mode === "create" ? "Create cron job" : "Edit cron job"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6 pt-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="cron-name">Name</Label>
              <Input
                id="cron-name"
                value={form.name}
                onChange={(event) =>
                  onChange((prev) => ({ ...prev, name: event.target.value }))
                }
                placeholder="daily-summary"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cron-agent">Agent ID</Label>
              <Input
                id="cron-agent"
                value={form.agentId}
                onChange={(event) =>
                  onChange((prev) => ({ ...prev, agentId: event.target.value }))
                }
                placeholder="agent-01"
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Schedule kind</Label>
              <Select
                value={form.scheduleKind}
                onValueChange={(value) =>
                  onChange((prev) => ({ ...prev, scheduleKind: value }))
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select kind" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cron">Cron expression</SelectItem>
                  <SelectItem value="every">Every</SelectItem>
                  <SelectItem value="at">At time</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="cron-expr">Schedule expression</Label>
              <Input
                id="cron-expr"
                value={form.scheduleExpr}
                onChange={(event) =>
                  onChange((prev) => ({ ...prev, scheduleExpr: event.target.value }))
                }
                placeholder="*/15 * * * *"
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="cron-session">Session target</Label>
              <Input
                id="cron-session"
                value={form.sessionTarget}
                onChange={(event) =>
                  onChange((prev) => ({ ...prev, sessionTarget: event.target.value }))
                }
                placeholder="assistant"
              />
            </div>
            <div className="space-y-2">
              <Label>Delivery mode</Label>
              <Select
                value={form.deliveryMode}
                onValueChange={(value) =>
                  onChange((prev) => ({ ...prev, deliveryMode: value }))
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select delivery" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="channel">Channel</SelectItem>
                  <SelectItem value="direct">Direct</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Payload kind</Label>
                <Select
                  value={form.payloadKind}
                  onValueChange={(value) =>
                    onChange((prev) => ({ ...prev, payloadKind: value }))
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select payload" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="message">Message</SelectItem>
                    <SelectItem value="json">JSON</SelectItem>
                    <SelectItem value="task">Task</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="payload-model">Payload model</Label>
                <Input
                  id="payload-model"
                  value={form.payloadModel}
                  onChange={(event) =>
                    onChange((prev) => ({ ...prev, payloadModel: event.target.value }))
                  }
                  placeholder="gpt-4.1"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="payload-message">Payload message</Label>
              <Textarea
                id="payload-message"
                value={form.payloadMessage}
                onChange={(event) =>
                  onChange((prev) => ({ ...prev, payloadMessage: event.target.value }))
                }
                placeholder="Enter payload instructions"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="payload-timeout">Payload timeout</Label>
              <Input
                id="payload-timeout"
                value={form.payloadTimeout}
                onChange={(event) =>
                  onChange((prev) => ({ ...prev, payloadTimeout: event.target.value }))
                }
                placeholder="60000"
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(event) =>
                  onChange((prev) => ({ ...prev, enabled: event.target.checked }))
                }
                className="h-4 w-4"
              />
              Enabled
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.isolated}
                onChange={(event) =>
                  onChange((prev) => ({ ...prev, isolated: event.target.checked }))
                }
                className="h-4 w-4"
              />
              Isolated
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.agentTurn}
                onChange={(event) =>
                  onChange((prev) => ({ ...prev, agentTurn: event.target.checked }))
                }
                className="h-4 w-4"
              />
              Agent turn
            </label>
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button onClick={onSubmit}>
              {mode === "create" ? "Create job" : "Save changes"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
