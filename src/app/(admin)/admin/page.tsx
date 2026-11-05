import type { Metadata } from "next";
import { AdminViewsPanel } from "@/components/app/admin-views";
import { RemovalQueue } from "@/components/app/removal-queue";
import { loadAdminViews } from "@/server/admin/load";
import { requireAdmin } from "@/server/auth/admin";
import { listOpenRemovals } from "@/server/privacy/removal-server";
import { closeWithoutMatch, deleteAndSuppress } from "./actions";

export const metadata: Metadata = { title: "Admin", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** Admin (docs/PLAN.md 4.8): the removal queue, then source health, costs and metrics. */
export default async function AdminPage() {
  await requireAdmin();
  const [items, views] = await Promise.all([listOpenRemovals(), loadAdminViews()]);
  return (
    <main id="main" className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <h1 className="mb-6 font-serif text-3xl tracking-tight">Removal requests</h1>
      <RemovalQueue
        items={items}
        now={new Date().toISOString()}
        deleteAndSuppress={deleteAndSuppress}
        closeWithoutMatch={closeWithoutMatch}
      />
      <div className="mt-12">
        <AdminViewsPanel views={views} />
      </div>
    </main>
  );
}
