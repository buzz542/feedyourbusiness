import type { ReactNode } from "react";

/** A legal page drafted for the solicitor (docs/PLAN.md 12.9): marked as a draft, not in force. */
export function LegalDraft({ title, children }: { title: string; children: ReactNode }) {
  return (
    <article className="space-y-6">
      <h1 className="font-serif text-3xl tracking-tight">{title}</h1>
      <p className="rounded-[2px] border border-rule p-3 text-sm text-muted">
        Draft for legal review. It is not in force yet and may change before launch.
      </p>
      {children}
    </article>
  );
}

export function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="space-y-3">
      <h2 id={id} className="font-serif text-2xl tracking-tight">
        {title}
      </h2>
      {children}
    </section>
  );
}
