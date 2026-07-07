#!/usr/bin/env bun
import { resolve, dirname } from "node:path";
import { writeDevVarsIfMissing } from "../../../scripts/dev-config";

const pkgDir = resolve(dirname(import.meta.path), "..");
const label = "workers/promoter";

const devVars = `# Resend API key — get one from https://resend.com/api-keys.
RESEND_API_KEY=
`;

writeDevVarsIfMissing(`${pkgDir}/.dev.vars`, devVars, label);
