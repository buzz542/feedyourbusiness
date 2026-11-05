"use client";

import { useState } from "react";

/** Settings, Email (docs/PLAN.md 4.7, 11): each list on or off in one click. */
export function EmailPreferences({
  daily,
  weekly,
  setEmailPreference,
}: {
  daily: boolean;
  weekly: boolean;
  setEmailPreference: (list: "daily" | "weekly", on: boolean) => Promise<{ ok: boolean }>;
}) {
  const [state, setState] = useState({ daily, weekly });
  const [message, setMessage] = useState<string | null>(null);

  async function toggle(list: "daily" | "weekly", on: boolean) {
    setState((s) => ({ ...s, [list]: on }));
    setMessage(null);
    const result = await setEmailPreference(list, on).catch(() => ({ ok: false }));
    if (!result.ok) {
      setState((s) => ({ ...s, [list]: !on }));
      setMessage("That did not save. Try again in a minute.");
    }
  }

  return (
    <section aria-labelledby="email-heading" className="flex flex-col gap-3">
      <h2 id="email-heading" className="font-serif text-xl tracking-tight">
        Email
      </h2>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={state.daily}
          onChange={(e) => toggle("daily", e.target.checked)}
        />
        New posts worth replying to, each morning
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={state.weekly}
          onChange={(e) => toggle("weekly", e.target.checked)}
        />
        Monday digest
      </label>
      <p role="status" aria-live="polite" className="text-sm text-muted">
        {message}
      </p>
    </section>
  );
}
