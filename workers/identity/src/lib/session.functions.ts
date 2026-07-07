import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { getSession } from "@/lib/session";

export const loadSession = createServerFn({ method: "GET" }).handler(async () => {
  return getSession(getRequestHeaders());
});
