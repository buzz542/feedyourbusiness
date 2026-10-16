import { isBlockedPackage, packageName, type Denylist } from "./denylist.mjs";
import type { Finding } from "./finding";

interface Lockfile {
  packages?: Record<
    string,
    { dev?: boolean; devOptional?: boolean; optional?: boolean; peer?: boolean }
  >;
}

interface PackageJson {
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/** "node_modules/a/node_modules/@b/c" -> "@b/c" */
export function lockfileName(key: string): string | null {
  const at = key.lastIndexOf("node_modules/");
  return at === -1 ? null : key.slice(at + "node_modules/".length);
}

/**
 * `compliance:deps`: fails if a denylisted package is anywhere in the dependency tree
 * (including transitive), or if a dev-only package (Playwright, for localhost E2E) is a
 * production dependency.
 */
export function findBlockedPackages(
  lockfile: Lockfile,
  pkg: PackageJson,
  deny: Denylist,
): Finding[] {
  const findings: Finding[] = [];
  const add = (file: string, rule: string, detail: string) =>
    findings.push({ file, line: 1, rule, detail });

  for (const section of ["dependencies", "optionalDependencies", "devDependencies"] as const) {
    for (const name of Object.keys(pkg[section] ?? {})) {
      if (isBlockedPackage(name, deny)) {
        add(
          "package.json",
          "blocked-package",
          `${section} lists "${name}", which the hard compliance rules forbid`,
        );
      }
    }
  }

  const prod = new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.optionalDependencies ?? {}),
  ]);
  for (const name of deny.packages.devOnly) {
    if (prod.has(name))
      add(
        "package.json",
        "dev-only-package",
        `"${name}" may only be a devDependency (localhost E2E only)`,
      );
  }

  for (const [key, entry] of Object.entries(lockfile.packages ?? {})) {
    const name = lockfileName(key);
    if (!name) continue;
    if (isBlockedPackage(name, deny)) {
      add(
        "package-lock.json",
        "blocked-package",
        `"${key}" is in the lockfile. Find what pulls it in and remove it.`,
      );
    }
    const normalized = packageName(name);
    // npm marks dev installs with dev; a production install has no dev key at all. devOptional
    // means a dev dependency that is also an optional peer of a production one: next 16 declares
    // @playwright/test that way, so npm cannot write anything else for it. Note that
    // `npm ci --omit=dev` still installs devOptional packages, so this check does not prove
    // Playwright stays out of a production install; package.json (checked above) keeps it out of
    // dependencies, and no app code imports it, so it never reaches a deployed bundle.
    const devInstall = entry.dev === true || entry.devOptional === true;
    if (normalized && deny.packages.devOnly.includes(normalized) && !devInstall) {
      add(
        "package-lock.json",
        "dev-only-package",
        `"${key}" is installed as a production dependency`,
      );
    }
  }
  return findings;
}
