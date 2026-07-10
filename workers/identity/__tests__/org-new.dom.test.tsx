import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type * as React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";

// The route component (`NewOrgPage`) is defined inline inside a
// `createFileRoute(...)({ component })` call and never exported on its own. Mock
// `@tanstack/react-router` so `createFileRoute` becomes a passthrough that hands
// the options object straight back — then `Route.options.component` IS the raw
// component, rendered with no router runtime. `useNavigate` is stubbed for the
// same reason (the guard journey under test never navigates).
vi.mock("@tanstack/react-router", () => ({
  createFileRoute:
    () =>
    (options: unknown): { options: unknown } => ({ options }),
  useNavigate: () => vi.fn(),
}));

// The server fns hit guestlist through RPC; mock the module so no network or
// database call happens. Only the two the owner-picker journey drives are used.
vi.mock("@/lib/org-admin.functions", () => ({
  searchUsersByEmail: vi.fn(),
  createOrgAsOperator: vi.fn(),
}));

import { Route } from "@/routes/_dashboard/admin/orgs/new";
import {
  searchUsersByEmail,
  createOrgAsOperator,
  type UserSearchHit,
} from "@/lib/org-admin.functions";

const NewOrgPage = (Route as unknown as { options: { component: () => React.JSX.Element } }).options
  .component;

const USERS: UserSearchHit[] = [
  { id: "u1", name: "Owner One", email: "owner@brand.com", image: null },
  { id: "u2", name: "Owner Two", email: "owner2@brand.com", image: null },
];

const searchMock = vi.mocked(searchUsersByEmail);
const createMock = vi.mocked(createOrgAsOperator);

/** Advance the SearchCombobox debounce window and flush the search promise. */
async function flushDebounce(ms = 250) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** Drive keystrokes through `fireEvent.change` (userEvent isn't a repo dep). */
function typeInto(input: HTMLElement, values: string[]) {
  for (const v of values) fireEvent.change(input, { target: { value: v } });
}

beforeEach(() => {
  vi.useFakeTimers();
  searchMock.mockReset();
  searchMock.mockResolvedValue({ users: USERS });
  createMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("NewOrgPage — owner-email search", () => {
  test("typing 2+ chars triggers the (mocked) searchUsersByEmail after the debounce", async () => {
    render(<NewOrgPage />);
    const owner = screen.getByRole("combobox");

    typeInto(owner, ["o", "ow"]);
    // Below the debounce window nothing has fired yet.
    expect(searchMock).not.toHaveBeenCalled();

    await flushDebounce();
    expect(searchMock).toHaveBeenCalledTimes(1);
    expect(searchMock).toHaveBeenCalledWith({ data: { email: "ow" } });
  });

  test("does not search while the query is below minChars (2)", async () => {
    render(<NewOrgPage />);
    typeInto(screen.getByRole("combobox"), ["o"]); // 1 char
    await flushDebounce();
    expect(searchMock).not.toHaveBeenCalled();
  });

  test("renders each result row (name + email) once the search resolves", async () => {
    render(<NewOrgPage />);
    typeInto(screen.getByRole("combobox"), ["ow"]);
    await flushDebounce();

    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(2);
    expect(screen.getByText("Owner One")).toBeInTheDocument();
    expect(screen.getByText("owner@brand.com")).toBeInTheDocument();
    expect(screen.getByText("owner2@brand.com")).toBeInTheDocument();
  });
});

describe("NewOrgPage — pinning the owner", () => {
  test("clicking a result pins it: input disabled + showing the email, Change appears", async () => {
    render(<NewOrgPage />);
    const owner = screen.getByRole("combobox") as HTMLInputElement;
    typeInto(owner, ["ow"]);
    await flushDebounce();

    // onMouseDown (not click) is what the combobox wires, to beat input blur.
    fireEvent.mouseDown(screen.getByText("owner@brand.com"));

    expect(owner).toBeDisabled();
    expect(owner).toHaveValue("owner@brand.com");
    expect(screen.getByRole("button", { name: "Change" })).toBeInTheDocument();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  test("clicking Change unpins: the input is editable + empty again and searchable", async () => {
    render(<NewOrgPage />);
    const owner = screen.getByRole("combobox") as HTMLInputElement;
    typeInto(owner, ["ow"]);
    await flushDebounce();
    fireEvent.mouseDown(screen.getByText("owner@brand.com"));
    expect(owner).toBeDisabled();

    // requestAnimationFrame refocuses after clear — flush it under fake timers.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Change" }));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(owner).not.toBeDisabled();
    expect(owner).toHaveValue("");
    expect(screen.queryByRole("button", { name: "Change" })).not.toBeInTheDocument();

    // Search works again after unpinning.
    typeInto(owner, ["ow"]);
    await flushDebounce();
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });
});

describe("NewOrgPage — submit guard", () => {
  test("submitting without a picked owner shows the picker error and never calls createOrgAsOperator", async () => {
    const { container } = render(<NewOrgPage />);

    // Give a valid name (auto-slugs) so submission clears the name/slug checks
    // and reaches the owner-required guard.
    fireEvent.change(screen.getByLabelText("Organization name"), {
      target: { value: "Acme, Inc." },
    });

    const form = container.querySelector("form");
    expect(form).not.toBeNull();
    await act(async () => {
      fireEvent.submit(form as HTMLFormElement);
    });

    expect(
      screen.getByText("Pick an existing user from the dropdown. They must sign up first."),
    ).toBeInTheDocument();
    expect(createMock).not.toHaveBeenCalled();
  });
});
