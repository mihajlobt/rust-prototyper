import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useCommit } from "@/hooks/useGitMutations";

interface GitCommitBoxProps {
  project: string;
  stagedCount: number;
}

export function GitCommitBox({ project, stagedCount }: GitCommitBoxProps) {
  const [message, setMessage] = useState("");
  const commitM = useCommit(project);

  const handleCommit = () => {
    commitM.mutate(message, { onSuccess: () => setMessage("") });
  };

  return (
    <div className="border-t border-border p-2 space-y-1.5 shrink-0">
      <Textarea
        placeholder="Commit message"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        className="min-h-16 text-xs resize-none"
      />
      <Button
        size="sm"
        className="w-full"
        disabled={stagedCount === 0 || message.trim().length === 0 || commitM.isPending}
        onClick={handleCommit}
      >
        Commit{stagedCount > 0 ? ` (${stagedCount})` : ""}
      </Button>
    </div>
  );
}
