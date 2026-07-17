import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

// The modal's only external edges are the better-auth client calls; mock the
// client module so no network happens. Invite mode composes TWO calls
// (admin.createUser without a password, then signIn.magicLink) — the tests
// pin that composition, including the already-exists degradation.
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    admin: { createUser: vi.fn() },
    signIn: { magicLink: vi.fn() },
  },
}));

import { AddUserModal } from "@/components/admin/add-user-modal";
import { authClient } from "@/lib/auth-client";

const createUserMock = vi.mocked(authClient.admin.createUser);
const magicLinkMock = vi.mocked(authClient.signIn.magicLink);

function renderModal() {
  const onOpenChange = vi.fn();
  const onSuccess = vi.fn();
  const utils = render(<AddUserModal open onOpenChange={onOpenChange} onSuccess={onSuccess} />);
  return { ...utils, onOpenChange, onSuccess };
}

const emailInput = () => screen.getByLabelText("Email") as HTMLInputElement;
const nameInput = () => screen.getByLabelText("Name") as HTMLInputElement;

beforeEach(() => {
  createUserMock.mockReset();
  magicLinkMock.mockReset();
  createUserMock.mockResolvedValue({ data: { user: { id: "u_new" } }, error: null } as never);
  magicLinkMock.mockResolvedValue({ data: { status: true }, error: null } as never);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("AddUserModal — invite mode", () => {
  test("creates the account credential-less, then sends a magic link to /welcome", async () => {
    renderModal();
    fireEvent.change(emailInput(), { target: { value: "new.person@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send invite" }));

    await screen.findByText(/Invite sent to new.person@example.com/);

    expect(createUserMock).toHaveBeenCalledTimes(1);
    const createArgs = createUserMock.mock.calls[0]![0] as Record<string, unknown>;
    // No password: invited accounts get no credential until the invitee
    // sets one; name defaults to the email local part.
    expect(createArgs).not.toHaveProperty("password");
    expect(createArgs.name).toBe("new.person");
    expect(createArgs.role).toBe("user");

    expect(magicLinkMock).toHaveBeenCalledTimes(1);
    const linkArgs = magicLinkMock.mock.calls[0]![0] as { email: string; callbackURL: string };
    expect(linkArgs.email).toBe("new.person@example.com");
    expect(linkArgs.callbackURL).toMatch(/\/welcome$/);
  });

  test("degrades to a plain sign-in link when the account already exists", async () => {
    createUserMock.mockResolvedValue({
      data: null,
      error: { code: "USER_ALREADY_EXISTS", message: "User already exists", status: 400 },
    } as never);
    renderModal();
    fireEvent.change(emailInput(), { target: { value: "old@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send invite" }));

    await screen.findByText(/already exists — sent a sign-in link/);
    expect(magicLinkMock).toHaveBeenCalledTimes(1);
  });

  test("surfaces a create failure without sending the email", async () => {
    createUserMock.mockResolvedValue({
      data: null,
      error: { code: "SOMETHING_ELSE", message: "nope", status: 500 },
    } as never);
    renderModal();
    fireEvent.change(emailInput(), { target: { value: "x@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send invite" }));

    await screen.findByText("nope");
    expect(magicLinkMock).not.toHaveBeenCalled();
  });
});

describe("AddUserModal — create mode", () => {
  function switchToCreate() {
    fireEvent.click(screen.getByRole("radio", { name: "Create directly" }));
  }

  test("rejects a short password before calling the API", async () => {
    renderModal();
    switchToCreate();
    fireEvent.change(emailInput(), { target: { value: "p@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "short" } });
    fireEvent.click(screen.getByRole("button", { name: "Create user" }));

    await screen.findByText("Password must be at least 8 characters.");
    expect(createUserMock).not.toHaveBeenCalled();
  });

  test("creates with password, explicit name, and emailVerified data", async () => {
    renderModal();
    switchToCreate();
    fireEvent.change(emailInput(), { target: { value: "direct@example.com" } });
    fireEvent.change(nameInput(), { target: { value: "Direct Person" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "hunter2hunter2" } });
    fireEvent.click(screen.getByRole("button", { name: "Create user" }));

    await screen.findByText(/Account created for direct@example.com/);

    const createArgs = createUserMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(createArgs.password).toBe("hunter2hunter2");
    expect(createArgs.name).toBe("Direct Person");
    expect(createArgs.data).toEqual({ emailVerified: true });
    expect(magicLinkMock).not.toHaveBeenCalled();
    // The password stays visible for copying after creation.
    expect(screen.getByText("hunter2hunter2")).toBeInTheDocument();
  });
});
