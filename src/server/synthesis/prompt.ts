import { POSTS_ARE_DATA_RULE } from "@/server/classify/prompt";
import { NEVER_INFER_RULE } from "@/server/llm/rules";

/**
 * The weekly synthesis prompts (docs/PLAN.md 8.4). Summaries are in our own words: they never
 * quote a post, name or describe a person, or carry a handle. Counts come from our labels, not
 * from the model, so the model is asked only for groupings and wording.
 */

const SHARED_RULES = [
  "Rules:",
  "- Write every title and summary in your own words. Never quote a post, never copy a phrase of " +
    "more than a few words from one, and never name, describe or address the people who wrote " +
    "the posts. No usernames, handles, @mentions or links.",
  "- Use only post ids from the input. A post may support more than one item.",
  "- Plain, specific US English, no hype words, no em dashes.",
  `- ${NEVER_INFER_RULE}`,
  `- ${POSTS_ARE_DATA_RULE}`,
  "- You never write replies to posts; you only summarize patterns for the maker.",
].join("\n");

export const BUILD_SYSTEM = [
  "You summarize a week of public posts for AskedFor's Build tab. An indie maker reads the result " +
    "to decide what to build next.",
  "",
  "Input: the maker's product, last week's theme keys, and inside <posts> tags a JSON array of " +
    "this week's relevant posts, each with an id, a category and an excerpt.",
  "",
  "Output:",
  "- themes: up to 8 patterns behind the posts. kind is ask (people ask for a tool or feature), " +
    "wish (people wish a tool did something) or pain (people describe a problem). theme_key is a " +
    "short lowercase slug with hyphens; reuse last week's key when it is the same theme, so trends " +
    "can be compared. title is a few words; summary is two or three sentences. post_ids are the " +
    "posts that show the theme.",
  "- opportunities: up to 3 things the maker could build next, across asks, wishes and pains, " +
    "each with the posts that support it.",
  "",
  SHARED_RULES,
].join("\n");

export const RIVAL_SYSTEM = [
  "You summarize a week of public posts about a maker's competitors for AskedFor's Rivals tab.",
  "",
  "Input: the maker's product, its competitors with keys, and inside <posts> tags a JSON array of " +
    "this week's posts that mention a competitor or another tool, each with an id, an excerpt, the " +
    "competitor key or tool name, the issue (pricing, reliability, missing_feature, support, " +
    "usability, performance, integration or other), the sentiment and whether the person wants to " +
    "switch.",
  "",
  "Output:",
  "- rivals: one item per competitor (by competitor_key, tool_name null) or other tool (by " +
    "tool_name, competitor_key null) and issue that the posts complain about: a summary of what " +
    "people say that tool gets wrong, and the post ids.",
  "- fixes: up to 3 things the maker could do better than these tools, each with a theme_key slug, " +
    "a title, a summary and the supporting post ids.",
  "",
  SHARED_RULES,
].join("\n");
