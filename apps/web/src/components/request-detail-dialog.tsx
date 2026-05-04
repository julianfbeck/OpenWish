import { useEffect, useState } from "react";

import type { WishResponse, WishState } from "@openwish/shared";
import { wishStateLabels } from "@openwish/shared";

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
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "#/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import { Input } from "#/components/ui/input";
import { Textarea } from "#/components/ui/textarea";
import { formatDate } from "#/lib/format";
import { cn } from "#/lib/utils";

type RequestDetailDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  wish: WishResponse | null;
  allWishes: WishResponse[];
  projectCreatedAt?: string;
  onWishSave: (input: { title: string; description: string }) => Promise<void> | void;
  onStateChange: (state: WishState) => Promise<void> | void;
  onCommentCreate: (description: string) => Promise<void> | void;
  onDeleteWish: () => Promise<void> | void;
  onMergeWish: (targetWishId: string) => Promise<void> | void;
};

const TITLE_MAX = 50;
const DESCRIPTION_MAX = 500;
const COMMENT_MAX = 2000;

export function RequestDetailDialog({
  open,
  onOpenChange,
  wish,
  allWishes,
  onWishSave,
  onStateChange,
  onCommentCreate,
  onDeleteWish,
  onMergeWish,
}: RequestDetailDialogProps) {
  const [commentDraft, setCommentDraft] = useState("");
  const [titleDraft, setTitleDraft] = useState("");
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const [mergeTargetId, setMergeTargetId] = useState("");
  const [showVoters, setShowVoters] = useState(false);
  const [showMerge, setShowMerge] = useState(false);
  const [isSendingComment, setIsSendingComment] = useState(false);
  const [isSavingWish, setIsSavingWish] = useState(false);
  const [isUpdatingState, setIsUpdatingState] = useState(false);
  const [isDeletingWish, setIsDeletingWish] = useState(false);
  const [isMergingWish, setIsMergingWish] = useState(false);

  useEffect(() => {
    if (!open) {
      setCommentDraft("");
      setShowVoters(false);
      setShowMerge(false);
    }
  }, [open]);

  useEffect(() => {
    setTitleDraft(wish?.title ?? "");
    setDescriptionDraft(wish?.description ?? "");
    setMergeTargetId("");
  }, [wish?.id, wish?.title, wish?.description]);

  if (!wish) {
    return null;
  }

  const mergeCandidates = allWishes.filter((entry) => entry.id !== wish.id);
  const hasCopyChanges =
    titleDraft.trim() !== wish.title || descriptionDraft.trim() !== wish.description;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[90vh] overflow-hidden border-white/10 bg-neutral-950 p-0 text-neutral-100 sm:max-w-[1100px]"
        showCloseButton
      >
        <DialogTitle className="sr-only">Request detail</DialogTitle>
        <div className="grid max-h-[90vh] min-h-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_240px]">
          {/* ── Left: edit form ─────────────────────────────────────────── */}
          <div className="flex min-h-0 flex-col gap-4 overflow-y-auto border-r border-white/10 p-5">
            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <label htmlFor="wish-title" className="text-sm font-medium text-white">
                  Title
                </label>
                <span className="text-[11px] text-neutral-500">
                  {titleDraft.length} / {TITLE_MAX}
                </span>
              </div>
              <Input
                id="wish-title"
                className="h-9 border-white/10 bg-neutral-900 text-neutral-100"
                maxLength={TITLE_MAX}
                value={titleDraft}
                onChange={(event) => setTitleDraft(event.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <label htmlFor="wish-description" className="text-sm font-medium text-white">
                  Description
                </label>
                <span className="text-[11px] text-neutral-500">
                  {descriptionDraft.length} / {DESCRIPTION_MAX}
                </span>
              </div>
              <Textarea
                id="wish-description"
                className="min-h-40 border-white/10 bg-neutral-900 text-neutral-100"
                maxLength={DESCRIPTION_MAX}
                value={descriptionDraft}
                onChange={(event) => setDescriptionDraft(event.target.value)}
              />
            </div>

            <div className="space-y-1">
              <p className="text-sm font-medium text-white">Created by</p>
              <p className="break-all text-[11px] text-neutral-500">
                User ID: <span className="text-neutral-300">{wish.userUUID}</span>
              </p>
            </div>

            {showMerge ? (
              <div className="space-y-2 rounded-md border border-white/10 p-3">
                <p className="text-[11px] uppercase tracking-wider text-neutral-500">
                  Merge into another request
                </p>
                <Select value={mergeTargetId} onValueChange={setMergeTargetId}>
                  <SelectTrigger
                    size="sm"
                    className="h-8 w-full border-white/10 bg-neutral-900 text-neutral-100"
                  >
                    <SelectValue placeholder="Choose target…" />
                  </SelectTrigger>
                  <SelectContent className="border-white/10 bg-neutral-950 text-neutral-100">
                    {mergeCandidates.map((candidate) => (
                      <SelectItem key={candidate.id} value={candidate.id}>
                        {candidate.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex justify-end gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-white/10 bg-transparent text-neutral-300 hover:bg-white/5 hover:text-white"
                    onClick={() => {
                      setShowMerge(false);
                      setMergeTargetId("");
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    className="bg-white text-black hover:bg-neutral-200"
                    disabled={!mergeTargetId || isMergingWish || mergeCandidates.length === 0}
                    onClick={async () => {
                      if (!mergeTargetId) {
                        return;
                      }
                      setIsMergingWish(true);
                      try {
                        await onMergeWish(mergeTargetId);
                        setShowMerge(false);
                      } catch {
                        // upstream owns the visible error state
                      } finally {
                        setIsMergingWish(false);
                      }
                    }}
                  >
                    {isMergingWish ? "Merging…" : "Confirm merge"}
                  </Button>
                </div>
              </div>
            ) : null}

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
                disabled={!hasCopyChanges || !titleDraft.trim() || !descriptionDraft.trim() || isSavingWish}
                onClick={async () => {
                  setIsSavingWish(true);
                  try {
                    await onWishSave({
                      title: titleDraft.trim(),
                      description: descriptionDraft.trim(),
                    });
                  } catch {
                    // upstream owns the visible error state
                  } finally {
                    setIsSavingWish(false);
                  }
                }}
              >
                {isSavingWish ? "Saving…" : "Update"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="border-white/10 bg-transparent text-neutral-300 hover:bg-white/5 hover:text-white"
                disabled={mergeCandidates.length === 0}
                onClick={() => setShowMerge((current) => !current)}
              >
                Merge
              </Button>
            </div>
          </div>

          {/* ── Middle: comments ────────────────────────────────────────── */}
          <div className="flex min-h-0 flex-col">
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
              {wish.commentList.length === 0 ? (
                <div className="grid h-full place-items-center text-xs text-neutral-500">
                  No comments yet.
                </div>
              ) : (
                wish.commentList.map((comment) => (
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
                maxLength={COMMENT_MAX}
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
                      // upstream owns the visible error state
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
                    // upstream owns the visible error state
                  } finally {
                    setIsSendingComment(false);
                  }
                }}
              >
                {isSendingComment ? "Sending…" : "Send"}
              </Button>
            </div>
          </div>

          {/* ── Right: metadata + actions ───────────────────────────────── */}
          <div className="flex min-h-0 flex-col gap-4 overflow-y-auto border-l border-white/10 p-5">
            <MetadataRow label="Upvotes" value={String(wish.votingUsers.length)} />
            <MetadataRow label="Comments" value={String(wish.commentList.length)} />
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-neutral-300">Status</span>
              <Select
                value={wish.state}
                onValueChange={async (value) => {
                  setIsUpdatingState(true);
                  try {
                    await onStateChange(value as WishState);
                  } catch {
                    // upstream owns the visible error state
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
                  {Object.entries(wishStateLabels).map(([value, label]) => (
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

            <div className="border-t border-white/10 pt-4">
              <button
                type="button"
                className="text-left text-sm text-neutral-300 hover:text-white"
                onClick={() => setShowVoters((current) => !current)}
              >
                {showVoters ? "Hide voters" : "View voters"}
              </button>
              {showVoters ? (
                <div className="mt-2 space-y-1 text-[11px] text-neutral-400">
                  {wish.votingUsers.length === 0 ? (
                    <p className="text-neutral-500">No upvotes yet.</p>
                  ) : (
                    wish.votingUsers.map((user) => (
                      <p key={user.uuid} className="break-all font-mono">
                        {user.uuid}
                      </p>
                    ))
                  )}
                </div>
              ) : null}
            </div>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <button
                  type="button"
                  className="text-left text-sm text-red-400 hover:text-red-300"
                >
                  Delete request
                </button>
              </AlertDialogTrigger>
              <AlertDialogContent className="border-white/10 bg-neutral-950 text-neutral-100">
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this request?</AlertDialogTitle>
                  <AlertDialogDescription className="text-neutral-400">
                    This removes the request and its thread. Use Merge if the feedback should live on under another card.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel className="border-white/10 bg-transparent text-neutral-300 hover:bg-white/5 hover:text-white">
                    Cancel
                  </AlertDialogCancel>
                  <AlertDialogAction
                    variant="destructive"
                    onClick={async () => {
                      setIsDeletingWish(true);
                      try {
                        await onDeleteWish();
                      } catch {
                        // upstream owns the visible error state
                      } finally {
                        setIsDeletingWish(false);
                      }
                    }}
                  >
                    {isDeletingWish ? "Deleting…" : "Delete"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MetadataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-sm text-neutral-300">{label}</span>
      <span className="rounded border border-white/10 bg-black px-2.5 py-1 text-sm font-medium tabular-nums text-white">
        {value}
      </span>
    </div>
  );
}
