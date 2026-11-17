import type { ReactNode } from "react";
import { AppFrame } from "@/components/app/app-frame";
import { loadAccount } from "@/server/auth/account";
import { requireAppUser } from "@/server/auth/session";
import { loadNavCounts } from "@/server/store/feed-supabase";
import { createSupabaseServerClient } from "@/server/supabase/server";

export const dynamic = "force-dynamic";

/**
 * The app frame (docs/PLAN.md 9.5): a side panel on wide screens, a top bar and a tab bar on narrow
 * ones (src/components/app/app-frame.tsx). The layout stays on screen as you move between views,
 * so the side panel never blanks while a page loads. Entitlement is checked by each page (10.4).
 */
export default async function TabsLayout({ children }: { children: ReactNode }) {
  const user = await requireAppUser("/app");
  const supabase = await createSupabaseServerClient();
  const [account, nav] = await Promise.all([
    loadAccount(user.id),
    // The counts are a convenience: if they cannot load, the frame shows the views without them.
    loadNavCounts(supabase, user.id, new Date()).catch((error: unknown) => {
      console.error(
        `[app] nav counts failed: ${error instanceof Error ? error.name : "UnknownError"}`,
      );
      return null;
    }),
  ]);

  return (
    <AppFrame
      productName={account.productName}
      email={user.email}
      counts={nav?.counts ?? null}
      threshold={nav?.threshold ?? null}
    >
      {children}
    </AppFrame>
  );
}
