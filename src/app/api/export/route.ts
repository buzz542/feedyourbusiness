import { loadAccountExport } from "@/server/account/account-server";
import { createExportHandler } from "@/server/account/export-handler";
import { guard } from "@/server/http/respond";
import { createSupabaseServerClient } from "@/server/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return guard(() =>
    createExportHandler({
      async getUser() {
        const supabase = await createSupabaseServerClient();
        const { data, error } = await supabase.auth.getUser();
        if (error || !data.user) return null;
        return { id: data.user.id, email: data.user.email ?? null };
      },
      load: loadAccountExport,
      now: () => new Date(),
    })(),
  );
}
