/**
 * Sensitive communities (docs/PLAN.md 2.3.7). A community name next to an author hash can reveal a
 * special-category trait about the author (health, sex life or sexuality, religion or belief,
 * political opinions, racial or ethnic origin, trade union membership) or a criminal record, so:
 *
 *   * Reddit posts from these communities are dropped before classification and storage (M3);
 *   * the onboarding draft never suggests them, and the onboarding UI refuses them (M2); the real
 *     guarantee is collection, which filters a product's subreddits again before any request (M3).
 *
 * A list of names plus name patterns. Subreddit names run words together ("TwoXChromosomes",
 * "stopdrinking"), so patterns match inside names; a pattern that also hits a business community
 * gets an exception below rather than being dropped. Dropping one community too many costs a few
 * posts; keeping one too few exposes people. When in doubt, drop.
 *
 * The founder reviews this file before Reddit is switched on and again in launch week (M3).
 * Last reviewed: not yet.
 */

/** Exact names, lowercase, without "r/". */
const NAMES = new Set([
  "twoxchromosomes",
  "askgaybros",
  "actuallyautistic",
  "aspergers",
  "bpd",
  "cptsd",
  "ocd",
  "ttc",
  "tryingforababy",
  "tfab_chartgeeks",
  "infertility",
  "babybumps",
  "beyondthebump",
  "abortion",
  "prolife",
  "prochoice",
  "stopdrinking",
  "leaves",
  "opiatesrecovery",
  "redditorsinrecovery",
  "proed",
  "edanonymous",
  "fatlogic",
  "loseit",
  "keto",
  "asktransgender",
  "ftm",
  "mtf",
  "egg_irl",
  "actuallesbians",
  "bisexual",
  "asexuality",
  "nonbinary",
  "exmormon",
  "exmuslim",
  "exjw",
  "exchristian",
  "atheism",
  "conservative",
  "liberal",
  "progressive",
  "libertarian",
  "anarchism",
  "socialism",
  "communism",
  "neoliberal",
  "the_donald",
  "politics",
  "worldnews",
  "ukpolitics",
  "uspolitics",
  "europe",
  "immigration",
  "legaladvice",
  "legaladviceuk",
  "relationship_advice",
  "relationships",
  "sex",
  "sexualhealth",
  "std",
  "hiv",
  "antiwork",
  "unions",
  "blackpeopletwitter",
  "asianamerican",
  "latinos",
  "jewish",
  "judaism",
  "christianity",
  "catholicism",
  "islam",
  "hinduism",
  "buddhism",
  "sikh",
  "religion",
  "spirituality",
  "tarot",
  "astrology",
  // Added after review (31 Oct 2026): well-known communities the patterns miss.
  "askdocs",
  "covid19",
  "longcovid",
  "coronavirus",
  "asthma",
  "ibs",
  "eczema",
  "psoriasis",
  "tinnitus",
  "insomnia",
  "t1d",
  "drugs",
  "trees",
  "psychonaut",
  "lsd",
  "microdosing",
  "steroids",
  "suboxone",
  "narcoticsanonymous",
  "stopsmoking",
  "quitvaping",
  "nofap",
  "deadbedrooms",
  "bumble",
  "hinge",
  "raisedbynarcissists",
  "trans",
  "transtimelines",
  "traaaaaaannnnnnnnnns",
  "ainbow",
  "latterdaysaints",
  "lds",
  "reformed",
  "bahai",
  "jainism",
  "taoism",
  "exjew",
  "labouruk",
  "snp",
  "greenparty",
  "reformuk",
  "asktrumpsupporters",
  "trump",
  "tories",
  "tory",
  "maga",
  "antifa",
  "latestagecapitalism",
  "israel",
  "israelpalestine",
  "blackladies",
  "abcdesis",
  "desi",
  "aznidentity",
  "asianmasculinity",
  "arabs",
  "romani",
  "workreform",
  "teamsters",
  "uaw",
  "dui",
  "excons",
]);

