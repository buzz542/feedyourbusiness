import { describe, expect, it } from "vitest";
import { renderRemovalDone, renderRemovalReceived } from "./removal";

describe("removal emails", () => {
  const all = [
    renderRemovalReceived(),
    renderRemovalDone({ outcome: "removed" }),
    renderRemovalDone({ outcome: "not_found" }),
  ];

  it("say what happens and when, with no em dash and no images", () => {
    expect(all[0]!.text).toContain("within 30 days");
    expect(all[1]!.text).toContain("we will not store your posts from it again");
    expect(all[2]!.text).toContain("nothing to delete");
    for (const e of all) {
      expect(`${e.subject}${e.text}${e.html}`).not.toContain("—");
      expect(e.html).not.toMatch(/<img/i);
    }
  });
});
