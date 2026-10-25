import "@fontsource-variable/fraunces";
import { GeistSans } from "geist/font/sans";
import type { Metadata } from "next";
import { siteRobots } from "@/lib/launch";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "AskedFor", template: "%s | AskedFor" },
  description: "Who to reply to today. What your rivals get wrong. What to build next.",
  // Out of search results until the launch switch (src/lib/launch.ts).
  robots: siteRobots(),
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={GeistSans.variable}>
      <body className="min-h-dvh bg-paper text-ink antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:bg-accent focus:px-3 focus:py-2 focus:text-accent-ink"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
