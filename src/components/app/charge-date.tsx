"use client";

import { useEffect, useState } from "react";
import { formatChargeTime } from "@/lib/charge-time";

/**
 * A billing moment with its time and zone (docs/PLAN.md 2.4, 10.1, 10.3). The server renders it in
 * UTC, named as such; the browser then shows the visitor's own zone, so nobody west of UTC is told
 * a date a day later than the real charge.
 */
export { formatChargeTime };

export function ChargeDate({ iso }: { iso: string }) {
  const [local, setLocal] = useState<string | null>(null);
  useEffect(() => {
    // The visitor's zone is known only in the browser.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocal(formatChargeTime(iso));
  }, [iso]);
  return <time dateTime={iso}>{local ?? formatChargeTime(iso, "UTC")}</time>;
}
