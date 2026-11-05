import type { Metadata } from "next";
import Link from "next/link";
import { requestRemoval } from "./actions";
import { RemovalForm } from "./removal-form";

export const metadata: Metadata = {
  title: "Remove my post",
  description: "Ask AskedFor to delete a post you wrote and never store your posts again.",
};

/** Remove my post (docs/PLAN.md 2.3.5, 4.8): the public form. Every paragraph has a claims row. */
export default function Page() {
  return (
    <article className="space-y-6">
      <h1 className="font-serif text-3xl tracking-tight">Remove my post</h1>
      <p>
        If AskedFor holds a post you wrote, you can have it removed. We delete the posts we hold
        from you on that platform and add you to our suppression list, so we never store your posts
        from it again.
      </p>
      <p>We handle every request within 30 days, and we aim to do it within 72 hours.</p>
      <RemovalForm submit={requestRemoval} />
      <p className="text-sm text-muted">
        We use your email only to handle this request. More in our{" "}
        <Link href="/privacy" className="underline">
          privacy notice
        </Link>
        .
      </p>
    </article>
  );
}
