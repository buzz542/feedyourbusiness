export function LegalPlaceholder({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <article>
      <h1 className="font-serif text-3xl tracking-tight">{title}</h1>
      <p className="mt-4 text-muted">
        This is a draft placeholder and is not in force. The final text is published before launch,
        after review.
      </p>
      {children}
    </article>
  );
}
