import { describe, expect, it } from "vitest";
import { isProfileCommunity, isSensitiveCommunity } from "./sensitive-communities";

/** Communities whose name next to an author hash could reveal a special-category trait (2.3.7). */
describe("isSensitiveCommunity", () => {
  it.each([
    // health, mental health, disability, reproductive health
    "depression",
    "Anxiety",
    "SuicideWatch",
    "mentalhealth",
    "ADHD",
    "autism",
    "bipolar",
    "cancer",
    "diabetes_t1",
    "ChronicPain",
    "stopdrinking",
    "leaves",
    "TryingForABaby",
    "infertility",
    "ttc",
    "disability",
    "HealthAnxiety",
    // sex life and sexual orientation, gender identity
    "lgbt",
    "gay",
    "actuallesbians",
    "bisexual",
    "asexuality",
    "transgender",
    "trans",
    "ftm",
    "NonBinary",
    "sex",
    // religion and belief
    "Christianity",
    "Catholicism",
    "islam",
    "exmuslim",
    "exmormon",
    "Judaism",
    "hinduism",
    "Buddhism",
    "atheism",
    "religion",
    // politics
    "politics",
    "ukpolitics",
    "Conservative",
    "Liberal",
    "democrats",
    "Republican",
    "socialism",
    "Libertarian",
    // racial or ethnic origin
    "AsianAmerican",
    "blackladies",
    "Latinos",
    "IndigenousPeoples",
    // trade unions, criminal offences, genetic data
    "union",
    "LaborUnion",
    "Prison",
    "felons",
    "genetics",
    "hiv",
    "the_donald",
    // as given with a prefix
    "r/depression",
    "/r/politics",
  ])("drops %s", (name) => {
    expect(isSensitiveCommunity(name)).toBe(true);
  });

  it.each([
    "SaaS",
    "startups",
    "Entrepreneur",
    "smallbusiness",
    "webdev",
    "freelance",
    "indiehackers",
    "translation",
    "transit",
    "godot",
    "sussex",
    "Essex",
    "painting",
    "PainPoints",
    "sideproject",
    "productivity",
    "marketing",
    "accounting",
    "Bookkeeping",
    "reunion",
    "archiveteam",
    "DataHoarder",
    "trumpet",
  ])("keeps %s", (name) => {
    expect(isSensitiveCommunity(name)).toBe(false);
  });
});

describe("isProfileCommunity", () => {
  it.each(["u_someone", "U_Someone", "r/u_someone", "u/someone", "user/someone"])(
    "spots the profile %s",
    (name) => {
      expect(isProfileCommunity(name)).toBe(true);
    },
  );

  it.each(["SaaS", "ui_design", "uk"])("keeps %s", (name) => {
    expect(isProfileCommunity(name)).toBe(false);
  });
});
