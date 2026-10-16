/**
 * Fixed addresses for E2E users, so the dev server's SIGNUP_ALLOWLIST can include them
 * (playwright.config.ts adds them). Invented, on a reserved test domain. One per Playwright project,
 * so projects never share a user.
 */
export const E2E_PROJECTS = ["desktop", "mobile"] as const;

export const signInEmail = (project: string): string => `e2e-sign-in-${project}@askedfor.test`;

export const allE2EEmails = (): string[] => E2E_PROJECTS.map(signInEmail);
