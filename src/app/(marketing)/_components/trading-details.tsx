/**
 * The trading name, geographic address and monitored email UK e-commerce rules require in the
 * footer (docs/PLAN.md 9.6). The founder sets them in Vercel: NEXT_PUBLIC_TRADING_NAME,
 * NEXT_PUBLIC_TRADING_ADDRESS and NEXT_PUBLIC_CONTACT_EMAIL.
 */
export function tradingDetails(env: Readonly<Record<string, string | undefined>> = process.env) {
  const name = env.NEXT_PUBLIC_TRADING_NAME?.trim() || null;
  const address = env.NEXT_PUBLIC_TRADING_ADDRESS?.trim() || null;
  const email = env.NEXT_PUBLIC_CONTACT_EMAIL?.trim() || null;
  return { name, address, email, complete: Boolean(name && address && email) };
}

export function TradingDetails() {
  const t = tradingDetails();
  if (!t.complete)
    return <p className="mt-4">Trading name, address and contact email are added before launch.</p>;
  return (
    <p className="mt-4">
      {t.name}, {t.address}.{" "}
      <a href={`mailto:${t.email}`} className="underline underline-offset-4">
        {t.email}
      </a>
    </p>
  );
}

export function ContactEmail() {
  const email = tradingDetails().email;
  return email ? (
    <a href={`mailto:${email}`} className="underline underline-offset-4">
      {email}
    </a>
  ) : (
    <>the contact email in the footer</>
  );
}
