import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type * as React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

// The resend action lives inside `handleResendInvitation`, defined inline in the
// `$id` org-detail route component (`OrgDetailPage`) and never exported. Mock
// `@tanstack/react-router` so `createFileRoute` is a passthrough handing the
// options object back — `Route.options.component` is then the raw component.
// The component also calls `Route.useLoaderData()` and `useRouter()`, so the
// passthrough object carries a `useLoaderData` stub and `useRouter` is exported.
// This mirrors org-new.dom.test.tsx's route-mocking precedent.
const h = vi.hoisted(() => ({
  loaderData: null as unknown,
  invalidate: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute:
    () =>
    (options: Record<string, unknown>): Record<string, unknown> => ({
      options,
      useLoaderData: () => h.loaderData,
    }),
  useRouter: () => ({ invalidate: h.invalidate }),
}));

// Server fns hit guestlist through RPC; mock the whole module so nothing
// touches the network. Every export the route (and its child modals) imports
// is stubbed — only `resendOrgInvitation` is driven here. This exercises the
// route's toast/refresh wiring.
vi.mock("@/lib/org-admin.functions", () => ({
  getOrgForAdmin: vi.fn(),
  resendOrgInvitation: vi.fn(),
  updateOrgMemberRole: vi.fn(),
  removeOrgMember: vi.fn(),
  cancelOrgInvitation: vi.fn(),
  createOrgInvitation: vi.fn(),
  addOrgMember: vi.fn(),
  updateOrgAsOperator: vi.fn(),
}));

// Assert on toast copy directly.
vi.mock("@si/ui/components/sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

// The "Resend email" action sits behind a Base UI dropdown whose open/close
// needs pointer + scrollIntoView plumbing jsdom lacks. Mock the primitive to
// passthrough wrappers so the menu items are always rendered and directly
// clickable — the unit under test is `handleResendInvitation`/toast wiring,
// not the dropdown internals (those get real coverage in
// member-actions.dom.test.tsx).
vi.mock("@si/ui/components/dropdown-menu", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    DropdownMenuItem: ({
      children,
      onClick,
    }: {
      children: React.ReactNode;
      onClick?: () => void;
    }) => (
      <button type="button" onClick={onClick}>
        {children}
      </button>
    ),
  };
});

import { Route } from "@/routes/_dashboard/admin/orgs/$id";
import { resendOrgInvitation } from "@/lib/org-admin.functions";
import { toast } from "@si/ui/components/sonner";

const OrgDetailPage = (Route as unknown as { options: { component: () => React.JSX.Element } })
  .options.component;

const resendMock = vi.mocked(resendOrgInvitation);
const toastSuccess = vi.mocked(toast.success);
const toastWarning = vi.mocked(toast.warning);
const toastError = vi.mocked(toast.error);

const ORG_ID = "org_9";
const INVITATION_ID = "inv_42";

function seedLoaderData() {
  h.loaderData = {
    organization: {
      id: ORG_ID,
      slug: "acme",
      name: "Acme",
      logo: null,
      createdAt: Date.now(),
      metadata: null,
    },
    members: [],
    invitations: [
      {
        id: INVITATION_ID,
        email: "invitee@example.com",
        role: "member",
        status: "pending",
        expiresAt: Date.now() + 86_400_000,
        inviterName: "Op Erator",
      },
    ],
  };
}

/** Render the page and click the (always-visible, mocked-dropdown) Resend item. */
async function clickResend() {
  render(<OrgDetailPage />);
  await act(async () => {
    fireEvent.click(screen.getByText("Resend email"));
  });
}

beforeEach(() => {
  seedLoaderData();
  resendMock.mockReset();
  h.invalidate.mockReset();
  toastSuccess.mockReset();
  toastWarning.mockReset();
  toastError.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("OrgDetailPage — resend invitation", () => {
  test("clicking Resend calls resendOrgInvitation with the org + invitation ids", async () => {
    resendMock.mockResolvedValue({ ok: true, emailSent: true, expiresAt: Date.now() });
    await clickResend();

    expect(resendMock).toHaveBeenCalledTimes(1);
    expect(resendMock).toHaveBeenCalledWith({
      data: { orgId: ORG_ID, invitationId: INVITATION_ID },
    });
  });

  test("shows the success toast when the server reports emailSent: true", async () => {
    resendMock.mockResolvedValue({ ok: true, emailSent: true, expiresAt: Date.now() });
    await clickResend();

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Invitation email resent"));
    expect(toastWarning).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
    expect(h.invalidate).toHaveBeenCalled();
  });

  test("shows the warning toast when ok but emailSent: false", async () => {
    resendMock.mockResolvedValue({ ok: true, emailSent: false, expiresAt: Date.now() });
    await clickResend();

    await waitFor(() =>
      expect(toastWarning).toHaveBeenCalledWith(
        "Invitation renewed — email delivery unavailable, copy the link instead",
      ),
    );
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
    expect(h.invalidate).toHaveBeenCalled();
  });

  test("shows the error toast with the server message when the invitation is no longer pending", async () => {
    resendMock.mockResolvedValue({
      ok: false,
      error: "invitation_not_pending",
      message: "Invitation is already accepted.",
    });
    await clickResend();

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Invitation is already accepted."));
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastWarning).not.toHaveBeenCalled();
  });
});
