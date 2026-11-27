"use client";

import Link from "next/link";
import { useEffect, useRef, type ReactNode } from "react";
import { recordHomeEvent } from "./actions";

type PublicEvent =
  | { name: "cta_clicked"; placement: "nav" | "hero" | "pricing" | "final" }
  | { name: "example_viewed" };

/**
 * One of the homepage's two events, through a server action (the founder's redesign brief): no
 * cookie, no storage, no third party. Never throws: measuring must not get in the way of the click.
 */
export function sendEvent(event: PublicEvent): void {
  recordHomeEvent(event).catch(() => undefined);
}

/** The primary CTA, recording where it was clicked. */
export function CtaLink({
  placement,
  href,
  className,
  children,
}: {
  placement: "nav" | "hero" | "pricing" | "final";
  href: string;
  className: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={className}
      onClick={() => sendEvent({ name: "cta_clicked", placement })}
    >
      {children}
    </Link>
  );
}

/** Records the example as viewed once per page view, when half of it is on screen. */
export function ExampleViewed({
  id,
  className,
  children,
}: {
  id: string;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          sendEvent({ name: "example_viewed" });
          observer.disconnect();
        }
      },
      { threshold: 0.5 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={ref} id={id} className={className}>
      {children}
    </div>
  );
}
