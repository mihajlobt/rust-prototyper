import { useRef, forwardRef, useImperativeHandle, useCallback } from "react";
import { Paperclip, Image, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createDir, writeFile } from "@/lib/ipc";

interface AttachComposerProps {
  attachments: string[];
  onAttachmentsChange: (attachments: string[]) => void;
  attachmentsDir: string;
}

export interface AttachComposerRef {
  openFilePicker: () => void;
  handlePaste: (e: React.ClipboardEvent) => void;
  handleDrop: (e: React.DragEvent) => void;
}

export const AttachComposer = forwardRef<AttachComposerRef, AttachComposerProps>(
  ({ attachments, onAttachmentsChange, attachmentsDir }, ref) => {
    const fileInputRef = useRef<HTMLInputElement>(null);

    const saveFile = useCallback(async (file: File, prefix: string) => {
      if (!file.type.startsWith("image/")) return;
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = reader.result as string;
        const filename = `${prefix}-${Date.now()}.${file.name.split(".").pop() || "png"}`;
        await createDir(attachmentsDir);
        await writeFile(`${attachmentsDir}/${filename}`, base64.split(",")[1]);
        onAttachmentsChange([...attachments, `${attachmentsDir}/${filename}`]);
      };
      reader.readAsDataURL(file);
    }, [attachmentsDir, attachments, onAttachmentsChange]);

    const handlePaste = useCallback((e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) saveFile(file, "paste");
        }
      }
    }, [saveFile]);

    const handleDrop = useCallback((e: React.DragEvent) => {
      e.preventDefault();
      const files = Array.from(e.dataTransfer.files);
      for (const file of files) {
        saveFile(file, "drop");
      }
    }, [saveFile]);

    const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      for (const file of files) {
        saveFile(file, "upload");
      }
    }, [saveFile]);

    const openFilePicker = useCallback(() => {
      fileInputRef.current?.click();
    }, []);

    useImperativeHandle(ref, () => ({
      openFilePicker,
      handlePaste,
      handleDrop,
    }), [openFilePicker, handlePaste, handleDrop]);

    const removeAttachment = (index: number) => {
      onAttachmentsChange(attachments.filter((_, i) => i !== index));
    };

    return (
      <>
        {attachments.length > 0 && (
          <div className="flex gap-1 mb-2 flex-wrap">
            {attachments.map((att, i) => (
              <span key={i} className="text-[10px] bg-muted px-1.5 py-0.5 rounded inline-flex items-center gap-0.5">
                {att.split("/").pop()}
                <button
                  type="button"
                  className="ml-0.5 hover:text-destructive"
                  onClick={() => removeAttachment(i)}
                >
                  <X size={8} />
                </button>
              </span>
            ))}
          </div>
        )}
        <input type="file" accept="image/*" className="hidden" ref={fileInputRef} onChange={handleFileSelect} multiple />
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={openFilePicker}>
            <Paperclip size={14} />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={openFilePicker}>
            <Image size={14} />
          </Button>
        </div>
      </>
    );
  }
);

AttachComposer.displayName = "AttachComposer";