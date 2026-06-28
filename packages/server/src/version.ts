// Single source of truth for the relay server version: read straight from the
// package's own package.json, which scripts/bump-version.mjs keeps in sync with
// the rest of the monorepo. /health reports this so you can confirm which
// version is deployed.
import pkg from "../package.json" with { type: "json" };

export const VERSION: string = pkg.version;
