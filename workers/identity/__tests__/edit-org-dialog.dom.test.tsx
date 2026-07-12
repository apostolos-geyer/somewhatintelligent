import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

// EditOrgDialog is a standalone controlled component (no router binding), so it
// mounts directly — the only external edge is the `updateOrgAsOperator` server
// fn, which hits guestlist through RPC. Mock the module so no network call
// happens; only the one export this dialog imports is needed. This exercises
// the dialog's own state machine (pre-fill, auto-slug, submit/error handling).
vi.mock("@/lib/org-admin.functions", () => ({
  updateOrgAsOperator: vi.fn(),
}));

import { EditOrgDialog } from "@/components/admin/edit-org-dialog";
import { updateOrgAsOperator } from "@/lib/org-admin.functions";

const updateMock = vi.mocked(updateOrgAsOperator);

function renderDialog(overrides: Partial<React.ComponentProps<typeof EditOrgDialog>> = {}) {
  const onOpenChange = vi.fn();
  const onSuccess = vi.fn();
  const props = {
    orgId: "org_1",
    currentName: "Acme Corp",
    currentSlug: "acme-corp",
    open: true,
    onOpenChange,
    onSuccess,
    ...overrides,
  };
  const utils = render(<EditOrgDialog {...props} />);
  return { ...utils, onOpenChange, onSuccess };
}

const nameInput = () => screen.getByLabelText("Organization name") as HTMLInputElement;
const slugInput = () => screen.getByLabelText("Slug") as HTMLInputElement;

beforeEach(() => {
  updateMock.mockReset();
  updateMock.mockResolvedValue({
    ok: true,
    organization: { id: "org_1", slug: "acme-corp", name: "Acme Corp" },
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("EditOrgDialog — pre-fill", () => {
  test("pre-fills name and slug from the current org props", () => {
    renderDialog();
    expect(nameInput()).toHaveValue("Acme Corp");
    // The auto-slug effect derives slug from name on open; with a matching
    // currentSlug the field simply reflects the org's existing slug.
    expect(slugInput()).toHaveValue("acme-corp");
  });

  test("renders the dialog's rename-effect caveat copy in the description", () => {
    renderDialog();
    expect(
      screen.getByText("Renames apply to sign-in and admin surfaces immediately."),
    ).toBeInTheDocument();
  });
});

describe("EditOrgDialog — slug auto-suggest lifecycle", () => {
  test("editing the name auto-updates the slug while the slug is untouched", () => {
    renderDialog();
    fireEvent.change(nameInput(), { target: { value: "New Brand" } });
    expect(slugInput()).toHaveValue("new-brand");
  });

  test("editing the slug directly marks it touched so later name edits stop auto-updating it", () => {
    renderDialog();
    // Touch the slug directly.
    fireEvent.change(slugInput(), { target: { value: "custom-slug" } });
    expect(slugInput()).toHaveValue("custom-slug");

    // A subsequent name edit must NOT clobber the operator's chosen slug.
    fireEvent.change(nameInput(), { target: { value: "Whatever Co" } });
    expect(nameInput()).toHaveValue("Whatever Co");
    expect(slugInput()).toHaveValue("custom-slug");
  });
});

describe("EditOrgDialog — save", () => {
  test("Save calls updateOrgAsOperator with the edited name/slug, then onSuccess + close", async () => {
    const { onOpenChange, onSuccess } = renderDialog();

    fireEvent.change(nameInput(), { target: { value: "Renamed Org" } });
    // slug auto-follows to "renamed-org" (untouched).
    expect(slugInput()).toHaveValue("renamed-org");

    updateMock.mockResolvedValueOnce({
      ok: true,
      organization: { id: "org_1", slug: "renamed-org", name: "Renamed Org" },
    });

    // Radix/Base UI Dialog portals its content outside the render container,
    // so reach the form via the input's ancestor rather than
    // container.querySelector.
    const form = nameInput().closest("form");
    expect(form).not.toBeNull();
    await act(async () => {
      fireEvent.submit(form as HTMLFormElement);
    });

    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateMock).toHaveBeenCalledWith({
      data: { orgId: "org_1", name: "Renamed Org", slug: "renamed-org" },
    });
    expect(onSuccess).toHaveBeenCalledWith({
      id: "org_1",
      slug: "renamed-org",
      name: "Renamed Org",
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  test("a slug_taken failure surfaces the field error and keeps the dialog open", async () => {
    const { onOpenChange, onSuccess } = renderDialog();
    updateMock.mockResolvedValueOnce({
      ok: false,
      error: "slug_taken",
      message: "Slug already taken",
    });

    await act(async () => {
      fireEvent.submit(nameInput().closest("form") as HTMLFormElement);
    });

    expect(screen.getByText("This slug is already taken.")).toBeInTheDocument();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  test("an unknown failure surfaces the server's generic error message", async () => {
    const { onOpenChange, onSuccess } = renderDialog();
    updateMock.mockResolvedValueOnce({
      ok: false,
      error: "unknown",
      message: "Something went wrong upstream.",
    });

    await act(async () => {
      fireEvent.submit(nameInput().closest("form") as HTMLFormElement);
    });

    expect(screen.getByText("Something went wrong upstream.")).toBeInTheDocument();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
