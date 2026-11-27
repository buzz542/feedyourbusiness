import { cx } from "./cx";

/**
 * The FeedYourBusiness mark (the founder's logo, 27 Nov 2026): the FYB letters, from
 * public/brand/fyb-mark.png (transparent). It is painted through a mask, so it takes the text color
 * of its surface: black on the white site, and the light text color in the dark app (black would
 * vanish on it). The caller sets the height (h-7 in the wordmark); the width follows the logo's
 * proportions.
 */
export function BrandMark({ className }: { className?: string }) {
  const url = "url(/brand/fyb-mark.png)";
  return (
    <span
      aria-hidden="true"
      className={cx(
        "inline-block aspect-[480/274] shrink-0 bg-current text-[#101010] [.theme-dark_&]:text-ink",
        className,
      )}
      style={{
        WebkitMaskImage: url,
        maskImage: url,
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskPosition: "center",
        maskPosition: "center",
        WebkitMaskSize: "contain",
        maskSize: "contain",
      }}
    />
  );
}

/**
 * The logo as the site's name (the founder, 27 Nov 2026): the mark alone, not the mark with the
 * name typed beside it. The name stays for assistive technology.
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cx("inline-flex items-center", className)}>
      <BrandMark className="h-7" />
      <span className="sr-only">FeedYourBusiness</span>
    </span>
  );
}
