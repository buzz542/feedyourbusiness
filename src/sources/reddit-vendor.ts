/**
 * The Reddit data vendor's hosts (docs/PLAN.md 7.7, D1). The vendor's host may be named only in
 * src/sources/reddit*.ts (2.1.9); every other module imports it from here. The Reddit source
 * itself arrives in M3 and is the only module that may call it.
 */

/** Bright Data's Web Scraper API host. Never fetched by anything but the Reddit source. */
export const BRIGHTDATA_API_HOST = "api.brightdata.com";

/** Bright Data's registrable domain, so fetchOwnSite refuses all of it. */
export const BRIGHTDATA_DOMAIN = "brightdata.com";
