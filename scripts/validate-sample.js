import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseImportPayload } from "../src/domain.js";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const samplePath = join(root, "sample-data", "agent-review-sample.json");

const payload = await readFile(samplePath, "utf8");
const dataset = parseImportPayload(payload);

if (dataset.items.length < 5) {
  throw new Error("Sample data should include at least five items.");
}

console.log(`Sample data OK: ${dataset.items.length} items`);
