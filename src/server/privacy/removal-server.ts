import "server-only";
import { createHmac } from "node:crypto";
import { renderRemovalDone, renderRemovalReceived } from "../../../emails/removal";
import { createResendMailer } from "@/server/email/mailer";
import { createSourceFetch } from "@/server/net/source-fetch";
import { SOURCE_USER_AGENT } from "@/server/pipeline/config";
import { createSupabaseAdminClient } from "@/server/supabase/admin";
import { bluesky, resolveBlueskyHandle } from "@/sources/bluesky";
import type { CollectSource } from "@/sources/types";
import { resolveXUsername, x } from "@/sources/x";
import { authorHasher } from "./author-hash";
import {
  REMOVAL_DAILY_LIMIT,
  RemovalForm,
  type RemovalDeps,
  type RemovalRequest,
  type RemovalSource,
} from "./removal";

class RemovalStoreError extends Error {
  override name = "RemovalStoreError";
  constructor(readonly code: string | undefined) {
    super("Removal store error");
  }
}

const errorName = (e: unknown) => (e instanceof Error ? e.name : "UnknownError");

/** HMAC(APP_HMAC_SECRET, "<UTC day>:<ip>") (docs/PLAN.md 12.5): changes daily, never the IP. */
export function ipHash(ip: string, now: Date, secret = process.env.APP_HMAC_SECRET): string {
  if (!secret || secret.length < 32 || /replace|example|changeme/i.test(secret))
    throw new Error("APP_HMAC_SECRET must be 32 or more random characters");
  return createHmac("sha256", secret)
    .update(`${now.toISOString().slice(0, 10)}:${ip}`)
    .digest("hex");
}

function mailer() {
  try {
    return createResendMailer();
  } catch {
    return null;
  }
}

export type SubmitResult =
  { ok: true } | { ok: false; error: "invalid" | "rate_limited" | "unavailable" };

/** The public form (4.8, 12.7): validated, rate limited per IP hash, then a "received" email. */
export async function submitRemoval(raw: unknown, ip: string): Promise<SubmitResult> {
  const parsed = RemovalForm.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const form = parsed.data;
  const now = new Date();
  try {
    const { data, error } = await createSupabaseAdminClient().rpc("submit_removal_request", {
      p_link_or_handle: form.linkOrHandle,
      p_source: form.source,
      p_contact_email: form.contactEmail,
      p_details: form.details,
      p_ip_hash: ipHash(ip, now),
      p_now: now.toISOString(),
      p_daily_limit: REMOVAL_DAILY_LIMIT,
    });
    if (error) throw new RemovalStoreError(error.code);
    if (!data) return { ok: false, error: "rate_limited" };
  } catch (error) {
    console.error(`[removal] submit failed: ${errorName(error)}`);
    return { ok: false, error: "unavailable" };
  }
  try {
    await mailer()?.send({
      to: form.contactEmail,
      ...renderRemovalReceived(),
    });
  } catch (error) {
    console.error(`[removal] received email failed: ${errorName(error)}`);
  }
  return { ok: true };
}

/** The admin's dependencies (4.8): service role, the sources' own bound fetch for lookups. */
export function removalDeps(): RemovalDeps {
  const admin = createSupabaseAdminClient();
  const hash = authorHasher();
  return {
    async findPostAuthor(source, externalId) {
      const { data, error } = await admin
        .from("posts")
        .select("author_hash")
        .eq("source", source)
        .eq("external_id", externalId)
        .maybeSingle();
      if (error) throw new RemovalStoreError(error.code);
      return data?.author_hash ?? null;
    },
    hash: (source, key) => hash(source, key),
    resolveBlueskyHandle: (handle) =>
      resolveBlueskyHandle(createSourceFetch(bluesky as CollectSource), SOURCE_USER_AGENT, handle),
    async resolveXUsername(username) {
      const token = process.env.X_BEARER_TOKEN;
      if (!token) throw Object.assign(new Error("no X token"), { name: "MissingCredentials" });
      return resolveXUsername(
        createSourceFetch(x as CollectSource),
        token,
        SOURCE_USER_AGENT,
        username,
      );
    },
    async removeAndSuppress(args) {
      const { data, error } = await admin.rpc("remove_and_suppress", {
        p_request_id: args.requestId,
        p_source: args.source,
        p_author_hash: args.authorHash,
        p_external_id: args.externalId ?? undefined,
        p_actor: args.actor,
        p_now: args.now.toISOString(),
      });
      if (error) throw new RemovalStoreError(error.code);
      return data ?? 0;
    },
    async close(requestId, status, actor, now) {
      const { error } = await admin.rpc("close_removal_request", {
        p_request_id: requestId,
        p_status: status,
        p_actor: actor,
        p_now: now.toISOString(),
      });
      if (error) throw new RemovalStoreError(error.code);
    },
    async sendDone(to, outcome) {
      try {
        await mailer()?.send({
          to,
          ...renderRemovalDone({ outcome }),
        });
      } catch (error) {
        console.error(`[removal] done email failed: ${errorName(error)}`);
      }
    },
    now: () => new Date(),
  };
}

export interface OpenRemoval extends RemovalRequest {
  details: string | null;
  createdAt: string;
  targetAt: string;
  dueAt: string;
}

/** Open requests, the earliest due first (4.8). */
export async function listOpenRemovals(): Promise<OpenRemoval[]> {
  const { data, error } = await createSupabaseAdminClient()
    .from("removal_requests")
    .select("id, source, link_or_handle, contact_email, details, created_at, target_at, due_at")
    .in("status", ["received", "verified"])
    .order("due_at")
    .limit(200);
  if (error) throw new RemovalStoreError(error.code);
  return (data ?? []).map((r) => ({
    id: r.id,
    source: (r.source as RemovalSource | null) ?? null,
    linkOrHandle: r.link_or_handle,
    contactEmail: r.contact_email,
    details: r.details,
    createdAt: r.created_at,
    targetAt: r.target_at,
    dueAt: r.due_at,
  }));
}

export async function loadRemoval(id: string): Promise<RemovalRequest | null> {
  const { data, error } = await createSupabaseAdminClient()
    .from("removal_requests")
    .select("id, source, link_or_handle, contact_email, status")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new RemovalStoreError(error.code);
  if (!data || !["received", "verified"].includes(data.status)) return null;
  return {
    id: data.id,
    source: (data.source as RemovalSource | null) ?? null,
    linkOrHandle: data.link_or_handle,
    contactEmail: data.contact_email,
  };
}
