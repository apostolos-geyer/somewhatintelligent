/**
 * si guestlist worker — the whole worker. All routing (better-auth HTTP)
 * plus the admin/org/user-directory/avatar RPC surface lives in the
 * package's WorkerEntrypoint; this shim just wires si's config in and
 * re-exports the entrypoint class for the service binding.
 */
import { createGuestlist } from "@somewhatintelligent/guestlist";
import { guestlistConfig } from "./config";

const gl = createGuestlist(guestlistConfig);

export default { fetch: gl.fetch };
export const Guestlist = gl.Guestlist;
