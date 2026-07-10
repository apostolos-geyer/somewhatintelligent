// Browser AvatarTransport: the two forwarding functions the package's
// `setAvatar` driver calls. Each is a one-line forward to a server fn that
// invokes the guestlist WorkerEntrypoint RPC with the request Cookie.
import type { AvatarTransport } from "@somewhatintelligent/guestlist/client";
import { confirmAvatar, registerAvatar } from "@/lib/avatar.functions";

export const avatarTransport: AvatarTransport = {
  register: (input) => registerAvatar({ data: input }),
  confirm: (input) => confirmAvatar({ data: input }),
};
