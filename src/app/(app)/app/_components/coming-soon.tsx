import { EmptyState } from "@/components/ui";

/** Placeholder for app pages that later milestones fill in. */
export function ComingSoon({ title }: { title: string }) {
  return (
    <EmptyState title={title}>
      This part of AskedFor is still being built. Check back soon.
    </EmptyState>
  );
}
