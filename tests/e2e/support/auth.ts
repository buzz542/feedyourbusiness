import type { BrowserContext } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Sign-in for E2E without email or a third-party page: create a confirmed user with the admin API,
 * generate a magic link for it, verify the link's token server-side with @supabase/ssr, and put the
 * session cookies it sets into the browser context. The browser stays on localhost throughout.
 * Needs the development project's keys (docs/PLAN.md F12); the production project is refused.
 */

export interface E2EConfig {
  url: string;
  publishableKey: string;
  secretKey: string;
}

/** The production project. E2E creates and deletes users, so it must never run against it. */
export const PRODUCTION_SUPABASE_HOST = "hoqbflkszzoojdswbrgy.supabase.co";

export function e2eConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): E2EConfig | null {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const secretKey = env.SUPABASE_SECRET_KEY;
  if (!url || !publishableKey || !secretKey) return null;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    throw new Error("E2E: NEXT_PUBLIC_SUPABASE_URL is not a URL");
  }
  if (host === PRODUCTION_SUPABASE_HOST)
    throw new Error(
      "E2E refuses the production Supabase project. Use the development project (F12).",
    );
  // Fail closed: only a hosted Supabase project (not production) or a local Supabase stack.
  if (!host.endsWith(".supabase.co") && host !== "localhost" && host !== "127.0.0.1")
    throw new Error("E2E only runs against the development Supabase project (F12).");
  return { url, publishableKey, secretKey };
}

export const SKIP_REASON =
  "Skipped: set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY " +
  "for the development Supabase project (in the shell or .env.local) to run sign-in E2E (docs/PLAN.md F12).";

const admin = (c: E2EConfig): SupabaseClient =>
  createClient(c.url, c.secretKey, { auth: { persistSession: false, autoRefreshToken: false } });

/**
 * Sign a new user in for this browser context. `onCreated` gets the user id as soon as it exists,
 * so cleanup runs even if a later step fails. A leftover user is an error: delete it first.
 */
export async function signIn(
  context: BrowserContext,
  baseURL: string,
  email: string,
  config: E2EConfig,
  onCreated: (userId: string) => void,
): Promise<void> {
  const client = admin(config);
  const created = await client.auth.admin.createUser({ email, email_confirm: true });
  if (created.error || !created.data.user)
    throw new Error(
      `createUser failed: ${created.error?.code ?? "no user"} (delete leftover users first)`,
    );
  onCreated(created.data.user.id);

  const link = await client.auth.admin.generateLink({ type: "magiclink", email });
  if (link.error || !link.data.user) throw new Error("generateLink failed");

  const cookies: { name: string; value: string }[] = [];
  const ssr = createServerClient(config.url, config.publishableKey, {
    cookies: { getAll: () => [], setAll: (toSet) => void cookies.push(...toSet) },
  });
  const verified = await ssr.auth.verifyOtp({
    token_hash: link.data.properties.hashed_token,
    type: "magiclink",
  });
  if (verified.error) throw new Error(`verifyOtp failed: ${verified.error.name}`);

  await context.addCookies(
    cookies.map(({ name, value }) => ({ name, value, url: baseURL, sameSite: "Lax" as const })),
  );
}

/** Delete test users (cascades to every row they own). Throws if any delete fails. */
export async function deleteUsers(config: E2EConfig, ids: readonly string[]): Promise<void> {
  const client = admin(config);
  for (const id of ids) {
    const { error } = await client.auth.admin.deleteUser(id);
    if (error) throw new Error(`deleteUser failed: ${error.code ?? error.name}`);
  }
}

/** Remove a leftover user from an earlier interrupted run, searching every page of users. */
export async function deleteUserByEmail(config: E2EConfig, email: string): Promise<void> {
  const client = admin(config);
  for (let page = 1; ; page++) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers failed: ${error.code ?? error.name}`);
    const user = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (user) return deleteUsers(config, [user.id]);
    if (data.users.length < 200) return;
  }
}

/** The user's product as stored, read with the admin client, for checks the UI cannot show. */
export async function productOf(
  config: E2EConfig,
  userId: string,
): Promise<{ name: string; status: string; confirmed_at: string | null } | null> {
  const { data, error } = await admin(config)
    .from("products")
    .select("name, status, confirmed_at")
    .eq("owner_id", userId)
    .maybeSingle();
  if (error) throw new Error(`products read failed: ${error.code}`);
  return data;
}

/**
 * A ready account for the Reply tab: terms accepted, an active product, a trialing subscription,
 * and `cards` synthetic posts (invented text, reserved hosts) linked to the product.
 */
export async function seedReadyAccount(
  config: E2EConfig,
  userId: string,
  cards: number,
): Promise<string> {
  const client = admin(config);
  const now = Date.now();
  const must = (r: { error: { code?: string } | null }, what: string) => {
    if (r.error) throw new Error(`${what} failed: ${r.error.code ?? "error"}`);
  };
  must(
    await client
      .from("profiles")
      .update({
        terms_accepted_at: new Date(now).toISOString(),
        subscription_status: "trialing",
        plan: "pro",
      })
      .eq("id", userId),
    "profile update",
  );
  const product = await client
    .from("products")
    .insert({
      owner_id: userId,
      url: "https://invoicer.example.test",
      name: "Invoicer",
      status: "active",
      confirmed_at: new Date(now).toISOString(),
    })
    .select("id")
    .single();
  must(product, "product insert");
  const productId = (product.data as { id: string }).id;
  const posts = Array.from({ length: cards }, (_, i) => ({
    source: "hackernews",
    external_id: `e2e-${userId.slice(0, 8)}-${i}`,
    url: `https://news.ycombinator.com/item?id=${900000000 + i}`,
    excerpt: `Synthetic post ${i}: is there a tool that sends invoice reminders for me?`,
    posted_at: new Date(now - i * 60_000).toISOString(),
    collected_at: new Date(now).toISOString(),
    delete_after: new Date(now + 29 * 86_400_000).toISOString(),
    author_hash: `e2e-hash-${i}`,
    community: "Hacker News",
  }));
  const inserted = await client.from("posts").insert(posts).select("id");
  must(inserted, "posts insert");
  const links = (inserted.data as { id: string }[]).map((p, i) => ({
    product_id: productId,
    post_id: p.id,
    relevance: 95 - (i % 50),
    category: "looking_for_tool",
    reason: "Asks for a tool that sends invoice reminders",
  }));
  must(await client.from("product_posts").insert(links), "links insert");
  return productId;
}

/** Remove the synthetic posts a seeded account left (posts are not owned by the user). */
export async function deleteSeededPosts(config: E2EConfig, userId: string): Promise<void> {
  await admin(config)
    .from("posts")
    .delete()
    .like("external_id", `e2e-${userId.slice(0, 8)}-%`);
}
