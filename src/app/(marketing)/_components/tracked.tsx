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

/**
 * Records the example as viewed once per page view: when "See an example" takes the visitor there,
 * or when half of it comes on screen after they scrolled. On wide screens it sits beside the hero,
 * so seeing it on load alone would only count page views.
 */
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
    if (!el) return;
    let sent = false;
    const send = () => {
      if (sent) return;
      sent = true;
      sendEvent({ name: "example_viewed" });
    };
    const onHash = () => {
      if (window.location.hash === `#${id}`) send();
    };
    window.addEventListener("hashchange", onHash);
    const observer =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(
            (entries) => {
              if (window.scrollY > 0 && entries.some((e) => e.isIntersecting)) send();
            },
            { threshold: 0.5 },
          );
    observer?.observe(el);
    // The observer reports once on load; a later scroll alone does not re-report a visible box.
    const onScroll = () => {
      const box = el.getBoundingClientRect();
      if (box.top < window.innerHeight && box.bottom > 0) send();
      if (sent) window.removeEventListener("scroll", onScroll);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener("scroll", onScroll);
      observer?.disconnect();
    };
  }, [id]);
  return (
    <div ref={ref} id={id} className={className}>
      {children}
    </div>
  );
}
