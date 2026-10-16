/**
 * The Reddit data vendor's hosts (docs/PLAN.md 2.1.9, D1). The vendor host may appear only in
 * src/sources/reddit*.ts; every other module imports these constants. The Reddit source (M3) pins
 * the paths and dataset ids it may call on this host.
 */
export const BRIGHTDATA_DOMAIN = "brightdata.com";
export const BRIGHTDATA_API_HOST = "api.brightdata.com";
