/**
 * Where a card action returns to. Only a Reply, Rivals or Build URL in this app: the field comes
 * from a form, so it is user input, and anything else falls back to the Reply tab.
 */
export function safeBack(raw: unknown): string {
  const value = typeof raw === "string" ? raw : "";
  return /^\/app\/(reply|rivals|build)(\?[A-Za-z0-9\-._~=&%+*]*)?$/.test(value)
    ? value
    : "/app/reply";
}
