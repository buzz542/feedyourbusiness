import { describe, expect, it } from "vitest";
import { isSensitiveCommunity } from "./sensitive-communities";

/**
 * docs/PLAN.md 2.3.7: a community name next to an author hash can reveal a special-category trait,
 * so Reddit posts from such communities are dropped before classification and storage, and the
 * onboarding draft never suggests them. Over-blocking is the safe failure.
 */
describe("isSensitiveCommunity", () => {
  it.each([
    // health, mental health and disability
    "depression",
    "Anxiety",
    "ADHD",
    "autism",
    "bipolar",
    "ptsd",
    "SuicideWatch",
    "mentalhealth",
    "ChronicPain",
    "diabetes_t1",
    "cancer",
    "HIV",
    "ibs",
    "disability",
    "EatingDisorders",
    "stopdrinking",
    "opiates",
    "infertility",
    "BabyBumps",
    "TryingForABaby",
    "abortion",
    // sex life and sexual orientation, gender identity
    "lgbt",
    "gaybros",
    "actuallesbians",
    "bisexual",
    "asktransgender",
    "trans",
    "NonBinary",
    "asexuality",
    "sex",
    "DeadBedrooms",
    // religion and belief
    "Christianity",
    "Catholicism",
    "islam",
    "exmuslim",
    "Judaism",
    "hinduism",
    "Buddhism",
    "atheism",
    "exmormon",
    "lds",
    // politics and trade unions
    "politics",
    "Conservative",
    "Liberal",
    "democrats",
    "Republican",
    "socialism",
    "Libertarian",
    "LabourUK",
    "ukpolitics",
    "union",
    // racial or ethnic origin, immigration
    "BlackPeopleTwitter",
    "asianamerican",
    "Latinos",
    "IndianCountry",
    "immigration",
    "Refugees",
  ])("drops r/%s", (name) => {
    expect(isSensitiveCommunity(name)).toBe(true);
  });

  it("reads r/ and /r/ prefixes and any case", () => {
    for (const name of ["r/depression", "/r/Depression", " R/DEPRESSION "])
      expect(isSensitiveCommunity(name), name).toBe(true);
  });

  it.each([
    "SaaS",
    "startups",
    "Entrepreneur",
    "smallbusiness",
    "webdev",
    "programming",
    "freelance",
    "marketing",
    "SideProject",
    "indiehackers",
    "productivity",
    "translation",
    "transit",
    "datarecovery",
    "selfhosted",
    "accounting",
    "Bookkeeping",
    "ecommerce",
    "devops",
    "healthIT",
  ])("keeps r/%s", (name) => {
    expect(isSensitiveCommunity(name)).toBe(false);
  });
});
