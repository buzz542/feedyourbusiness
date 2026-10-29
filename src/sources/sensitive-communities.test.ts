import { describe, expect, it } from "vitest";
import { isSensitiveCommunity } from "./sensitive-communities";

/** docs/PLAN.md 2.3.7. The founder reviews the list before Reddit is switched on. */

describe("isSensitiveCommunity", () => {
  it.each([
    "depression",
    "Anxiety",
    "r/ADHD",
    "/r/bipolar",
    "mentalhealth",
    "ChronicPain",
    "diabetes",
    "TryingForABaby",
    "infertility",
    "pregnant",
    "stopdrinking",
    "alcoholism",
    "OpiatesRecovery",
    "EatingDisorders",
    "loseit",
    "lgbt",
    "gaybros",
    "asktransgender",
    "TwoXChromosomes",
    "Christianity",
    "islam",
    "Judaism",
    "atheism",
    "exmormon",
    "politics",
    "ukpolitics",
    "Conservative",
    "socialism",
    "Feminism",
    "immigration",
    "asianamerican",
    "legaladvice",
    "Prison",
    "unionize",
    "sexualhealth",
    "onlinedating",
  ])("drops r/%s", (name) => {
    expect(isSensitiveCommunity(name)).toBe(true);
  });

  it.each([
    "SaaS",
    "startups",
    "Entrepreneur",
    "smallbusiness",
    "SideProject",
    "indiehackers",
    "webdev",
    "freelance",
    "marketing",
    "SEO",
    "sales",
    "ecommerce",
    "shopify",
    "nocode",
    "productivity",
    "Notion",
    "selfhosted",
    "datascience",
    "devops",
    "accounting",
    "Bookkeeping",
    "projectmanagement",
    "UXDesign",
    "copywriting",
    "content_marketing",
    "growthhacking",
    "digitalnomad",
    "remotework",
    "history",
    "inventory",
    "storytelling",
    "magazines",
    "trumpet",
    "datarecovery",
    "archivists",
    "incrementalgames",
    "environmental_science",
    "methodology",
    "windowblinds",
    "updating",
    "healthtech",
    "progressivewebapps",
  ])("keeps r/%s", (name) => {
    expect(isSensitiveCommunity(name)).toBe(false);
  });

  it("is false for an empty name", () => {
    expect(isSensitiveCommunity("")).toBe(false);
    expect(isSensitiveCommunity("r/")).toBe(false);
  });
});
