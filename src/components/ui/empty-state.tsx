import type { ReactNode } from "react";

/** An empty list that says what happened and what to do next (docs/PLAN.md 4.9). */
export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-[2px] border border-dashed border-rule-strong px-6 py-10 text-center">
      <h2 className="font-serif text-xl tracking-tight">{title}</h2>
      <div className="mx-auto mt-2 max-w-prose text-sm text-muted">{body}</div>
      {action ? <div className="mt-5 flex justify-center gap-3">{action}</div> : null}
    </div>
  );
}
