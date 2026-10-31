import { describe, expect, it, vi } from "vitest";
import type { CollectSource } from "@/sources/types";
import { SafeFetchError } from "./safe-fetch";
import { createSourceFetch } from "./source-fetch";

/** Each source's ctx.fetch reaches only that source's hosts (docs/PLAN.md 2.1.9, 7.1). */

const source = (id: string, host: string): CollectSource => ({
  id,
  displayName: id,
  mode: "collect",
  access: "official_api",
  termsUrl: "https://terms.example/",
  allowedHosts: [host],
  linkHosts: [],
  dailyBudget: 10,
  retentionDays: 30,
  costPerUnitUsd: 0,
  credentials: [],
  start: async () => ({ kind: "done", posts: [], units: 0 }),
});

const a = source("alpha", "api.alpha.example");
const b = source("beta", "api.beta.example");
const ON = { SOURCE_ALPHA_ENABLED: "true", SOURCE_BETA_ENABLED: "true" };

describe("createSourceFetch", () => {
  it("reaches its own hosts", async () => {
    const fetchImpl = vi.fn(async () => new Response("ok"));
    const fetchA = createSourceFetch(a, { env: ON, fetchImpl });
    await fetchA("https://api.alpha.example/x");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("refuses another enabled source's host", async () => {
    const fetchImpl = vi.fn(async () => new Response("ok"));
    const fetchA = createSourceFetch(a, { env: ON, fetchImpl });
    const error = await fetchA("https://api.beta.example/x").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SafeFetchError);
    expect((error as SafeFetchError).code).toBe("host_not_allowed");
    expect(fetchImpl).not.toHaveBeenCalled();
    void b;
  });

  it("refuses everything once its kill switch is off, checked on every request", async () => {
    const env: Record<string, string> = { ...ON };
    const fetchImpl = vi.fn(async () => new Response("ok"));
    const fetchA = createSourceFetch(a, { env, fetchImpl });
    await fetchA("https://api.alpha.example/x");
    env.SOURCE_ALPHA_ENABLED = "false";
    await expect(fetchA("https://api.alpha.example/x")).rejects.toBeInstanceOf(SafeFetchError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
