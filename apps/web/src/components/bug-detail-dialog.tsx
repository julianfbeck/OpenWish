import { useEffect, useState } from "react";

import type { BugResponse, BugState } from "@openwish/shared";
import { bugStateLabels } from "@openwish/shared";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "#/components/ui/alert-dialog";
import { Button } from "#/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "#/components/ui/dialog";
import { Input } from "#/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import { Textarea } from "#/components/ui/textarea";
import { bugScreenshotUrl } from "#/lib/api";
import { formatDate } from "#/lib/format";
import { cn } from "#/lib/utils";

const TITLE_MAX = 80;
const DESCRIPTION_MAX = 2000;

type BugDetailDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bug: BugResponse | null;
  slug: string;
  onBugSave: (input: { title: string; description: string }) => Promise<void> | void;
  onStateChange: (state: BugState) => Promise<void> | void;
  onCommentCreate: (description: string) => Promise<void> | void;
  onDeleteBug: () => Promise<void> | void;
};

export function BugDetailDialog({
  open,
  onOpenChange,
  bug,
  slug,
  onBugSave,
  onStateChange,
  onCommentCreate,
  onDeleteBug,
}: BugDetailDialogProps) {
  const [titleDraft, setTitleDraft] = useState("");
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const [commentDraft, setCommentDraft] = useState("");
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [isSavingBug, setIsSavingBug] = useState(false);
  const [isUpdatingState, setIsUpdatingState] = useState(false);
  const [isSendingComment, setIsSendingComment] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (!open) {
      setCommentDraft("");
      setPreviewKey(null);
    }
  }, [open]);

  useEffect(() => {
    setTitleDraft(bug?.title ?? "");
    setDescriptionDraft(bug?.description ?? "");
  }, [bug?.id, bug?.title, bug?.description]);

  if (!bug) {
    return null;
  }

  const hasCopyChanges =
    titleDraft.trim() !== bug.title || descriptionDraft.trim() !== bug.description;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[90vh] overflow-hidden border-white/10 bg-neutral-950 p-0 text-neutral-100 sm:max-w-[1100px]"
        showCloseButton
      >
        <DialogTitle className="sr-only">Bug detail</DialogTitle>
        <div className="grid max-h-[90vh] min-h-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_240px]">
          <div className="flex min-h-0 flex-col gap-4 overflow-y-auto border-r border-white/10 p-5">
            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <label htmlFor="bug-title" className="text-sm font-medium text-white">
                  Title
                </label>
                <span className="text-[11px] text-neutral-500">
                  {titleDraft.length} / {TITLE_MAX}
                </span>
              </div>
              <Input
                id="bug-title"
                className="h-9 border-white/10 bg-neutral-900 text-neutral-100"
                maxLength={TITLE_MAX}
                value={titleDraft}
                onChange={(event) => setTitleDraft(event.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <label htmlFor="bug-description" className="text-sm font-medium text-white">
                  Description
                </label>
                <span className="text-[11px] text-neutral-500">
                  {descriptionDraft.length} / {DESCRIPTION_MAX}
                </span>
              </div>
              <Textarea
                id="bug-description"
                className="min-h-40 border-white/10 bg-neutral-900 text-neutral-100"
                maxLength={DESCRIPTION_MAX}
                value={descriptionDraft}
                onChange={(event) => setDescriptionDraft(event.target.value)}
              />
            </div>

            <div className="space-y-1">
              <p className="text-sm font-medium text-white">Reported by</p>
              {bug.reporterEmail ? (
                <p className="break-all text-xs text-neutral-200">
                  <a
                    href={`mailto:${bug.reporterEmail}`}
                    className="underline-offset-2 hover:underline"
                  >
                    {bug.reporterEmail}
                  </a>
                </p>
              ) : null}
              <p className="break-all text-[11px] text-neutral-500">
                User ID: <span className="text-neutral-300">{bug.userUUID}</span>
              </p>
              <p className="text-[11px] text-neutral-500">
                {formatDate(bug.createdAt)}
              </p>
            </div>

            <div className="mt-auto flex items-center gap-2 pt-2">
              <Button
                size="sm"
                variant="outline"
                className="border-white/10 bg-transparent text-neutral-300 hover:bg-white/5 hover:text-white"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                className="bg-white text-black hover:bg-neutral-200"
                disabled={
                  !hasCopyChanges ||
                  !titleDraft.trim() ||
                  !descriptionDraft.trim() ||
                  isSavingBug
                }
                onClick={async () => {
                  setIsSavingBug(true);
                  try {
                    await onBugSave({
                      title: titleDraft.trim(),
                      description: descriptionDraft.trim(),
                    });
                  } catch {
                    /* upstream */
                  } finally {
                    setIsSavingBug(false);
                  }
                }}
              >
                {isSavingBug ? "Saving…" : "Update"}
              </Button>
            </div>
          </div>

          <div className="flex min-h-0 flex-col">
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
              {bug.commentList.length === 0 ? (
                <div className="grid h-full place-items-center text-xs text-neutral-500">
                  No comments yet.
                </div>
              ) : (
                bug.commentList.map((comment) => (
                  <div key={comment.id} className="space-y-1.5">
                    <div className="flex items-center gap-2 text-[11px] text-neutral-500">
                      <span>{formatDate(comment.createdAt)}</span>
                      <span className="text-neutral-700">•</span>
                      <span className={comment.isAdmin ? "text-white" : "text-neutral-400"}>
                        {comment.isAdmin ? "Admin" : "User"}
                      </span>
                    </div>
                    <div
                      className={cn(
                        "rounded-md border p-3 text-sm leading-6",
                        comment.isAdmin
                          ? "border-white/15 bg-white/[0.04] text-neutral-100"
                          : "border-white/10 bg-neutral-900 text-neutral-200",
                      )}
                    >
                      {comment.description}
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="flex items-center gap-2 border-t border-white/10 p-3">
              <Input
                className="h-9 flex-1 border-white/10 bg-neutral-900 text-neutral-100"
                placeholder="Write a comment…"
                maxLength={DESCRIPTION_MAX}
                value={commentDraft}
                onChange={(event) => setCommentDraft(event.target.value)}
                onKeyDown={async (event) => {
                  if (event.key === "Enter" && !event.shiftKey && commentDraft.trim()) {
                    event.preventDefault();
                    const next = commentDraft.trim();
                    setIsSendingComment(true);
                    try {
                      await onCommentCreate(next);
                      setCommentDraft("");
                    } catch {
                      /* upstream */
                    } finally {
                      setIsSendingComment(false);
                    }
                  }
                }}
              />
              <Button
                size="sm"
                className="bg-white text-black hover:bg-neutral-200"
                disabled={!commentDraft.trim() || isSendingComment}
                onClick={async () => {
                  const next = commentDraft.trim();
                  if (!next) {
                    return;
                  }
                  setIsSendingComment(true);
                  try {
                    await onCommentCreate(next);
                    setCommentDraft("");
                  } catch {
                    /* upstream */
                  } finally {
                    setIsSendingComment(false);
                  }
                }}
              >
                {isSendingComment ? "Sending…" : "Send"}
              </Button>
            </div>
          </div>

          <div className="flex min-h-0 flex-col gap-4 overflow-y-auto border-l border-white/10 p-5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-neutral-300">Status</span>
              <Select
                value={bug.state}
                onValueChange={async (value) => {
                  setIsUpdatingState(true);
                  try {
                    await onStateChange(value as BugState);
                  } catch {
                    /* upstream */
                  } finally {
                    setIsUpdatingState(false);
                  }
                }}
              >
                <SelectTrigger
                  size="sm"
                  className="h-7 w-32 border-white/10 bg-neutral-900 text-xs text-neutral-100"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-white/10 bg-neutral-950 text-neutral-100">
                  {Object.entries(bugStateLabels).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {isUpdatingState ? (
              <p className="-mt-2 text-right text-[11px] text-neutral-500">Updating…</p>
            ) : null}

            <div className="space-y-2">
              <p className="text-[11px] uppercase tracking-wider text-neutral-500">
                Screenshots ({bug.screenshotKeys.length})
              </p>
              {bug.screenshotKeys.length === 0 ? (
                <p className="text-xs text-neutral-500">None attached.</p>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {bug.screenshotKeys.map((key) => (
                    <button
                      key={key}
                      type="button"
                      className="overflow-hidden rounded border border-white/10 bg-black"
                      onClick={() => setPreviewKey(key)}
                    >
                      <img
                        src={bugScreenshotUrl(slug, bug.id, key)}
                        alt="Bug screenshot"
                        className="h-20 w-full object-cover"
                      />
                    </button>
                  ))}
                </div>
              )}
            </div>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <button
                  type="button"
                  className="text-left text-sm text-red-400 hover:text-red-300"
                >
                  Delete bug
                </button>
              </AlertDialogTrigger>
              <AlertDialogContent className="border-white/10 bg-neutral-950 text-neutral-100">
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this bug?</AlertDialogTitle>
                  <AlertDialogDescription className="text-neutral-400">
                    This removes the bug, its comments, and all attached screenshots from R2.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel className="border-white/10 bg-transparent text-neutral-300 hover:bg-white/5 hover:text-white">
                    Cancel
                  </AlertDialogCancel>
                  <AlertDialogAction
                    variant="destructive"
                    onClick={async () => {
                      setIsDeleting(true);
                      try {
                        await onDeleteBug();
                      } catch {
                        /* upstream */
                      } finally {
                        setIsDeleting(false);
                      }
                    }}
                  >
                    {isDeleting ? "Deleting…" : "Delete"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </DialogContent>

      <Dialog
        open={previewKey !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPreviewKey(null);
          }
        }}
      >
        <DialogContent
          showCloseButton={false}
          className="!max-w-none !w-screen !h-screen !translate-x-0 !translate-y-0 !top-0 !left-0 !rounded-none !border-0 !bg-black/95 !p-0"
        >
          <DialogTitle className="sr-only">Screenshot preview</DialogTitle>
          <button
            type="button"
            className="grid h-full w-full place-items-center"
            onClick={() => setPreviewKey(null)}
          >
            {previewKey ? (
              <img
                src={bugScreenshotUrl(slug, bug.id, previewKey)}
                alt="Bug screenshot"
                className="max-h-[92vh] max-w-[94vw] rounded border border-white/10 object-contain"
              />
            ) : null}
          </button>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}
