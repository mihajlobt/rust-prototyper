import { useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { confirm } from "@tauri-apps/plugin-dialog";
import { useAppStore } from "@/stores/appStore";
import { useProjectSettingsStore } from "@/stores/projectSettingsStore";
import { useIsGitRepo, useGitStatus } from "@/hooks/useGitStatus";
import { useStageFile, useUnstageFile, useStageAll, useUnstageAll, useDiscardFile } from "@/hooks/useGitMutations";
import { makeFileDiffTabId } from "@/lib/git/diffTabs";
import { GitEmptyState } from "./GitEmptyState";
import { GitStatusHeader } from "./GitStatusHeader";
import { GitChangesSection, type ChangeItem } from "./GitChangesSection";
import { GitCommitBox } from "./GitCommitBox";
import { GitHistoryView } from "./GitHistoryView";

type View = "changes" | "history";

export function SidebarGitTab() {
  const { settings } = useAppStore();
  const project = settings.project;
  const openRunnerDiffTab = useProjectSettingsStore((s) => s.openRunnerDiffTab);

  const [view, setView] = useState<View>("changes");

  const isRepoQuery = useIsGitRepo(project);
  const isRepo = isRepoQuery.data === true;
  const statusQuery = useGitStatus(project, isRepo);

  const stageFile = useStageFile(project);
  const unstageFile = useUnstageFile(project);
  const stageAll = useStageAll(project);
  const unstageAll = useUnstageAll(project);
  const discardFile = useDiscardFile(project);

  if (isRepoQuery.isLoading) return null;

  if (!isRepo) {
    return (
      <ScrollArea className="h-full overflow-hidden">
        <GitEmptyState project={project} />
      </ScrollArea>
    );
  }

  const status = statusQuery.data;
  const stagedItems: ChangeItem[] = (status?.staged ?? []).map((file) => ({ file, isUntracked: false }));
  const unstagedItems: ChangeItem[] = [
    ...(status?.unstaged ?? []).map((file) => ({ file, isUntracked: false })),
    ...(status?.untracked ?? []).map((file) => ({ file, isUntracked: true })),
  ];

  const handleDiscard = async (item: ChangeItem) => {
    const ok = await confirm(`Discard changes to ${item.file.path}?`, { title: "Discard Changes", kind: "warning" });
    if (!ok) return;
    discardFile.mutate({ path: item.file.path, isUntracked: item.isUntracked });
  };

  return (
    <div className="flex flex-col h-full">
      {status && <GitStatusHeader project={project} status={status} />}

      <div className="flex border-b border-border shrink-0 text-xs">
        {(["changes", "history"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`flex-1 py-1.5 capitalize transition-colors border-b-2 ${
              view === v ? "border-current text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {v}
          </button>
        ))}
      </div>

      {view === "changes" ? (
        <>
          <ScrollArea className="flex-1 overflow-hidden">
            <GitChangesSection
              title="Staged Changes"
              items={stagedItems}
              staged
              onFileClick={(item) => openRunnerDiffTab(makeFileDiffTabId(item.file.path, true, false))}
              onUnstageFile={(path) => unstageFile.mutate(path)}
              onUnstageAll={stagedItems.length > 0 ? () => unstageAll.mutate() : undefined}
            />
            <GitChangesSection
              title="Changes"
              items={unstagedItems}
              staged={false}
              onFileClick={(item) => openRunnerDiffTab(makeFileDiffTabId(item.file.path, false, item.isUntracked))}
              onStageFile={(path) => stageFile.mutate(path)}
              onDiscardFile={handleDiscard}
              onStageAll={unstagedItems.length > 0 ? () => stageAll.mutate() : undefined}
            />
            {stagedItems.length === 0 && unstagedItems.length === 0 && (
              <div className="p-4 text-center text-xs text-muted-foreground">No changes</div>
            )}
          </ScrollArea>
          <GitCommitBox project={project} stagedCount={stagedItems.length} />
        </>
      ) : (
        <GitHistoryView project={project} />
      )}
    </div>
  );
}
