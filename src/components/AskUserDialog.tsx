import { Dialog, DialogContent } from "@/components/ui/dialog";
import { AskUserCard } from "@/components/ui/AskUserCard";
import { AskUserFormCard } from "@/components/ui/AskUserFormCard";
import { useAskUserStore } from "@/stores/askUserStore";
import { resolveAskUser, resolveAskUserForm } from "@/lib/ipc";

export function AskUserDialog() {
  const { pendingAskUser, pendingAskUserForm, clearAskUser, clearAskUserForm } = useAskUserStore();

  return (
    <>
      <Dialog
        open={pendingAskUser !== null}
        onOpenChange={(open) => {
          if (!open && pendingAskUser) {
            resolveAskUser(pendingAskUser.requestId, "").catch(() => {});
            clearAskUser();
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          {pendingAskUser && (
            <AskUserCard
              requestId={pendingAskUser.requestId}
              question={pendingAskUser.question}
              questionType={pendingAskUser.questionType}
              choices={pendingAskUser.choices}
              onResolve={clearAskUser}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={pendingAskUserForm !== null}
        onOpenChange={(open) => {
          if (!open && pendingAskUserForm) {
            resolveAskUserForm(pendingAskUserForm.requestId, {}).catch(() => {});
            clearAskUserForm();
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          {pendingAskUserForm && (
            <AskUserFormCard
              requestId={pendingAskUserForm.requestId}
              title={pendingAskUserForm.title}
              fields={pendingAskUserForm.fields}
              onResolve={clearAskUserForm}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
