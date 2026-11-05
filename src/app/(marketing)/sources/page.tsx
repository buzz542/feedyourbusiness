import type { Metadata } from "next";
import Link from "next/link";
import { sources } from "@/sources/registry";
import { DataProviderNotice } from "../_components/data-provider-notice";
import { SourceList } from "../_components/source-list";

export const metadata: Metadata = {
  title: "Where posts come from",
  description:
    "Every source AskedFor collects from, how, and for how long, including our Reddit data provider.",
};

/** The sources page (docs/PLAN.md 4.2, 9.6 item 4, D12): exactly the registry, nothing hidden. */
export default function Page() {
  return (
    <article>
      <h1 className="font-serif text-3xl tracking-tight">Where posts come from</h1>
      <p className="mt-4">
        AskedFor reads public posts about the problem your product solves and shows you the ones
        worth replying to. This page lists every place those posts come from and how we get them.
      </p>
      <SourceList sources={sources} />
      <DataProviderNotice />
      <section aria-labelledby="own-site" className="mt-8 space-y-3">
        <h2 id="own-site" className="font-serif text-2xl tracking-tight">
          Your own website
        </h2>
        <p>
          When you paste your website, our site reader reads a few pages of it to draft your product
          profile.{" "}
          <Link href="/bot" className="underline">
            How the site reader works
          </Link>
          .
        </p>
      </section>
    </article>
  );
}
