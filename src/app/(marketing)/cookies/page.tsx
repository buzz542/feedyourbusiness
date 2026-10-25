import type { Metadata } from "next";
import { H2, LegalPlaceholder } from "../_components/legal-placeholder";

export const metadata: Metadata = { title: "Cookies" };

/** Cookies (docs/PLAN.md 2.3.9): essential only, listed. Draft for the solicitor. */
export default function Page() {
  return (
    <LegalPlaceholder title="Cookies">
      <p>
        AskedFor uses only cookies that are strictly necessary to keep you signed in. There are no
        analytics, advertising or tracking cookies, so there is nothing to accept or decline.
      </p>
      <H2>The cookies we set</H2>
      <ul className="list-disc pl-5">
        <li>
          Sign-in session (names starting with &quot;sb-&quot;): set by our sign-in provider,
          Supabase, when you sign in. They keep you signed in and are removed when you sign out.
        </li>
        <li>
          Sign-in verifier (a name ending in &quot;code-verifier&quot;): set for a few minutes while
          a sign-in link or Google sign-in completes.
        </li>
      </ul>
      <p>If you never sign in, AskedFor sets no cookies.</p>
    </LegalPlaceholder>
  );
}
