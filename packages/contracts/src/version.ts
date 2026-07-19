import { type } from "arktype";

/**
 * Canonical core SemVer `MAJOR.MINOR.PATCH` with no leading zeros, no `v`
 * prefix, and no pre-release/build metadata (RFC-0001 contract tests: accept
 * `1.0.0`, reject edition/batch/drop and any non-SemVer identifier). Texts,
 * fixed pages, and products publish under an operator-supplied version of this
 * shape; software records are unversioned.
 */
export const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** arktype string schema matching {@link SEMVER_PATTERN}. */
export const versionSchema = type(SEMVER_PATTERN);

export function isValidVersion(value: string): boolean {
  return SEMVER_PATTERN.test(value);
}
