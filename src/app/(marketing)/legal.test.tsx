import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PROCESSORS } from "@/lib/processors";
import { PROCESSOR_HOSTS } from "@/server/net/hosts";
import { sources } from "@/sources/registry";
import type { CollectSource } from "@/sources/types";
import { SiteFooter } from "./_components/site-footer";
import AcceptableUse from "./acceptable-use/page";
import Cookies from "./cookies/page";
import Privacy from "./privacy/page";
import Terms from "./terms/page";

/** Legal drafts (docs/PLAN.md 12.9). */
const privacy = renderToStaticMarkup(<Privacy />);
const text = privacy.replace(/<[^>]+>/g, " ").replace(/&#x27;|&apos;/g, "'");

describe("legal pages", () => {
  it("every page footer links the legal pages and the sources page", () => {
    const footer = renderToStaticMarkup(<SiteFooter />);
    for (const href of [
      "/privacy",
      "/terms",
      "/acceptable-use",
      "/cookies",
      "/remove-my-post",
      "/sources",
    ])
      expect(footer, href).toContain(`href="${href}"`);
  });

  it("every processor host in hosts.ts belongs to a named processor", () => {
    for (const host of PROCESSOR_HOSTS)
      expect(
        PROCESSORS.some((p) => p.hosts.some((h) => host === h || host.endsWith(`.${h}`))),
        host,
      ).toBe(true);
  });

  it("the privacy notice names every processor, every collect source and every vendor", () => {
    for (const p of PROCESSORS) expect(text, p.name).toContain(p.name);
    const collect = sources.filter((s): s is CollectSource => s.mode === "collect");
    for (const s of collect) expect(text, s.displayName).toContain(s.displayName);
    for (const s of collect.filter((c) => c.vendor))
      expect(text, s.vendor!.name).toContain(s.vendor!.name);
  });

  it("states the vendor's snapshot retention, or that Reddit stays off until it is confirmed", () => {
    expect(text).toMatch(
      /keeps the snapshots it delivers to us for|is being confirmed with Bright Data/,
    );
  });

  it("says this is not a data license from Reddit, and links the removal form", () => {
    expect(text).toContain("This is not a data license from Reddit.");
    expect(privacy).toContain('href="/remove-my-post"');
  });

  it("terms cover the trial, renewal, cancellation, refunds and the age limit", () => {
    const terms = renderToStaticMarkup(<Terms />);
    for (const words of [
      "trial",
      "Cancel any time",
      "refunded",
      "18 and over",
      "cancellation period",
    ])
      expect(terms, words).toContain(words);
  });

  it("acceptable use bans spam, sock puppets and contact lists; cookies are essential only", () => {
    const aup = renderToStaticMarkup(<AcceptableUse />);
    for (const words of ["No spam", "sock puppets", "contact lists"]) expect(aup).toContain(words);
    expect(renderToStaticMarkup(<Cookies />)).toContain("strictly necessary");
  });
});
