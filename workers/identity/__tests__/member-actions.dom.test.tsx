import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemberActions } from "@/components/admin/member-actions";

// Regression test for a real Base UI crash: `DropdownMenuLabel` (Menu.GroupLabel)
// throws "MenuGroupContext is missing" unless it's rendered inside a
// `DropdownMenuGroup` (Menu.Group) ancestor. The dropdown-menu primitive is
// deliberately left UNMOCKED here — the bug lives inside Base UI's real menu
// internals, so mocking the module away would hide the exact regression this
// test exists to catch.
function renderActions(overrides: Partial<React.ComponentProps<typeof MemberActions>> = {}) {
  const onChangeRole = vi.fn();
  const onRemove = vi.fn();
  const props = {
    memberName: "Ada Lovelace",
    orgName: "Acme",
    currentRole: "member" as const,
    isOnlyOwner: false,
    onChangeRole,
    onRemove,
    ...overrides,
  };
  const utils = render(<MemberActions {...props} />);
  return { ...utils, onChangeRole, onRemove };
}

/** Open the (real, unmocked) Base UI dropdown by clicking its trigger. */
async function openMenu() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Actions for Ada Lovelace" }));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("MemberActions — dropdown menu", () => {
  test("opening the menu does not throw and renders the role group + label", async () => {
    renderActions();
    await openMenu();

    expect(screen.getByText("Change role")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Owner" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Admin" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Member" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Remove from org" })).toBeInTheDocument();
  });

  test("disables the current role and the only-owner-guarded items", async () => {
    renderActions({ currentRole: "admin", isOnlyOwner: true });
    await openMenu();

    expect(screen.getByRole("menuitem", { name: "Admin" })).toHaveAttribute("data-disabled");
    expect(screen.getByRole("menuitem", { name: "Member" })).toHaveAttribute("data-disabled");
    expect(screen.getByRole("menuitem", { name: "Remove from org" })).toHaveAttribute(
      "data-disabled",
    );
    expect(screen.getByRole("menuitem", { name: "Owner" })).not.toHaveAttribute("data-disabled");
  });

  test("clicking a role item calls onChangeRole with that role", async () => {
    const { onChangeRole } = renderActions({ currentRole: "member" });
    await openMenu();

    fireEvent.click(screen.getByRole("menuitem", { name: "Admin" }));

    expect(onChangeRole).toHaveBeenCalledWith("admin");
  });

  test("clicking Remove from org opens the remove confirmation dialog", async () => {
    renderActions();
    await openMenu();

    fireEvent.click(screen.getByRole("menuitem", { name: "Remove from org" }));

    expect(
      await screen.findByRole("heading", { name: "Remove Ada Lovelace?" }),
    ).toBeInTheDocument();
  });
});
