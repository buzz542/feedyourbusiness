import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { loadDenylist } from "../../../../compliance/lib/denylist.mjs";
import { checkCopy, claimNumbers } from "../../../../compliance/lib/scan-copy";
import { PROCESSOR_HOSTS } from "@/server/net/hosts";
import { sources } from "@/sources/registry";
import AcceptableUse from "../acceptable-use/page";
import Cookies from "../cookies/page";
import { PROCESSORS } from "../_components/processors";
import { SiteFooter } from "../_components/site-footer";
import Terms from "../terms/page";
import Privacy from "./page";

/** Legal drafts (docs/PLAN.md 12.9, M9). */

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");
const privacy = text(renderToStaticMarkup(<Privacy />));

describe("privacy notice", () => {
  it("names a processor for every processor host in hosts.ts", () => {
    for (const host of PROCESSOR_HOSTS)
      expect(
        PROCESSORS.some((p) => p.hosts.includes(host)),
        host,
      ).toBe(true);
    for (const p of PROCESSORS) expect(privacy).toContain(`${p.name}: ${p.purpose}.`);
  });

  it("names every collect source and every vendor in the registry", () => {
    for (const s of sources) {
      if (s.mode !== "collect") continue;
      expect(privacy).toContain(s.displayName);
      if (s.vendor) expect(privacy).toContain(s.vendor.name);
    }
  });

  it("states the vendor's snapshot retention, or that Reddit stays off until it does", () => {
    expect(privacy).toMatch(/keeps the snapshots it delivers to us (for|will be stated)/);
  });

  it("says retention by source, the removal form, the ICO, and the Google sign-in records", () => {
    expect(privacy).toContain(
      "Reddit and X posts are deleted from AskedFor 7 days after we collect them",
    );
    expect(privacy).toContain("remove my post form");
    expect(privacy).toContain("Information Commissioner");
    expect(privacy).toContain("Google account name and picture address");
  });
});

describe("cookies page", () => {
  it("lists the Supabase session cookie, its numbered parts and the PKCE verifier", () => {
    const cookies = text(renderToStaticMarkup(<Cookies />));
    expect(cookies).toContain("-auth-token");
    expect(cookies).toContain("numbered parts");
    expect(cookies).toContain("-code-verifier");
  });
});

describe("every legal page", () => {
  it("is linked from the footer of every page", () => {
    const footer = renderToStaticMarkup(<SiteFooter />);
    for (const href of [
      "/privacy",
      "/terms",
      "/acceptable-use",
      "/cookies",
      "/remove-my-post",
      "/sources",
    ])
      expect(footer).toContain(`href="${href}"`);
  });

  it("passes the copy gate as rendered, and says it is a draft", () => {
    const claims = claimNumbers(readFileSync("docs/claims.md", "utf8"));
    for (const [name, Page] of [
      ["privacy", Privacy],
      ["terms", Terms],
      ["acceptable-use", AcceptableUse],
      ["cookies", Cookies],
    ] as const) {
      const t = text(renderToStaticMarkup(<Page />));
      expect(t, name).toContain("Draft for legal review.");
      expect(checkCopy([{ text: t, line: 1 }], name, loadDenylist(), claims), name).toEqual([]);
    }
  });
});
