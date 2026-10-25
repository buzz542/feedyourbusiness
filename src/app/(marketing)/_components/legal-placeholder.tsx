export function LegalPlaceholder({
  title,
  updated,
  children,
}: {
  title: string;
  updated?: string;
  children?: React.ReactNode;
}) {
  return (
    <article className="legal space-y-4">
      <h1 className="font-serif text-3xl tracking-tight">{title}</h1>
      <p className="text-muted">
        Draft for legal review. {updated ? `Last updated ${updated}. ` : ""}Questions: see the
        contact email in the footer.
      </p>
      {children}
    </article>
  );
}

/** A section heading inside a legal page. */
export function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="mt-8 font-serif text-xl tracking-tight">{children}</h2>;
}
