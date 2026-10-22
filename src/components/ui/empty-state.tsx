import type { ReactNode } from "react";

/** What to show when a list is empty: say what happened and what to do next (docs/PLAN.md 4.9). */
export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-[2px] border border-dashed border-rule px-6 py-10 text-center">
      <h2 className="font-serif text-xl">{title}</h2>
      {children ? (
        <div className="mx-auto mt-2 max-w-prose text-sm text-muted">{children}</div>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
