import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const repository = process.env.GITHUB_REPOSITORY ?? "gunta/alchemy-effect";
const [owner = "gunta", repo = "alchemy-effect"] = repository.split("/");
const rawBase =
  process.env.GITHUB_PAGES_BASE ??
  (repo === `${owner}.github.io` ? "/" : `/${repo}`);
const base = rawBase === "/" ? "" : rawBase.replace(/\/$/, "");
const origin = `https://${owner}.github.io`;
const dist = new URL("../dist/", import.meta.url).pathname;

if (base !== "") {
  await rewriteDirectory(dist);
}

async function rewriteDirectory(dir: string) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await rewriteDirectory(full);
      continue;
    }
    if (!entry.isFile() || !/\.(html|xml|txt)$/.test(entry.name)) continue;
    const source = await readFile(full, "utf8");
    const rewritten = rewriteText(source);
    if (rewritten !== source) {
      await writeFile(full, rewritten);
    }
  }
}

function rewriteText(source: string) {
  const escapedBasePath = escapeRegExp(base.slice(1));
  const escapedOrigin = escapeRegExp(origin);
  return source
    .replace(
      new RegExp(
        `\\b(href|src|action)=(["'])/(?!/|${escapedBasePath}(?:/|["']))`,
        "g",
      ),
      `$1=$2${base}/`,
    )
    .replace(
      new RegExp(`url\\(/(?!/|${escapedBasePath}/)`, "g"),
      `url(${base}/`,
    )
    .replace(
      new RegExp(`${escapedOrigin}/(?!${escapedBasePath}(?:/|["'<]|$))`, "g"),
      `${origin}${base}/`,
    );
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
