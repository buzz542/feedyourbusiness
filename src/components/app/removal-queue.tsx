"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

export interface QueueItem {
  id: string;
  source: string | null;
  linkOrHandle: string;
  contactEmail: string;
  details: string | null;
  dueAt: string;
  targetAt: string;
}

type Act = (id: string) => Promise<{ message: string }>;

const day = (iso: string) => new Date(iso).toISOString().slice(0, 16).replace("T", " ") + " UTC";

/** The removal queue (docs/PLAN.md 4.8), earliest due first. Links are shown as text, not opened. */
export function RemovalQueue({
  items,
  now,
  deleteAndSuppress,
  closeWithoutMatch,
}: {
  items: QueueItem[];
  now: string;
  deleteAndSuppress: Act;
  closeWithoutMatch: Act;
}) {
  const [messages, setMessages] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  async function run(id: string, act: Act) {
    setBusy(id);
    const { message } = await act(id).catch(() => ({ message: "Failed. Try again." }));
    setMessages((m) => ({ ...m, [id]: message }));
    setBusy(null);
  }

  if (items.length === 0) return <p className="text-muted">No open removal requests.</p>;
  return (
    <ol className="flex flex-col gap-4">
      {items.map((item) => (
        <li key={item.id} className="rounded-[2px] border border-rule p-4">
          <p className="text-sm text-muted">
            {item.source ?? "unknown platform"} · due {day(item.dueAt)}
            {item.targetAt < now ? " · past the 72-hour target" : ""}
          </p>
          <p className="mt-1 break-all font-mono text-sm">{item.linkOrHandle}</p>
          <p className="mt-1 text-sm">Reply to: {item.contactEmail}</p>
          {item.details ? <p className="mt-1 text-sm text-muted">{item.details}</p> : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button disabled={busy === item.id} onClick={() => run(item.id, deleteAndSuppress)}>
              Delete and suppress
            </Button>
            <Button
              variant="secondary"
              disabled={busy === item.id}
              onClick={() => run(item.id, closeWithoutMatch)}
            >
              Close: nothing we hold
            </Button>
          </div>
          <p role="status" aria-live="polite" className="mt-2 text-sm">
            {messages[item.id] ?? null}
          </p>
        </li>
      ))}
    </ol>
  );
}
