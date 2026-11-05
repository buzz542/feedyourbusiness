"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

const ERRORS: Record<string, string> = {
  confirmation_mismatch: "Type DELETE in capitals to confirm.",
  delete_failed: "Your account could not be deleted. Nothing was removed. Try again in a minute.",
};

/**
 * Settings, Data (docs/PLAN.md 4.7, 10.6, 10.7): export everything as JSON, and delete the account
 * after typing DELETE.
 */
export function AccountData({
  deleteMyAccount,
}: {
  deleteMyAccount: (typed: string) => Promise<{ error?: string }>;
}) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const result = await deleteMyAccount(typed);
      if (result?.error) setError(ERRORS[result.error] ?? ERRORS.delete_failed!);
    } catch {
      setError(ERRORS.delete_failed!);
    }
    setBusy(false);
  }

  return (
    <section aria-labelledby="data-heading" className="flex flex-col gap-4">
      <h2 id="data-heading" className="font-serif text-xl tracking-tight">
        Your data
      </h2>
      <p className="text-sm">
        <a href="/api/export" download className="text-accent underline">
          Download your data (JSON)
        </a>
        . It has your account, product, search terms, competitors and the links in your feed with
        our labels. Post text is not included.
      </p>
      <div className="flex flex-col gap-2 rounded-[2px] border border-rule p-4">
        <h3 className="font-medium">Delete your account</h3>
        <p className="text-sm text-muted">
          This cancels your subscription at once, with no further charges, and deletes your account,
          product, search terms, competitors and feed. It cannot be undone.
        </p>
        <label className="flex flex-col gap-1 text-sm">
          Type DELETE to confirm
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            className="w-48 rounded-[2px] border border-rule bg-paper px-2 py-1"
          />
        </label>
        <Button
          variant="secondary"
          disabled={typed !== "DELETE" || busy}
          onClick={remove}
          className="self-start"
        >
          Delete my account
        </Button>
        <p role="status" aria-live="polite" className="text-sm text-muted">
          {error}
        </p>
      </div>
    </section>
  );
}
