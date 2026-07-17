import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    admin: { setRole: vi.fn() },
  },
}));

import { UserRoleDialog, resolveRoles } from "@/components/admin/user-role-dialog";
import { authClient } from "@/lib/auth-client";

const setRoleMock = vi.mocked(authClient.admin.setRole);

function renderDialog(overrides: Partial<React.ComponentProps<typeof UserRoleDialog>> = {}) {
  const onOpenChange = vi.fn();
  const onSuccess = vi.fn();
  const props = {
    userId: "u_1",
    userEmail: "person@example.com",
    currentRole: "user",
    open: true,
    onOpenChange,
    onSuccess,
    ...overrides,
  };
  const utils = render(<UserRoleDialog {...props} />);
  return { ...utils, onOpenChange, onSuccess };
}

const userCheckbox = () => screen.getByRole("checkbox", { name: "User" });
const adminCheckbox = () => screen.getByRole("checkbox", { name: "Admin" });
const submitButton = () => screen.getByRole("button", { name: "Change roles" });

beforeEach(() => {
  setRoleMock.mockReset();
  setRoleMock.mockResolvedValue({ data: { user: { id: "u_1" } }, error: null } as never);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("resolveRoles — csv role values (better-auth admin plugin)", () => {
  test("multi-role csv resolves by membership, not string equality", () => {
    // "admin,user" holds both — comparing `=== "admin"` is the documented
    // footgun in @somewhatintelligent/kit/roles.
    expect(resolveRoles("admin,user")).toEqual(["user", "admin"]);
    expect(resolveRoles("user,admin")).toEqual(["user", "admin"]);
  });

  test("falls back to the configured default for empty/unknown roles", () => {
    expect(resolveRoles(null)).toEqual(["user"]);
    expect(resolveRoles(undefined)).toEqual(["user"]);
    expect(resolveRoles("something-custom")).toEqual(["user"]);
  });

  test("plain roles resolve to themselves", () => {
    expect(resolveRoles("user")).toEqual(["user"]);
    expect(resolveRoles("admin")).toEqual(["admin"]);
  });
});

describe("UserRoleDialog", () => {
  test("seeds checkboxes from the csv role value and disables submit while unchanged", () => {
    renderDialog({ currentRole: "admin,user" });
    expect(userCheckbox()).toBeChecked();
    expect(adminCheckbox()).toBeChecked();
    expect(submitButton()).toBeDisabled();
  });

  test("submitting a changed selection calls admin.setRole with the role array", async () => {
    const { onOpenChange, onSuccess } = renderDialog({ currentRole: "user" });

    fireEvent.click(adminCheckbox());
    expect(submitButton()).toBeEnabled();
    fireEvent.click(submitButton());

    await vi.waitFor(() => expect(setRoleMock).toHaveBeenCalledTimes(1));
    // Declared order, so the stored csv stays deterministic.
    expect(setRoleMock.mock.calls[0]![0]).toEqual({ userId: "u_1", role: ["user", "admin"] });
    await vi.waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onSuccess).toHaveBeenCalled();
  });

  test("deselecting every role disables submit", () => {
    renderDialog({ currentRole: "user" });
    fireEvent.click(userCheckbox());
    expect(submitButton()).toBeDisabled();
  });
});
