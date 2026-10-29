/**
 * Sensitive communities (docs/PLAN.md 2.3.7). A community name next to an author hash can reveal a
 * special-category trait about the author (health, sex life or sexuality, religion or belief,
 * political opinions, racial or ethnic origin, trade union membership) or a criminal record, so:
 *
 *   * Reddit posts from these communities are dropped before classification and storage (M3);
 *   * the onboarding draft never suggests them, and a user cannot add them (M2).
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
]);

/** Name patterns, matched anywhere in the lowercase name. Tested against business names too. */
const PATTERNS: readonly RegExp[] = [
  // Health, conditions, treatment, mental health, addiction, reproductive health
  /health|medical|medicine|doctor|nurs(e|ing)|hospital|patient|symptom|diagnos|disease|illness|disorder/,
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
  /politic|election|democrat|republican|conservativ|liberal|labourparty|tories|libdem|socialis|communis/,
  /marxis|anarchis|fascis|nazi|leftist|rightwing|leftwing|biden|farage|starmer|donaldtrump/,
  /brexit|feminis|mensrights|redpill|incel|activis|protest|abolition/,
  // Racial or ethnic origin, nationality, immigration
  /blackpeople|whitepeople|asianamerican|latino|latina|latinx|hispanic|ethnic|racial|racism|indigenous/,
  /immigra|refugee|asylum|deport|undocumented|greencard|citizenship/,
  // Trade union membership, criminal records
  /tradeunion|unionize|unionise|prison|inmate|felon|convict|parole|probation|criminal|arrest|courtcase|legaladvice/,
];

/** Business communities a pattern would otherwise catch. Lowercase. */
const EXCEPTIONS = new Set(["healthtech", "digitalhealth", "healthit", "progressivewebapps"]);

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
