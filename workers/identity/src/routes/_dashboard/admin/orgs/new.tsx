import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Button } from "@si/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@si/ui/components/card";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@si/ui/components/sheet";
import { Input } from "@si/ui/components/input";
import { Label } from "@si/ui/components/label";
import { Field, FieldDescription, FieldError } from "@si/ui/components/field";
import { Alert } from "@si/ui/components/alert";
import { Avatar, AvatarFallback, AvatarImage } from "@si/ui/components/avatar";
import { toast } from "@si/ui/components/sonner";
import {
  createOrgAsOperator,
  searchUsersByEmail,
  type UserSearchHit,
} from "@/lib/org-admin.functions";

export const Route = createFileRoute("/_dashboard/admin/orgs/new")({
  head: () => ({ meta: [{ title: "New Organization — Admin" }] }),
  component: NewOrgPage,
});

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function kebabize(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function NewOrgPage() {
  const navigate = useNavigate();
  const router = useRouter();

  // Form state — plain useState rather than tanstack-form, because the
  // owner-email field combines an async autocomplete with a pinned userId
  // that doesn't fit cleanly into the form-field abstraction.
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [ownerEmail, setOwnerEmail] = useState("");
  const [ownerUserId, setOwnerUserId] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<UserSearchHit[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slugError, setSlugError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);

  // Auto-suggest slug from name on the user's first keystroke into name,
  // up until they touch the slug field manually.
  useEffect(() => {
    if (!slugTouched) {
      setSlug(kebabize(name));
    }
  }, [name, slugTouched]);

  // Debounced email autocomplete.
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (ownerEmail.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    if (ownerUserId) {
      // User picked a result — don't keep searching while they look at it.
      return;
    }
    searchTimerRef.current = setTimeout(async () => {
      try {
        const res = await searchUsersByEmail({ data: { email: ownerEmail.trim() } });
        setSearchResults(res.users);
        setSearchOpen(true);
      } catch {
        // Silent — the autocomplete is non-essential.
      }
    }, 250);
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [ownerEmail, ownerUserId]);

  function selectUser(u: UserSearchHit) {
    setOwnerUserId(u.id);
    setOwnerEmail(u.email);
    setSearchOpen(false);
    setEmailError(null);
  }

  function clearUser() {
    setOwnerUserId(null);
    setOwnerEmail("");
    setSearchResults([]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSlugError(null);
    setEmailError(null);

    if (name.trim().length < 2) {
      setError("Name must be at least 2 characters.");
      return;
    }
    if (!SLUG_PATTERN.test(slug)) {
      setSlugError("Slug must be lowercase letters, digits, and single hyphens.");
      return;
    }
    if (!ownerUserId) {
      setEmailError("Pick an existing user from the dropdown. They must sign up first.");
      return;
    }

    setSubmitting(true);
    try {
      const result = await createOrgAsOperator({
        data: { name: name.trim(), slug, ownerUserId },
      });
      if (!result.ok) {
        if (result.error === "slug_taken") {
          setSlugError("This slug is already taken.");
        } else {
          setError(result.message);
        }
        setSubmitting(false);
        return;
      }
      toast.success(`Created ${result.organization.name}`);
      // `admin/orgs.tsx` stays mounted as the persistent background list —
      // invalidate so it includes the new org once the user navigates back.
      await router.invalidate();
      await navigate({ to: "/admin/orgs/$id", params: { id: result.organization.id } });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) void navigate({ to: "/admin/orgs" });
      }}
    >
      <SheetContent size="full">
        <SheetHeader>
          <SheetTitle>New organization</SheetTitle>
          <p className="text-sm text-text-secondary">
            Provision a new brand on this platform. The owner must already have a user account.
          </p>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 pb-4">
          <Card className="max-w-2xl">
            <CardHeader>
              <CardTitle>Brand details</CardTitle>
              <CardDescription>The owner gains full control of the organization.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="flex flex-col gap-5">
                <Field>
                  <Label htmlFor="org-name">Organization name</Label>
                  <Input
                    id="org-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Acme, Inc."
                    minLength={2}
                    maxLength={60}
                    required
                    autoFocus
                  />
                  <FieldDescription>The human-readable display name (2–60 chars).</FieldDescription>
                </Field>

                <Field>
                  <Label htmlFor="org-slug">Slug</Label>
                  <Input
                    id="org-slug"
                    value={slug}
                    onChange={(e) => {
                      setSlugTouched(true);
                      setSlug(e.target.value.toLowerCase());
                      setSlugError(null);
                    }}
                    placeholder="acme"
                    pattern="^[a-z0-9]+(-[a-z0-9]+)*$"
                    minLength={2}
                    maxLength={48}
                    required
                    aria-invalid={slugError ? true : undefined}
                  />
                  <FieldDescription>
                    URL: <code className="font-mono">/o/{slug || "<slug>"}/...</code>
                  </FieldDescription>
                  {slugError && <FieldError errors={[{ message: slugError }]} />}
                </Field>

                <Field>
                  <Label htmlFor="owner-email">Owner email</Label>
                  <div className="relative">
                    <Input
                      id="owner-email"
                      type="email"
                      value={ownerEmail}
                      onChange={(e) => {
                        setOwnerUserId(null);
                        setOwnerEmail(e.target.value);
                        setEmailError(null);
                      }}
                      onFocus={() => {
                        if (searchResults.length > 0) setSearchOpen(true);
                      }}
                      onBlur={() => {
                        // Defer hiding so a click on a result still fires.
                        setTimeout(() => setSearchOpen(false), 150);
                      }}
                      placeholder="owner@brand.com"
                      required
                      aria-invalid={emailError ? true : undefined}
                      disabled={!!ownerUserId}
                    />
                    {ownerUserId && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="absolute top-1/2 right-1 -translate-y-1/2"
                        onClick={clearUser}
                      >
                        Change
                      </Button>
                    )}
                    {searchOpen && searchResults.length > 0 && !ownerUserId && (
                      <div className="absolute z-10 mt-1 w-full overflow-hidden border-[3px] border-border-strong bg-surface-raised shadow-soft-md">
                        {searchResults.map((u) => (
                          <button
                            key={u.id}
                            type="button"
                            onMouseDown={(e) => {
                              // Prevent input blur from firing before click.
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
                  <FieldDescription>
                    Type to search existing users by email. They must sign up first; only matched
                    users can be promoted to owner.
                  </FieldDescription>
                  {emailError && <FieldError errors={[{ message: emailError }]} />}
                </Field>

                {error && <Alert variant="destructive">{error}</Alert>}

                <div className="flex justify-end gap-2 pt-2">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => navigate({ to: "/admin/orgs" })}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={submitting}>
                    {submitting ? "Creating…" : "Create organization"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      </SheetContent>
    </Sheet>
  );
}
