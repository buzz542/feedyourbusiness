import { cx } from "./cx";

/**
 * The FeedYourBusiness mark (the founder's logo, 27 Nov 2026): the FYB letters, from
 * public/brand/fyb-mark.png (transparent). It is painted through a mask, so it takes the text color
 * of its surface: brand blue on the white site and the light text color in the dark app. Sized by
 * height; the width follows the logo's proportions.
 */
export function BrandMark({ className }: { className?: string }) {
  const url = "url(/brand/fyb-mark.png)";
  return (
    <span
      aria-hidden="true"
      className={cx(
        "inline-block aspect-[480/274] h-5 shrink-0 bg-current text-[#1f3a6e] [.theme-dark_&]:text-ink",
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

/** The mark and the wordmark together, as one name for assistive technology. */
export function Wordmark({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <span className={cx("inline-flex items-center gap-2 font-semibold tracking-tight", className)}>
      <BrandMark />
      {/* compact: the mark alone below 400px wide; the link's label still names us. */}
      <span className={compact ? "hidden min-[400px]:inline" : undefined}>FeedYourBusiness</span>
    </span>
  );
}
