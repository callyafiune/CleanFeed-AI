import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const textFile = /\.(?:html|js|json|mjs)$/u;

async function sanitize(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await sanitize(path);
    else if (textFile.test(entry.name)) {
      const source = await readFile(path, "utf8");
      const sanitized = source
        .replaceAll("https://huggingface.co", "offline")
        .replaceAll("https://cdn.jsdelivr.net", "offline")
        .replaceAll("https:\\/\\/huggingface.co", "offline")
        .replaceAll("https:\\/\\/cdn.jsdelivr.net", "offline");
      if (sanitized !== source) await writeFile(path, sanitized);
    }
  }
}

await sanitize(resolve("dist"));
