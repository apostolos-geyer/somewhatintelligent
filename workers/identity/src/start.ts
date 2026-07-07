import { createStart } from "@tanstack/react-start";
import { createLoggingFunctionMiddleware, createRequestLogger } from "@greenroom/kit/react-start";
import { envelopeMiddleware } from "@/lib/middleware/auth";

const requestLogger = createRequestLogger({ service: "identity" });
const functionLogger = createLoggingFunctionMiddleware({ service: "identity" });

export const startInstance = createStart(() => ({
  requestMiddleware: [requestLogger, envelopeMiddleware],
  functionMiddleware: [functionLogger],
}));
