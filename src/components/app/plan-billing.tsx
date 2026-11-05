import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import type { PlanView } from "@/server/billing/plan-status";
import { PlanControls, type PlanActionResult } from "./plan-controls";

/** Settings, Plan and billing (docs/PLAN.md 4.7, 10.3). */
export function PlanBilling({
  view,
  setCancellation,
  openCardPortal,
}: {
  view: PlanView;
  setCancellation: (action: "cancel" | "resume") => Promise<PlanActionResult>;
  openCardPortal: () => Promise<PlanActionResult>;
}) {
  return (
    <section aria-labelledby="plan-heading" className="flex flex-col gap-3">
      <h2 id="plan-heading" className="font-serif text-xl tracking-tight">
        Plan and billing
      </h2>
      {view.banner ? (
        <p role="alert" className="rounded-[2px] border border-negative p-3 text-sm">
          {view.banner}
        </p>
      ) : null}
      <p>{view.summary}</p>
      {view.canStartTrial ? (
        <Link href="/app/billing" className={buttonClass("primary", "self-start")}>
          Start your 7-day trial
        </Link>
      ) : (
        <PlanControls
          canCancel={view.canCancel}
          canResume={view.canResume}
          canUpdateCard={view.canUpdateCard}
          accessUntil={view.accessUntil}
          setCancellation={setCancellation}
          openCardPortal={openCardPortal}
        />
      )}
    </section>
  );
}
