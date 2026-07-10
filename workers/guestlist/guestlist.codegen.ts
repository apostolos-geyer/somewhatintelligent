/**
 * Schema-codegen entry (see @somewhatintelligent/guestlist's codegen module):
 *
 *   bunx @better-auth/cli generate --config guestlist.codegen.ts \
 *     --output src/schema.gen.ts -y
 *   bunx drizzle-kit generate
 *
 * Regenerate when the guestlist config's feature surface or the pinned
 * better-auth version changes. This instance never serves traffic.
 */
import { createCodegenAuth } from "@somewhatintelligent/guestlist";
import { guestlistConfig } from "./src/config";

export const auth = createCodegenAuth(guestlistConfig);
