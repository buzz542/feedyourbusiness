/**
 * Sensitive communities (docs/PLAN.md 2.3.7). A community name next to an author hash can reveal a
 * special-category trait (UK GDPR Article 9: health, sex life or sexual orientation, religious or
 * philosophical belief, political opinion, racial or ethnic origin, trade union membership, genetic
 * data; and Article 10: criminal offences). Reddit posts from these communities are dropped before
 * classification and storage, and the onboarding draft never suggests them.
 *
 * It errs toward dropping: a missed relevant post costs little, a stored sensitive one costs a lot.
 * The founder reviews this file before Reddit is switched on and again in launch week.
 */

/** Exact names, lowercase: short or ambiguous names a pattern would over-match. */
const NAMES = new Set([
  // health
  "aa",
  "ibs",
  "bpd",
  "ocd",
  "ttc",
  "leaves",
  "stds",
  "herpes",
  "lupus",
  "hiv",
  // sex life, sexual orientation, gender identity
  "sex",
  "gay",
  "trans",
  "ftm",
  "mtf",
  "enby",
  "kink",
  // religion and belief
  "lds",
  "exjw",
  "quran",
  "bible",
  "church",
  // politics
  "maga",
  "labour",
  "tories",
  "brexit",
  "trump",
  "the_donald",
  "donaldtrump",
  // trade unions
  "union",
  "unions",
]);

/**
 * Substrings of a lowercase name, chosen to rarely occur in unrelated names. Where one does
 * (r/christmas, r/propaganda), dropping the community is the safe side.
 */
const PATTERNS: readonly string[] = [
  // health, mental health, disability, reproductive health, addiction
  "health",
  "medical",
  "disease",
  "illness",
  "cancer",
  "tumor",
  "diabet",
  "depress",
  "anxiety",
  "suicid",
  "selfharm",
  "bipolar",
  "schizo",
  "adhd",
  "autis",
  "asperger",
  "ptsd",
  "eatingdisorder",
  "anorexi",
  "bulimi",
  "addict",
  "sober",
  "stopdrinking",
  "alcoholi",
  "opiate",
  "hivaids",
  "hivpositive",
  "pregnan",
  "abortion",
  "infertil",
  "tryingforababy",
  "miscarriage",
  "ivf",
  "disabilit",
  "disabled",
  "chronicpain",
  "migraine",
  "fibromyalgia",
  "crohns",
  "epilep",
  "dementia",
  "alzheimer",
  "parkinson",
  "multiplesclerosis",
  "psychiatr",
  "psycholog",
  "therapist",
  "therapy",
  "dysphoria",
  "insomnia",
  // sex life, sexual orientation, gender identity
  "lgbt",
  "lesbian",
  "bisexual",
  "asexual",
  "queer",
  "transgender",
  "nonbinary",
  "sexual",
  "sexlife",
  "bdsm",
  "fetish",
  "polyam",
  "swinger",
  // religion and belief
  "christ",
  "catholic",
  "protestant",
  "lutheran",
  "baptist",
  "mormon",
  "islam",
  "muslim",
  "judaism",
  "jewish",
  "hindu",
  "buddhis",
  "sikh",
  "atheis",
  "agnostic",
  "pagan",
  "wicca",
  "religio",
  "theolog",
  "jehovah",
  "spiritual",
  "satan",
  // political opinion
  "politic",
  "conservative",
  "liberal",
  "democrat",
  "republican",
  "libertarian",
  "socialis",
  "communis",
  "anarchis",
  "marxis",
  "leftist",
  "feminis",
  "election",
  // racial or ethnic origin, migration
  "blackpeople",
  "blackladies",
  "blackmen",
  "asianamerican",
  "latino",
  "latina",
  "hispanic",
  "indigenous",
  "nativeamerican",
  "ethnic",
  "racism",
  "immigra",
  "refugee",
  // trade union membership
  "laborunion",
  "labourunion",
  "tradeunion",
  // criminal offences
  "prison",
  "felon",
  "parole",
  "probation",
  "incarcerat",
  "convict",
  // genetic data
  "genetic",
  "ancestry",
  "23andme",
];

/** "r/Name", "/r/name" and "Name" all become "name". */
const normalize = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .replace(/^\/?r\//, "");

export function isSensitiveCommunity(name: string): boolean {
  const n = normalize(name);
  return NAMES.has(n) || PATTERNS.some((pattern) => n.includes(pattern));
}

/** A user's profile rather than a community (`u_name`, `u/name`, `user/name`): it carries a username. */
export function isProfileCommunity(name: string): boolean {
  const n = normalize(name);
  return n.startsWith("u_") || n.startsWith("u/") || n.startsWith("user/");
}