/** Name patterns, matched anywhere in the lowercase name. Tested against business names too. */
const PATTERNS: readonly RegExp[] = [
  // Health, conditions, treatment, mental health, addiction, reproductive health
  /health|medical|medicine|doctor|nurs(e|ing)|hospital(?!ity)|patient|symptom|diagnos|disease|illness|disorder/,
  /depress|anxiety|panic|bipolar|schizo|psychosis|ptsd|trauma|suicid|selfharm|self_harm|mentalhealth|mentalillness/,
  /adhd|autis|asperg|dyslex|tourette|epilep|migraine|chronicpain|chronicillness|fibromyalgia|lupus|arthritis|multiplesclerosis/,
  /cancer|tumou?r|leukemia|lymphoma|diabet|insulin|thyroid|crohn|colitis|celiac|coeliac|endometrio|pcos/,
  /hivaids|hivpositive|herpes|hpv|stds|sexualhealth|pregnan|fertility|ivf|miscarr|abortion|birthcontrol|menopaus/,
  /addict|alcoholi|sober|sobriety|opiat|opioid|heroin|methamphetamine|methadone|cocaine|benzo|kratom|gambling/,
  /anorexi|bulimi|eatingdisorder|bingeeating|weightloss|obesity|bariatric|wheelchair|disab|deaf|blind(?!s)|amputee/,
  /therap|psychiatr|psycholog|medication|antidepress|ssri|prozac|xanax|adderall|ozempic|semaglutide/,
  // Sex life and sexuality, gender identity
  /lgbt|gay|lesbian|bisexual|queer|homosexual|asexual|aromantic|pansexual|transgender|transsexual|nonbinary|genderqueer|intersex/,
  /sexual|kink|fetish|bdsm|nsfw|porn|onlyfans|^dating|onlinedating|datingadvice|tinder|hookup|polyamor|swinger/,
  // Religion and belief
  /relig|church|christian|catholic|protestant|mormon|jehovah|bible|gospel|jesus/,
  /islam|muslim|quran|koran|jewish|judaism|torah|hindu|buddhis|sikh|pagan|wicca|atheis|satanis/,
  // Politics
  /politic|(^|[^s]|us)election|democrat|republican|conservativ|liberal|labourparty|libdem|socialis|communis/,
  /marxis|anarchis|fascis|nazi|leftist|rightwing|leftwing|biden|farage|starmer|donaldtrump/,
  /brexit|feminis|mensrights|redpill|incel|activis|protest|abolition/,
  // Racial or ethnic origin, nationality, immigration
  /blackpeople|whitepeople|asianamerican|latino|latina|latinx|hispanic|ethnic|racial|racism|indigenous/,
  /immigra|refugee|asylum|deport|undocumented|greencard|citizenship/,
  // Trade union membership, criminal records
  /tradeunion|unionize|unionise|prison|inmate|felon|convict|parole|probation|criminal|arrest|courtcase|legaladvice/,
  // Added after review (31 Oct 2026)
  /covid|coronavirus|dementia|alzheimer|parkinson|narcissis|domesticviolence|abuse/,
  /sexwork|sexoffend|nofap|stopsmoking|quitsmoking|quitvaping|nicotine/,
  /gender|^trans($|[^a-z])|transition/,
  /anglican|lutheran|methodis|baptist|pentecostal|evangelical|adventist|orthodox|calvinis|presbyterian|episcopal|quaker|bahai|scientolog|occult|witchcraft|agnostic/,
  /trump(?!et)|capitalis|palestin|zionis|israel|maga$|antifa|blacklivesmatter/,
  /nativeamerican|mixedrace|blacklad|desis?$|arab(s|ic)?$/,
];

/**
 * Business communities a pattern would otherwise catch. Lowercase. Professional health communities
 * (nursing, medicalcoding, therapists) stay dropped on purpose: when in doubt, drop.
 */
const EXCEPTIONS = new Set([
  "healthtech",
  "digitalhealth",
  "healthit",
  "progressivewebapps",
  "venturecapital",
  "transit",
  "translation",
  "translator",
  "transcription",
]);

/** True when a Reddit community is sensitive. Takes "r/Name", "/r/Name" or "Name". */
export function isSensitiveCommunity(community: string): boolean {
  const name = community
    .trim()
    .replace(/^\/?r\//i, "")
    .toLowerCase();
  if (!name) return false;
  if (EXCEPTIONS.has(name)) return false;
  return NAMES.has(name) || PATTERNS.some((p) => p.test(name));
}

/** A user's profile rather than a community (`u_name`, `u/name`, `user/name`): it carries a username. */
export function isProfileCommunity(name: string): boolean {
  const n = name
    .trim()
    .toLowerCase()
    .replace(/^\/?r\//, "")
    .replace(/^\//, "");
  return n.startsWith("u_") || n.startsWith("u/") || n.startsWith("user/");
}
