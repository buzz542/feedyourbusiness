import { Skeleton, SkeletonCards } from "@/components/ui/skeleton";

/** Shown in the main column while a view loads; the side panel stays where it is. */
export default function ReplyLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <SkeletonCards count={4} />
    </div>
  );
}
