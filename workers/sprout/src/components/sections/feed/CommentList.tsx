import { Heart, Trash2 } from "lucide-react";
import { Avatar, AvatarFallback } from "@greenroom/ui/components/avatar";
import { Badge } from "@greenroom/ui/components/badge";
import { Button } from "@greenroom/ui/components/button";
import { cn } from "@greenroom/ui/lib/utils";
import type { CommentView } from "@/lib/feed.functions";
import { formatWhen, initialsFromName } from "@/lib/format";

/**
 * The live comment list for a post overlay. Each row shows the author (with a
 * Team marker when `brandTeam`), the body, a heart toggle with the live count, and
 * a soft-delete control when the caller may remove it (`canDelete` — own comment,
 * or admin-any, decided by the parent). Oldest-first, matching the read order.
 */
export function CommentList({
  comments,
  canDelete,
  onHeart,
  onDelete,
}: {
  comments: CommentView[];
  /** Decides whether the trash affordance shows for a given comment. */
  canDelete: (comment: CommentView) => boolean;
  onHeart: (comment: CommentView) => void;
  onDelete: (comment: CommentView) => void;
}) {
  if (comments.length === 0) {
    return (
      <p className="px-1 py-6 text-center text-sm text-muted-foreground">
        No comments yet. Be the first.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {comments.map((comment) => (
        <li key={comment.id} className="flex gap-2.5">
          <Avatar size="sm" className="mt-0.5 shrink-0">
            <AvatarFallback className="text-[10px] font-semibold text-primary-foreground bg-primary">
              {initialsFromName(comment.authorName)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-sm font-semibold text-foreground">
                {comment.authorName}
              </span>
              {comment.brandTeam && (
                <Badge variant="sprout-glass" className="px-1.5 py-0 text-[10px]">
                  Team
                </Badge>
              )}
              <span className="shrink-0 text-[11px] text-text-tertiary">
                {formatWhen(comment.createdAt)}
              </span>
            </div>
            <p className="whitespace-pre-wrap break-words text-sm text-foreground">
              {comment.body}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-center gap-1">
            <button
              type="button"
              onClick={() => onHeart(comment)}
              aria-label={comment.hearted ? "Remove heart" : "Heart comment"}
              aria-pressed={comment.hearted}
              className={cn(
                "flex items-center gap-1 rounded-sm px-1 py-0.5 text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                comment.hearted ? "text-pistil" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Heart className={cn("size-3.5", comment.hearted && "fill-current")} aria-hidden />
              {comment.heartCount > 0 && <span>{comment.heartCount}</span>}
            </button>
            {canDelete(comment) && (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="size-6 text-destructive hover:bg-destructive/10"
                aria-label="Delete comment"
                onClick={() => onDelete(comment)}
              >
                <Trash2 className="size-3.5" aria-hidden />
              </Button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
