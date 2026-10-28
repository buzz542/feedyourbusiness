/**
 * Reddit communities whose name alone can reveal a special-category trait of the people who post
 * there (UK GDPR Article 9: health, sex life or sexual orientation, religious or philosophical
 * belief, political opinion, racial or ethnic origin, trade union membership). docs/PLAN.md 2.3.7:
 * posts from them are dropped before classification and storage, and the onboarding draft never
 * suggests them.
 *
 * Exact names plus name fragments. Over-blocking is the safe failure: a dropped community only
 * means fewer posts. Fragments too short to be safe as fragments ("hiv" is inside "archive") are
 * exact names instead. The founder reviews both lists before Reddit is switched on and again in
 * launch week (docs/TASKS.md M3).
 */

const EXACT = new Set([
  "health",
  "ibs",
  "hiv",
  "hivaids",
  "std",
  "stds",
  "ocd",
  "bpd",
  "ttc",
  "babybumps",
  "tryingforababy",
  "leaves",
  "trans",
  "mtf",
  "ftm",
  "enby",
  "sex",
  "sexover30",
  "deadbedrooms",
  "lds",
  "union",
  "unions",
  "indiancountry",
]);

const FRAGMENTS = [
  // health, mental health, disability, addiction, pregnancy
  "depress",
  "anxiety",
  "adhd",
  "autis",
  "asperger",
  "bipolar",
  "schizo",
  "ptsd",
  "suicid",
  "selfharm",
  "mentalhealth",
  "mentalillness",
  "psychiatr",
  "borderline",
  "eatingdisorder",
  "anorexi",
  "bulimi",
  "cancer",
  "diabet",
  "chronicpain",
  "chronicillness",
  "fibromyalgia",
  "migraine",
  "endometriosis",
  "crohn",
  "celiac",
  "epilep",
  "multiplesclerosis",
  "parkinson",
  "alzheimer",
  "dementia",
  "disabilit",
  "disabled",
  "wheelchair",
  "amputee",
  "deaf",
  "pregnan",
  "infertil",
  "miscarriage",
  "abortion",
  "menopause",
  "addict",
  "alcoholi",
  "stopdrinking",
  "sober",
  "opiate",
  "stopsmoking",
  // sex life, sexual orientation, gender identity
  "lgbt",
  "gay",
  "lesbian",
  "bisexual",
  "transgender",
  "transsexual",
  "queer",
  "asexual",
  "intersex",
  "nonbinary",
  "sexual",
  "sexwork",
  "porn",
  "nsfw",
  "onlyfans",
  "kink",
  "bdsm",
  "fetish",
  // religion and belief
  "christian",
  "catholic",
  "protestant",
  "orthodox",
  "mormon",
  "islam",
  "muslim",
  "quran",
  "jewish",
  "judaism",
  "hindu",
  "sikh",
  "buddhis",
  "atheis",
  "agnostic",
  "religio",
  "theolog",
  "bible",
  "church",
  "pagan",
  "wicca",
  // political opinion
  "politic",
  "conservative",
  "liberal",
  "democrat",
  "republican",
  "libertarian",
  "socialis",
  "communis",
  "marxis",
  "anarchis",
  "fascis",
  "trump",
  "biden",
  "labour",
  "tories",
  "brexit",
  "feminis",
  "mensrights",
  // racial or ethnic origin, immigration status
  "blackpeople",
  "africanamerican",
  "asianamerican",
  "latino",
  "latina",
  "hispanic",
  "indigenous",
  "nativeamerican",
  "immigra",
  "refugee",
];

/** A community name as Reddit or a person writes it: "SaaS", "r/SaaS", "/r/SaaS". */
export function normalizeCommunity(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/^\/?r\//, "");
}

export function isSensitiveCommunity(name: string): boolean {
  const n = normalizeCommunity(name);
  return EXACT.has(n) || FRAGMENTS.some((f) => n.includes(f));
}
