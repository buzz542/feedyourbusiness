import { GeistSans } from "geist/font/sans";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { robotsMeta } from "@/lib/launch";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "FeedYourBusiness", template: "%s | FeedYourBusiness" },
  description: "Who to reply to today. What to build next.",
  // Noindex until LAUNCH_OPEN=true, with src/app/robots.ts (src/lib/launch.ts).
  robots: robotsMeta(),
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={GeistSans.variable}>
      <body className="min-h-dvh bg-paper text-ink antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:bg-accent-fill focus:px-3 focus:py-2 focus:text-accent-ink"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
