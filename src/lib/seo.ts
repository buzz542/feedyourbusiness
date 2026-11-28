import type { Metadata } from "next";

/** The site's address and the words search engines and link previews show (the founder, 28 Nov 2026). */
export const SITE_URL = "https://feedyourbusiness.app";

/** What the product does, in plain words, with no numbers or promises. */
export const SITE_DESCRIPTION =
  "FeedYourBusiness finds public conversations about the problem your product solves, shows why each one matches, and leaves the reply to you, in your own words.";

export const siteMetadata: Pick<Metadata, "metadataBase" | "description" | "openGraph"> = {
  metadataBase: new URL(SITE_URL),
  description: SITE_DESCRIPTION,
  openGraph: {
    siteName: "FeedYourBusiness",
    title: "FeedYourBusiness",
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    type: "website",
  },
};
