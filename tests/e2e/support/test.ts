import { test as base } from "@playwright/test";
import { isLocalRequestUrl } from "./guard";

/**
 * Every spec imports `test` from here. The browser may load our localhost server and nothing else:
 * any other request is aborted, so no test can drive a third-party site.
 */
export const test = base.extend<{ localOnly: void }>({
  localOnly: [
    async ({ context }, use) => {
      await context.route("**/*", (route) =>
        isLocalRequestUrl(route.request().url())
          ? route.continue()
          : route.abort("blockedbyclient"),
      );
      await use();
    },
    { auto: true },
  ],
});

export { expect } from "@playwright/test";
