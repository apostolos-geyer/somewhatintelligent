import { createStart } from "@tanstack/react-start";
import {
  createLoggingFunctionMiddleware,
  createRequestLogger,
} from "@somewhatintelligent/kit/react-start";

const requestLogger = createRequestLogger({ service: "operator" });
const functionLogger = createLoggingFunctionMiddleware({ service: "operator" });

// Operator resolves its OperatorActor once at the worker boundary (worker.ts,
// via the Access gate) and seeds it into the TSS request context; server-fns
// read it back through `requireOperatorActor` rather than re-verifying the JWT.
export const startInstance = createStart(() => ({
  requestMiddleware: [requestLogger],
  functionMiddleware: [functionLogger],
}));
