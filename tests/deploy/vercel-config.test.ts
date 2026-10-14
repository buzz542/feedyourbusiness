import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Deploy guard for vercel.json and the Node version.
 *
 * Vercel's Hobby plan refuses any cron expression that runs more than once a day, and the refusal
 * fails the whole deployment, previews included. The founder's account is on Hobby until they
 * upgrade, so every schedule here must be Hobby-safe. Docs/PLAN.md has the task that switches the
 * trial reminder to hourly once the Pro plan is confirmed; it changes this test in the same commit.
 */

interface VercelConfig {
  $schema?: string;
  regions?: string[];
  crons?: { path: string; schedule: string }[];
}

const config = JSON.parse(readFileSync("vercel.json", "utf8")) as VercelConfig;
const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { engines?: { node?: string } };

/** True when a 5-field cron expression fires at most once a day: one fixed minute, one fixed hour. */
export function runsAtMostDaily(schedule: string): boolean {
  const fields = schedule.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  const [minute, hour] = fields;
  return /^\d{1,2}$/.test(minute ?? "") && /^\d{1,2}$/.test(hour ?? "");
}

describe("runsAtMostDaily", () => {
  it.each(["0 7 * * *", "30 6 * * 1", "15 4 1 * *"])("accepts %s", (s) => {
    expect(runsAtMostDaily(s)).toBe(true);
  });
  it.each(["0 * * * *", "*/10 * * * *", "0 */6 * * *", "0 6,18 * * *", "0 6-8 * * *", "* 7 * * *"])(
    "rejects %s, which Hobby refuses",
    (s) => {
      expect(runsAtMostDaily(s)).toBe(false);
    },
  );
});

describe("vercel.json", () => {
  it("declares the schema so editors and Vercel validate it", () => {
    expect(config.$schema).toBe("https://openapi.vercel.sh/vercel.json");
  });

  it("runs functions in London, next to the Supabase database (eu-west-2)", () => {
    expect(config.regions).toEqual(["lhr1"]);
  });

  it("only declares cron schedules the Hobby plan accepts", () => {
    const crons = config.crons ?? [];
    expect(crons.length).toBeGreaterThan(0);
    for (const cron of crons) expect(runsAtMostDaily(cron.schedule), cron.schedule).toBe(true);
  });

  it("points every cron at a GET route that checks CRON_SECRET", () => {
    for (const cron of config.crons ?? []) {
      const file = `src/app${cron.path}/route.ts`;
      expect(existsSync(file), file).toBe(true);
      const code = readFileSync(file, "utf8");
      expect(code).toMatch(/export async function GET\(/);
      expect(code).toContain("isCronAuthorized(request, process.env.CRON_SECRET)");
    }
  });
});

describe("Node version", () => {
  it("pins the same major on Vercel (engines) as CI and local (.nvmrc)", () => {
    const nvmrc = readFileSync(".nvmrc", "utf8").trim();
    expect(pkg.engines?.node).toBe(`${nvmrc}.x`);
  });
});
