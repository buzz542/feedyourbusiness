import "server-only";
import { renderRemovalDone, renderRemovalReceived } from "../../../emails/removal";
import { createSourceFetch } from "@/server/net/source-fetch";
import { optionalMailer } from "@/server/pipeline/supabase-first-run";
import type { AdminClient } from "@/server/supabase/admin";
import { sources } from "@/sources/registry";
import type { CollectSource } from "@/sources/types";
import { z } from "zod";
import { authorHasher } from "./author-hash";
import type { RemovalAdminDeps, RemovalSource, RemovalStore } from "./removal";

/** Supabase and source adapters for the removal flow (service role; tables are deny-all). */

const UA = "AskedFor/1.0 (+https://askedfor.app; removal requests)";

export function createRemovalStore(db: AdminClient): RemovalStore {
  return {
    async countSince(ipHash, since) {
      const { count, error } = await db
        .from("removal_requests")
        .select("id", { count: "exact", head: true })
        .eq("ip_hash", ipHash)
        .gte("created_at", since.toISOString());
      if (error) throw new Error("Supabase: could not count requests");
      return count ?? 0;
    },
    async insert(row) {
      const { data, error } = await db.from("removal_requests").insert(row).select("id").single();
      if (error || !data) throw new Error("Supabase: could not store the request");
      return data.id;
    },
  };
}

export async function sendRemovalReceived(to: string): Promise<void> {
  const mailer = optionalMailer();
  if (mailer) await mailer.send({ to, ...renderRemovalReceived() });
}

const collect = (id: string) =>
  sources.find((s): s is CollectSource => s.id === id && s.mode === "collect") ?? null;

/** A GET through the source's own safeFetch (its hosts only, its kill switch respected). */
async function sourceGet(sourceId: string, url: string, headers: Record<string, string> = {}) {
  const source = collect(sourceId);
  if (!source) return null;
  const response = await createSourceFetch(source)(url, {
    headers: { "user-agent": UA, accept: "application/json", ...headers },
  }).catch(() => null);
  return response && response.ok ? ((await response.json().catch(() => null)) as unknown) : null;
}

export function createRemovalAdminDeps(db: AdminClient): RemovalAdminDeps {
  const hash = authorHasher();
  return {
    async load(id) {
      const { data, error } = await db
        .from("removal_requests")
        .select("id, link_or_handle, source, contact_email, status")
        .eq("id", id)
        .maybeSingle();
      if (error) throw new Error("Supabase: could not load the request");
      return data ? { ...data, source: (data.source as RemovalSource | null) ?? null } : null;
    },
    async authorOfPost(source, urls) {
      const { data, error } = await db
        .from("posts")
        .select("author_hash")
        .eq("source", source)
        .in("url", [...urls])
        .limit(1);
      if (error) throw new Error("Supabase: could not look up the post");
      return data?.[0]?.author_hash ?? null;
    },
    async authorKeyOfLink(source, url) {
      if (source === "hackernews") {
        const id = new URL(url).searchParams.get("id");
        const item = z
          .object({ by: z.string().min(1).max(100) })
          .safeParse(
            await sourceGet("hackernews", `https://hacker-news.firebaseio.com/v0/item/${id}.json`),
          );
        return item.success ? item.data.by : null;
      }
      if (source === "bluesky") {
        const segment = /\/profile\/([^/]+)\//.exec(new URL(url).pathname)?.[1] ?? "";
        return segment.startsWith("did:") ? segment : resolveBluesky(segment);
      }
      return null;
    },
    async stableId(source, name) {
      if (source === "bluesky") return resolveBluesky(name);
      if (source === "x") {
        const token = process.env.X_BEARER_TOKEN;
        if (!token || !/^[A-Za-z0-9_]{1,15}$/.test(name)) return null;
        const user = z.object({ data: z.object({ id: z.string().regex(/^\d{1,20}$/) }) }).safeParse(
          await sourceGet("x", `https://api.x.com/2/users/by/username/${name}`, {
            authorization: `Bearer ${token}`,
          }),
        );
        return user.success ? user.data.data.id : null;
      }
      return name;
    },
    hash: (source, key) => hash(source, key),
    async suppress(authorHash, source, reason) {
      const { error } = await db
        .from("suppression")
        .upsert(
          { author_hash: authorHash, source, reason },
          { onConflict: "author_hash,source", ignoreDuplicates: true },
        );
      if (error) throw new Error("Supabase: could not suppress the author");
    },
    async deletePosts(authorHash, source) {
      const { data, error } = await db
        .from("posts")
        .delete()
        .eq("author_hash", authorHash)
        .eq("source", source)
        .select("id");
      if (error) throw new Error("Supabase: could not delete posts");
      return data?.length ?? 0;
    },
    async close(id, status, now) {
      const { error } = await db
        .from("removal_requests")
        .update({ status, handled_at: now.toISOString() })
        .eq("id", id);
      if (error) throw new Error("Supabase: could not close the request");
    },
    async audit(entry) {
      const { error } = await db.from("audit_log").insert(entry);
      if (error) throw new Error("Supabase: could not write the audit log");
    },
    async notify(to, outcome) {
      const mailer = optionalMailer();
      if (mailer) await mailer.send({ to, ...renderRemovalDone(outcome) });
    },
  };
}

async function resolveBluesky(handle: string): Promise<string | null> {
  const clean = handle.replace(/^@/, "").toLowerCase();
  if (!/^[a-z0-9.-]{3,253}$/.test(clean)) return null;
  const result = z
    .object({ did: z.string().regex(/^did:[a-z]+:[A-Za-z0-9._:%-]+$/) })
    .safeParse(
      await sourceGet(
        "bluesky",
        `https://bsky.social/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(clean)}`,
      ),
    );
  return result.success ? result.data.did : null;
}
