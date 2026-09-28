// Node module customization hook that makes the browser-only `import.meta.env`
// construct available when the test suite imports real app modules directly.
//
// Node has no equivalent of Vite's define replacement, so the source text is
// rewritten on the way through: `import.meta.env` becomes a global that the
// test file populates. Everything else about the module is untouched, so the
// code under test is byte-for-byte the code that ships.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const VITE_ENV_PLACEHOLDER = "__ECHOROOMS_VITE_ENV__";

export async function load(url, context, nextLoad) {
  if (!url.startsWith("file:") || !url.endsWith(".js")) {
    return nextLoad(url, context);
  }

  const path = fileURLToPath(url);
  const original = await readFile(path, "utf8");
  if (!original.includes("import.meta.env")) {
    return nextLoad(url, context);
  }

  return {
    format: "module",
    shortCircuit: true,
    source: original.replaceAll("import.meta.env", VITE_ENV_PLACEHOLDER),
  };
}
