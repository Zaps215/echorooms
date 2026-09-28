// Registers the Vite-env loader hook. Imported via `node --import` before the
// test modules so `import.meta.env` resolves under plain Node.

import { register } from "node:module";
import { pathToFileURL } from "node:url";

register("./vite-env-loader.mjs", pathToFileURL(import.meta.filename));
