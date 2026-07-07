import { createStart } from "@tanstack/react-start";
import { createLoggingFunctionMiddleware } from "@greenroom/kit/react-start";
import { envelopeMiddleware } from "@/lib/middleware/auth";

// The canonical per-request HTTP line is opened at the fetch boundary in
// `worker.ts` (withRequestContext + withRequestLog), NOT here: TanStack's
// request middleware does not wrap errors thrown during route-module load
// (which is how the arktype regression 500'd every request with no log line).
// The fetch boundary sees every request and every failure, so it is the only
// place that can guarantee one canonical line — with a traceback — no matter
// what. The function middleware patches that same scope for server-fn lines.
const functionLogger = createLoggingFunctionMiddleware({ service: "sprout" });

export const startInstance = createStart(() => ({
  requestMiddleware: [envelopeMiddleware],
  functionMiddleware: [functionLogger],
}));
