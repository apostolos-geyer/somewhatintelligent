/**
 * Role helpers.
 *
 * `user.role` (Better Auth's admin plugin) is a COMMA-SEPARATED string
 * (e.g. `"admin,user"`) or a `string[]` — the admin plugin splits on commas
 * before matching `adminRoles`. Never compare the raw value with `=== "admin"`:
 * a multi-role user (`"admin,user"`) silently loses access.
 *
 * Client-safe: no imports, no server-only references.
 */

/** True when the role value (csv string or array) contains `role`. */
export function hasRole(
  roles: string | readonly string[] | null | undefined,
  role: string,
): boolean {
  if (!roles) return false;
  const list = Array.isArray(roles) ? roles : String(roles).split(",");
  return list.map((r) => r.trim()).includes(role);
}

/** Convenience: `hasRole(roles, "admin")`. */
export function isAdminRole(roles: string | readonly string[] | null | undefined): boolean {
  return hasRole(roles, "admin");
}
