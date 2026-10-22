export interface Denylist {
  packages: { blocked: string[]; blockedScopes: string[]; devOnly: string[] };
  networkModules: string[];
  schema: { postTables: string[]; bannedColumnPattern: string; anonGrantsForbidden: boolean };
  copy: {
    scanRoots: string[];
    /** App UI: every copy rule except the claims-number rule. */
    appScanRoots: string[];
    bannedPhrases: string[];
    competitorNames: string[];
    ukSpellings: string[];
  };
  logos: { publicDir: string; imageExtensions: string[]; forbiddenNames: string[] };
}

export function loadDenylist(file?: string): Denylist;
export function packageName(spec: string): string | null;
export function isBlockedPackage(name: string, deny: Denylist): boolean;
export function installTargets(command: string): string[];
