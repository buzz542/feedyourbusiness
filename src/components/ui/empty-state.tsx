import type { ReactNode } from "react";

/** What happened and what to do next (docs/PLAN.md 4.9). */
export function EmptyState({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-dashed border-control bg-surface px-6 py-12 text-center">
      <h2 className="font-serif text-xl tracking-tight">{title}</h2>
      {children ? (
        <div className="mx-auto mt-2 max-w-prose text-sm leading-relaxed text-muted">
          {children}
        </div>
      ) : null}
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </section>
  );
}
