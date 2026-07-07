import { env } from "./env";
import { db } from "./db";
import { createGuestlistAuth } from "./auth-config";

export const auth = createGuestlistAuth(env, db);

export type Auth = typeof auth;
