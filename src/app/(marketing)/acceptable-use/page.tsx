import type { Metadata } from "next";
import { LegalDraft, Section } from "../_components/legal-draft";

export const metadata: Metadata = { title: "Acceptable use" };

/** The acceptable use policy (docs/PLAN.md 2.2.4, 12.9), drafted for the solicitor. */
export default function Page() {
  return (
    <LegalDraft title="Acceptable use">
      <p>
        AskedFor helps you find people who asked for something like your product, so you can reply
        to them yourself. Use it the way you would want to be found.
      </p>
      <Section id="do" title="Do">
        <ul className="flex list-disc flex-col gap-2 pl-5">
          <li>Reply in your own words, to the post in front of you.</li>
          <li>Say you built it.</li>
          <li>Follow each platform&apos;s own rules, including its rules on self-promotion.</li>
        </ul>
      </Section>
      <Section id="dont" title="Do not">
        <ul className="flex list-disc flex-col gap-2 pl-5">
          <li>Send spam, or the same reply to many people.</li>
          <li>Use fake accounts, or accounts that hide who you are.</li>
          <li>Build contact lists, or collect people&apos;s details from the posts you see.</li>
          <li>Track, profile or contact any person except by replying to their post.</li>
          <li>Use AskedFor if you are under 18.</li>
        </ul>
      </Section>
      <p>We may suspend an account that breaks this policy.</p>
    </LegalDraft>
  );
}
