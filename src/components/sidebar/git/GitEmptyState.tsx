import { GitBranch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useInitRepo } from "@/hooks/useGitMutations";

interface GitEmptyStateProps {
  project: string;
}

export function GitEmptyState({ project }: GitEmptyStateProps) {
  const initRepo = useInitRepo(project);

  return (
    <div className="flex flex-col items-center justify-center gap-3 p-6 text-center h-full">
      <GitBranch className="size-8 text-muted-foreground" />
      <p className="text-xs text-muted-foreground">
        This project doesn&apos;t have a git repository yet.
      </p>
      <Button size="sm" disabled={initRepo.isPending} onClick={() => initRepo.mutate()}>
        Initialize Repository
      </Button>
    </div>
  );
}
