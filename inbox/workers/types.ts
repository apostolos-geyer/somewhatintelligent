// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

// Typed env derived from the Alchemy stack's declared bindings — the env
// can never drift from the infrastructure that produced it. (Replaces the
// wrangler-typegen'd Cloudflare.Env; there is no wrangler.jsonc anymore.)
import type { WorkerEnv } from "../alchemy.run";

export interface Env extends WorkerEnv {}
