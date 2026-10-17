import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { REMINDER_CRON_PERIOD_HOURS } from "@/server/billing/constants";

/**
 * Deploy guard for vercel.json and the Node version.
 *
 * Vercel's Hobby plan refuses any cron expression that runs more than once a day, and the refusal
 * fails the whole deployment, previews included. The founder's account is on Hobby until they
 * upgrade, so every schedule here must be Hobby-safe. docs/PLAN.md has the task that switches to
 * the Pro schedule once Pro is confirmed; it changes this test, `REMINDER_CRON_PERIOD_HOURS` and
 * vercel.json in the same commit.
 */

interface VercelConfig {
  $schema?: string;
  regions?: string[];
  crons?: { path: string; schedule: string }[];
}

const config = JSON.parse(readFileSync("vercel.json", "utf8")) as VercelConfig;
const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { engines?: { node?: string } };

const inRange = (value: string, min: number, max: number) =>
  /^\d{1,2}$/.test(value) && Number(value) >= min && Number(value) <= max;

/** One cron field: `*`, or numbers, ranges, lists and steps within bounds. No names (Vercel refuses MON or JAN). */
function validField(field: string, min: number, max: number): boolean {
  if (field === "*") return true;
  return field.split(",").every((part) => {
    const [range, step] = part.split("/");
    if (step !== undefined && !inRange(step, 1, max)) return false;
    if (range === "*") return step !== undefined;
    const [from, to] = (range ?? "").split("-");
    if (!inRange(from ?? "", min, max)) return false;
    return to === undefined || (inRange(to, min, max) && Number(to) >= Number(from));
  });
}

/**
 * A 5-field expression Vercel accepts: values in range, no names, and day of month and day of week
 * never both set (Vercel requires one of them to be `*`).
 */
export function isValidVercelCron(schedule: string): boolean {
  const fields = schedule.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields as [
    string,
    string,
    string,
    string,
    string,
  ];
  return (
    validField(minute, 0, 59) &&
    validField(hour, 0, 23) &&
    validField(dayOfMonth, 1, 31) &&
    validField(month, 1, 12) &&
    validField(dayOfWeek, 0, 6) &&
    (dayOfMonth === "*" || dayOfWeek === "*")
  );
}

/** True when a valid expression fires at most once a day: one fixed minute and one fixed hour. */
export function runsAtMostDaily(schedule: string): boolean {
  if (!isValidVercelCron(schedule)) return false;
  const [minute, hour] = schedule.trim().split(/\s+/);
  return /^\d{1,2}$/.test(minute ?? "") && /^\d{1,2}$/.test(hour ?? "");
}

describe("cron expression checks", () => {
  it.each(["0 7 * * *", "30 6 * * 1", "15 4 1 * *", "0 21 * * 0", "59 23 * * *"])(
    "accepts the daily schedule %s",
    (s) => {
      expect(runsAtMostDaily(s)).toBe(true);
    },
  );

  it.each(["0 * * * *", "*/10 * * * *", "0 */6 * * *", "0 6,18 * * *", "0 6-8 * * *", "* 7 * * *"])(
    "rejects %s, which runs more than once a day",
    (s) => {
      expect(runsAtMostDaily(s)).toBe(false);
    },
  );

  it.each([
    "0 24 * * *",
    "60 7 * * *",
    "0 7 1 * 1",
    "0 7 * * MON",
    "0 7 * JAN *",
    "0 7 * *",
    "0 7 32 * *",
  ])("rejects %s, which Vercel refuses", (s) => {
    expect(isValidVercelCron(s)).toBe(false);
  });

  it("accepts the hourly and ten-minute expressions the Pro schedule will use", () => {
    expect(isValidVercelCron("0 * * * *")).toBe(true);
    expect(isValidVercelCron("*/10 * * * *")).toBe(true);
  });
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

  it("runs the trial reminder at the period the reminder window is built for", () => {
    const reminder = (config.crons ?? []).find((c) => c.path === "/api/cron/trial-reminders");
    expect(reminder).toBeDefined();
    // Every day, not weekdays or weekly: a gap longer than the period would cut the notice.
    if (REMINDER_CRON_PERIOD_HOURS === 24)
      expect(reminder!.schedule).toMatch(/^\d{1,2} \d{1,2} \* \* \*$/);
    else if (REMINDER_CRON_PERIOD_HOURS === 1)
      expect(reminder!.schedule).toMatch(/^\d{1,2} \* \* \* \*$/);
    else throw new Error(`unsupported REMINDER_CRON_PERIOD_HOURS ${REMINDER_CRON_PERIOD_HOURS}`);
  });

  it("schedules the job crons (7.2, 13): daily and weekly now, the tick only on Pro", () => {
    const schedule = (path: string) => (config.crons ?? []).find((c) => c.path === path)?.schedule;
    expect(schedule("/api/cron/daily")).toBe("0 6 * * *");
    expect(schedule("/api/cron/weekly")).toBe("0 21 * * 0");
    if (REMINDER_CRON_PERIOD_HOURS === 24) expect(schedule("/api/cron/tick")).toBeUndefined();
    else expect(schedule("/api/cron/tick")).toBe("*/10 * * * *");
  });

  it("gives every job cron route 300 seconds and the tick route a GET with the secret check", () => {
    for (const path of ["/api/cron/daily", "/api/cron/tick", "/api/cron/weekly"]) {
      const file = `src/app${path}/route.ts`;
      expect(existsSync(file), file).toBe(true);
      const code = readFileSync(file, "utf8");
      expect(code, file).toMatch(/export const maxDuration = 300;/);
      expect(code, file).toMatch(/export async function GET\(/);
      expect(code, file).toContain("isCronAuthorized(request, process.env.CRON_SECRET)");
    }
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
  it("pins Vercel (engines) to the .nvmrc major, no lower than vitest and vite need", () => {
    const major = Number(readFileSync(".nvmrc", "utf8").trim());
    const match = /^>=(\d+)\.(\d+)\.(\d+) <(\d+)$/.exec(pkg.engines?.node ?? "");
    expect(match, `engines.node is "${pkg.engines?.node}"`).not.toBeNull();
    const [, floorMajor, floorMinor, , ceiling] = match!.map(Number);
    expect(floorMajor).toBe(major);
    expect(ceiling).toBe(major + 1);
    // vitest 5 needs ^22.12.0 on Node 22.
    if (major === 22) expect(floorMinor).toBeGreaterThanOrEqual(12);
  });
});
