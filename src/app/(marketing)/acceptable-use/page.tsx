import type { Metadata } from "next";
import { H2, LegalPlaceholder } from "../_components/legal-placeholder";

export const metadata: Metadata = { title: "Acceptable use" };

/** Acceptable use (docs/PLAN.md 2.2.4, 12.9). Draft for the solicitor. */
export default function Page() {
  return (
    <LegalPlaceholder title="Acceptable use">
      <p>AskedFor is for replying to people in your own words. When you use it, you agree:</p>
      <H2>Reply like a person</H2>
      <ul className="list-disc pl-5">
        <li>Say you built it whenever you mention your own product.</li>
        <li>No spam, and no copy-paste replies sent to many people.</li>
        <li>No fake accounts, sock puppets or paid voting.</li>
        <li>Follow each platform&apos;s own rules and each community&apos;s rules.</li>
      </ul>
      <H2>Respect the people behind the posts</H2>
      <ul className="list-disc pl-5">
        <li>Do not build contact lists, scrape profiles or message people in bulk.</li>
        <li>Do not use AskedFor to track, profile or harass anyone.</li>
        <li>Do not copy posts out of AskedFor to publish them elsewhere.</li>
      </ul>
      <H2>Keep the service working</H2>
      <ul className="list-disc pl-5">
        <li>Do not share your account or try to get around limits or security.</li>
        <li>Do not use AskedFor to collect data to train AI models.</li>
      </ul>
    </LegalPlaceholder>
  );
}
