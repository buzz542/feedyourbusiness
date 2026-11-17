import type { ReactNode } from "react";
import { cx } from "./cx";

/**
 * Small inline icons (docs/PLAN.md 9.4: no icon font, no third-party request). Always decorative:
 * every icon sits next to words that say the same thing, so it is hidden from assistive tech.
 */
function Icon({
  size = 16,
  className,
  children,
}: {
  size?: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cx("shrink-0", className)}
    >
      {children}
    </svg>
  );
}

type IconProps = { size?: number; className?: string };

export const CheckIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.5 8.5l3 3 6-7" />
  </Icon>
);

export const ExternalIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 3.5H3.5v9h9V10M9 3.5h3.5V7M12.5 3.5L7 9" />
  </Icon>
);

export const ChevronIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 3.5L10.5 8 6 12.5" />
  </Icon>
);

export const CloseIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </Icon>
);

export const TodayIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="8" cy="8" r="2.75" />
    <path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" />
  </Icon>
);

export const AllIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.5 4h11M2.5 8h11M2.5 12h11" />
  </Icon>
);

export const SavedIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4.5 2.5h7v11L8 10.5l-3.5 3z" />
  </Icon>
);

export const RepliedIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6.5 4L3 7.5 6.5 11M3 7.5h6.5a3.5 3.5 0 0 1 3.5 3.5v1.5" />
  </Icon>
);

export const HiddenIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2 8s2.25-4 6-4 6 4 6 4-2.25 4-6 4-6-4-6-4z" />
    <circle cx="8" cy="8" r="1.75" />
    <path d="M2.5 13.5l11-11" />
  </Icon>
);

export const SettingsIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.5 4.5h5M10.5 4.5h3M2.5 11.5h2M7.5 11.5h6" />
    <circle cx="9" cy="4.5" r="1.5" />
    <circle cx="6" cy="11.5" r="1.5" />
  </Icon>
);

export const SearchIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="7" cy="7" r="4.25" />
    <path d="M10.25 10.25L13.5 13.5" />
  </Icon>
);

export const FilterIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.5 4h11M4.5 8h7M6.5 12h3" />
  </Icon>
);

export const TipIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 12.5h4M6.5 14.5h3M8 1.75a4.25 4.25 0 0 0-2.5 7.7c.4.3.6.7.6 1.2v.35h3.8v-.35c0-.5.2-.9.6-1.2A4.25 4.25 0 0 0 8 1.75z" />
  </Icon>
);
