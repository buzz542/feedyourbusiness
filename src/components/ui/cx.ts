/** Join class names, skipping empty ones. Small enough not to need a dependency. */
export const cx = (...parts: Array<string | false | null | undefined>): string =>
  parts.filter(Boolean).join(" ");
