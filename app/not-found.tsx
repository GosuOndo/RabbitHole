import { EmptyState } from "@/components/empty-state";
import { ButtonLink } from "@/components/ui/button";

export default function NotFound() {
  return (
    <EmptyState
      title="Page not found"
      description="That page does not exist, or the project slug is wrong."
      action={
        <ButtonLink href="/discover" variant="primary">
          Back to Discover
        </ButtonLink>
      }
    />
  );
}
