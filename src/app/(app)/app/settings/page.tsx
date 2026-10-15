import type { Metadata } from "next";
import { requirePage } from "@/server/auth/app-state";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  await requirePage("settings", "/app/settings");
  return (
    <div>
      <h1 className="font-serif text-3xl tracking-tight">Settings</h1>
      <p className="mt-2 text-muted">Plan and billing, email, product, search terms and sources.</p>
    </div>
  );
}
