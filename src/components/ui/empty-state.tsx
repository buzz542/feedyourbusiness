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
    <section className="rounded-[2px] border border-dashed border-rule px-6 py-10 text-center">
      <h2 className="font-serif text-xl tracking-tight">{title}</h2>
      {children ? <div className="mx-auto mt-2 max-w-prose text-muted">{children}</div> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </section>
  );
}
