import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@si/ui/components/dialog";
import { Button } from "@si/ui/components/button";
import { Input } from "@si/ui/components/input";
import { Label } from "@si/ui/components/label";
import { Field, FieldDescription } from "@si/ui/components/field";
import { Alert } from "@si/ui/components/alert";
import { Avatar, AvatarFallback, AvatarImage } from "@si/ui/components/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@si/ui/components/select";
import { addOrgMember, searchUsersByEmail, type UserSearchHit } from "@/lib/org-admin.functions";

type Role = "owner" | "admin" | "member";

export function AddMemberModal({
  orgId,
  open,
  onOpenChange,
  onSuccess,
}: {
  orgId: string;
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onSuccess: () => void;
}) {
  const [email, setEmail] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const [role, setRole] = useState<Role>("member");
  const [results, setResults] = useState<UserSearchHit[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset when the modal opens.
  useEffect(() => {
    if (open) {
      setEmail("");
      setUserId(null);
      setRole("member");
      setResults([]);
      setError(null);
    }
  }, [open]);

  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (email.trim().length < 2 || userId) {
      setResults([]);
      return;
    }
    searchTimerRef.current = setTimeout(async () => {
      try {
        const res = await searchUsersByEmail({ data: { email: email.trim() } });
        setResults(res.users);
        setSearchOpen(true);
      } catch {
        /* silent */
      }
    }, 250);
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [email, userId]);

  function selectUser(u: UserSearchHit) {
    setUserId(u.id);
    setEmail(u.email);
    setSearchOpen(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!userId) {
      setError("Pick an existing user from the dropdown.");
      return;
    }
    setSubmitting(true);
    try {
      await addOrgMember({ data: { orgId, userId, role } });
      onSuccess();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add member");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add member</DialogTitle>
          <DialogDescription>
            Add an existing user to this organization. They get access immediately.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Field>
            <Label htmlFor="add-member-email">Email</Label>
            <div className="relative">
              <Input
                id="add-member-email"
                type="email"
                value={email}
                onChange={(e) => {
                  setUserId(null);
                  setEmail(e.target.value);
                }}
                onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
                placeholder="user@example.com"
                disabled={!!userId}
                autoFocus
              />
              {userId && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute top-1/2 right-1 -translate-y-1/2"
                  onClick={() => {
                    setUserId(null);
                    setEmail("");
                  }}
                >
                  Change
                </Button>
              )}
              {searchOpen && results.length > 0 && !userId && (
                <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-sm border-2 border-border-strong bg-surface-raised shadow-soft-md">
                  {results.map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        selectUser(u);
                      }}
                      className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-surface-sunken"
                    >
                      <Avatar size="sm">
                        {u.image ? <AvatarImage src={u.image} alt="" /> : null}
                        <AvatarFallback>
                          {(u.name ?? u.email).charAt(0).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1">
                        <div className="text-sm font-medium">{u.name ?? "—"}</div>
                        <div className="font-mono text-xs text-text-tertiary">{u.email}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <FieldDescription>Only existing users are eligible.</FieldDescription>
          </Field>

          <Field>
            <Label htmlFor="add-member-role">Role</Label>
            <Select value={role} onValueChange={(v) => v && setRole(v as Role)}>
              <SelectTrigger id="add-member-role" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="member">Member</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="owner">Owner</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          {error && <Alert variant="destructive">{error}</Alert>}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !userId}>
              {submitting ? "Adding…" : "Add member"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
