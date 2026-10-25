import { Skeleton } from "@/components/ui/skeleton";

/** Skeleton cards while the feed loads (docs/PLAN.md 4.9). */
export default function Loading() {
  return (
    <div className="space-y-5">
      <h1 className="font-serif text-3xl tracking-tight">Reply</h1>
      <Skeleton cards={4} label="Loading posts" />
    </div>
  );
}
