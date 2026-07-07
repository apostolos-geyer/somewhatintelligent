import { createStart } from "@tanstack/react-start";
import { createLoggingFunctionMiddleware, createRequestLogger } from "@si/kit/react-start";

const requestLogger = createRequestLogger({ service: "store" });
const functionLogger = createLoggingFunctionMiddleware({ service: "store" });

// The store resolves sessions per server-fn via `authMiddleware` (lib/middleware/
// auth.ts → getSession), so no request-level envelope middleware is wired here;
// getSession verifies the bouncer envelope from the request headers itself.
export const startInstance = createStart(() => ({
  requestMiddleware: [requestLogger],
  functionMiddleware: [functionLogger],
}));
