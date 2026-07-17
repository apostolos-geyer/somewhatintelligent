import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    admin: { updateUser: vi.fn() },
  },
}));

import { EditUserDialog } from "@/components/admin/edit-user-dialog";
import { authClient } from "@/lib/auth-client";

const updateUserMock = vi.mocked(authClient.admin.updateUser);

const baseUser = {
  id: "u_1",
  name: "Ada Lovelace",
  email: "ada@example.com",
  username: "ada",
};

function renderDialog(overrides: Partial<React.ComponentProps<typeof EditUserDialog>> = {}) {
  const onOpenChange = vi.fn();
  const onSuccess = vi.fn();
  const props = {
    user: baseUser,
    open: true,
    onOpenChange,
    onSuccess,
    ...overrides,
  };
  const utils = render(<EditUserDialog {...props} />);
  return { ...utils, onOpenChange, onSuccess };
}

const usernameInput = () => screen.getByLabelText("Username") as HTMLInputElement;
const submit = () => screen.getByRole("button", { name: "Save changes" });

beforeEach(() => {
  updateUserMock.mockReset();
  updateUserMock.mockResolvedValue({ data: { user: baseUser }, error: null } as never);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("EditUserDialog — username contract", () => {
  test("rejects usernames outside the plugin contract without calling the API", async () => {
    renderDialog();
    fireEvent.change(usernameInput(), { target: { value: "bad handle!" } });
    fireEvent.click(submit());

    await screen.findByText(/Username must be 3–30 characters/);
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  test("rejects too-short usernames", async () => {
    renderDialog();
    fireEvent.change(usernameInput(), { target: { value: "ab" } });
    fireEvent.click(submit());

    await screen.findByText(/Username must be 3–30 characters/);
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  test("accepts a contract-conforming username and submits only changed fields", async () => {
    const { onOpenChange, onSuccess } = renderDialog();
    fireEvent.change(usernameInput(), { target: { value: "ada.lovelace_2" } });
    fireEvent.click(submit());

    await vi.waitFor(() => expect(updateUserMock).toHaveBeenCalledTimes(1));
    expect(updateUserMock.mock.calls[0]![0]).toEqual({
      userId: "u_1",
      data: { username: "ada.lovelace_2" },
    });
    await vi.waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onSuccess).toHaveBeenCalled();
  });

  test("closes without an API call when nothing changed", () => {
    const { onOpenChange } = renderDialog();
    fireEvent.click(submit());

    expect(updateUserMock).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
