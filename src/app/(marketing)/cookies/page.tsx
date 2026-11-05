import type { Metadata } from "next";
import { LegalDraft, Section } from "../_components/legal-draft";

export const metadata: Metadata = { title: "Cookies" };

/** Cookies (docs/PLAN.md 2.3.9, 12.9): essential only, each one listed. */
export default function Page() {
  return (
    <LegalDraft title="Cookies">
      <p>
        AskedFor uses only the cookies that signing in needs. We use no advertising, analytics or
        tracking cookies, so we do not ask for consent to them.
      </p>
      <Section id="list" title="The cookies we set">
        <ul className="flex list-disc flex-col gap-2 pl-5">
          <li>
            The sign-in session (named sb-, then our project id, then -auth-token). It keeps you
            signed in. When it is large it is split into numbered parts with the same name. It is
            removed when you sign out.
          </li>
          <li>
            The sign-in check (the same name, ending in -code-verifier). It is set when you ask for
            a sign-in link and used once to finish signing in.
          </li>
        </ul>
        <p>Both are set only when you sign in, and only on our own site.</p>
      </Section>
    </LegalDraft>
  );
}
