// @ts-check
import mdx from "@astrojs/mdx";
import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import starlight from "@astrojs/starlight";
import tailwindcss from "@tailwindcss/vite";
import astroBrokenLinksChecker from "astro-broken-links-checker";
import { defineConfig } from "astro/config";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import starlightBlog from "starlight-blog";
import { pagefindIgnoreNoise } from "./plugins/pagefind-ignore-noise.mjs";

const githubRepository =
  process.env.GITHUB_REPOSITORY ?? "gunta/alchemy-effect";
const [githubOwner = "gunta", githubRepo = "alchemy-effect"] =
  githubRepository.split("/");
const isGitHubPages = process.env.GITHUB_PAGES === "true";
const githubPagesBase =
  process.env.GITHUB_PAGES_BASE ??
  (githubRepo === `${githubOwner}.github.io` ? "/" : `/${githubRepo}`);
const site = isGitHubPages
  ? `https://${githubOwner}.github.io`
  : "https://v2.alchemy.run";
const base = isGitHubPages ? githubPagesBase : undefined;

/**
 * Copies `src/content/docs/**\/*.{md,mdx}` into the build output dir, preserving
 * the directory layout but normalizing extensions to `.md`. This lets the worker
 * serve raw markdown for clients (e.g. coding agents) that prefer it.
 *
 * @returns {import("astro").AstroIntegration}
 */
function copyMarkdownSources() {
  return {
    name: "copy-markdown-sources",
    hooks: {
      "astro:build:done": async ({ dir }) => {
        const outDir = fileURLToPath(dir);

        /**
         * @param {string} srcDir
         * @param {string} relTo
         */
        async function walk(srcDir, relTo = srcDir) {
          let entries;
          try {
            entries = await fs.readdir(srcDir, { withFileTypes: true });
          } catch {
            return;
          }
          for (const entry of entries) {
            const full = path.join(srcDir, entry.name);
            if (entry.isDirectory()) {
              await walk(full, relTo);
              continue;
            }
            if (!entry.isFile()) continue;
            const ext = path.extname(entry.name).toLowerCase();
            if (ext !== ".md" && ext !== ".mdx") continue;
            const rel = path.relative(relTo, full);
            const target = path.join(
              outDir,
              rel.slice(0, rel.length - ext.length) + ".md",
            );
            await fs.mkdir(path.dirname(target), { recursive: true });
            await fs.copyFile(full, target);
          }
        }

        // Docs (Starlight content collection) — preserves nested layout under
        // /content/docs/ → /<path>.md
        await walk(
          fileURLToPath(new URL("./src/content/docs/", import.meta.url)),
        );
        // Marketing pages (top-level Astro pages) — exposes /<page>.md so
        // agents can fetch raw MDX via the worker's content negotiation.
        await walk(fileURLToPath(new URL("./src/pages/", import.meta.url)));
      },
    },
  };
}

/**
 * Case-sensitive internal-link checker. astro-broken-links-checker uses
 * `fs.existsSync`, which is case-insensitive on macOS — so `/foo/Bar` will
 * resolve to `/foo/bar` locally but 404 on Linux CI. This integration walks
 * the build output once into a case-sensitive Set of paths and validates
 * every `href`/`src` against it.
 *
 * @returns {import("astro").AstroIntegration}
 */
function caseSensitiveLinkChecker() {
  return {
    name: "case-sensitive-link-checker",
    hooks: {
      "astro:build:done": async ({ dir, logger }) => {
        const distPath = fileURLToPath(dir);

        /** @type {Set<string>} */
        const paths = new Set();
        /** @type {Set<string>} */
        const dirs = new Set();
        /**
         * @param {string} d
         */
        async function walk(d) {
          const entries = await fs.readdir(d, { withFileTypes: true });
          for (const entry of entries) {
            const full = path.join(d, entry.name);
            if (entry.isDirectory()) {
              dirs.add("/" + path.relative(distPath, full));
              await walk(full);
            } else if (entry.isFile()) {
              paths.add("/" + path.relative(distPath, full));
            }
          }
        }
        await walk(distPath);

        /** @type {Map<string, Set<string>>} */
        const broken = new Map();
        const htmlFiles = [...paths].filter((p) => p.endsWith(".html"));

        for (const htmlFile of htmlFiles) {
          const html = await fs.readFile(
            path.join(distPath, htmlFile.slice(1)),
            "utf8",
          );
          const links = [
            ...html.matchAll(/<a\s+[^>]*href="([^"#?]+)/gi),
            ...html.matchAll(/<img\s+[^>]*src="([^"#?]+)/gi),
          ].map((m) => m[1]);

          for (const link of links) {
            if (!link.startsWith("/")) continue; // skip external, anchors, mailto, etc.
            let clean = link.replace(/\/$/, "") || "/";
            if (base && base !== "/") {
              if (clean === base) {
                clean = "/";
              } else if (clean.startsWith(`${base}/`)) {
                clean = clean.slice(base.length) || "/";
              }
            }
            const fileCandidates =
              clean === "/"
                ? ["/index.html"]
                : [clean, clean + "/index.html", clean + ".html"];
            const exists =
              fileCandidates.some((c) => paths.has(c)) || dirs.has(clean);
            if (!exists) {
              if (!broken.has(link)) broken.set(link, new Set());
              broken.get(link)?.add(htmlFile);
            }
          }
        }

        if (broken.size > 0) {
          let msg = "Case-sensitive broken links detected:\n";
          for (const [link, docs] of broken.entries()) {
            msg += `\n  ${link}\n    Found in:\n`;
            for (const doc of docs) msg += `      - ${doc}\n`;
          }
          logger.error(msg);
          throw new Error(
            `Case-sensitive broken links detected (${broken.size})`,
          );
        }
        logger.info(
          `Case-sensitive link check passed (${htmlFiles.length} pages)`,
        );
      },
    },
  };
}

export default defineConfig({
  site,
  base,
  prefetch: true,
  trailingSlash: "ignore",
  integrations: [
    react(),
    pagefindIgnoreNoise(),
    copyMarkdownSources(),
    astroBrokenLinksChecker({
      checkExternalLinks: false,
      throwError: true,
    }),
    caseSensitiveLinkChecker(),
    sitemap({
      filter: (page) =>
        !page.endsWith(".html") &&
        !page.endsWith(".md") &&
        !page.endsWith(".mdx"),
    }),
    starlight({
      title: "alchemy",
      favicon: "/favicon.svg",
      customCss: ["./src/styles/global.css", "./src/styles/custom.css"],
      components: {
        ThemeProvider: "./src/components/ThemeProvider.astro",
        Header: "./src/components/marketing/Nav.astro",
        Head: "./src/components/starlight/Head.astro",
      },
      prerender: true,
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: `https://github.com/${githubRepository}`,
        },
      ],
      editLink: {
        baseUrl: `https://github.com/${githubRepository}/edit/main/website`,
      },
      sidebar: [
        { label: "What is Alchemy?", link: "/what-is-alchemy" },
        { label: "Getting Started", link: "/getting-started" },
        {
          label: "Tutorial",
          items: [
            { label: "Part 1: Your First Stack", link: "/tutorial/part-1" },
            { label: "Part 2: Add a Worker", link: "/tutorial/part-2" },
            { label: "Part 3: Testing", link: "/tutorial/part-3" },
            { label: "Part 4: Local Dev", link: "/tutorial/part-4" },
            { label: "Part 5: CI/CD", link: "/tutorial/part-5" },
            {
              label: "Cloudflare",
              autogenerate: { directory: "tutorial/cloudflare" },
              collapsed: true,
            },
            {
              label: "AWS",
              autogenerate: { directory: "tutorial/aws" },
              collapsed: true,
            },
          ],
        },
        {
          label: "Convex",
          items: [
            { label: "Overview", link: "/convex" },
            {
              label: "Guides",
              items: [
                {
                  label: "Alchemy Convex Quickstart",
                  link: "/convex/guides/app-quickstart",
                },
                {
                  label: "Convex Plain Quickstart",
                  link: "/convex/guides/quickstart",
                },
                {
                  label: "Runtime Deployer",
                  link: "/convex/guides/runtime-experimental",
                },
                {
                  label: "Migrating from Confect",
                  link: "/convex/guides/migrating-from-confect",
                },
                { label: "Auth", link: "/convex/guides/auth" },
                { label: "Migrations", link: "/convex/guides/migrations" },
                {
                  label: "Components",
                  link: "/convex/guides/components-promoted",
                },
                { label: "Cloudflare R2", link: "/convex/guides/r2" },
                {
                  label: "Workflows and Jobs",
                  link: "/convex/guides/workflows-and-jobs",
                },
                { label: "Typed Errors", link: "/convex/guides/typed-errors" },
                {
                  label: "Clock and Runtime Guardrails",
                  link: "/convex/guides/query-cache-clock",
                },
                {
                  label: "Self-Hosted Convex",
                  link: "/convex/guides/self-host",
                },
                { label: "Testing", link: "/convex/guides/testing" },
                {
                  label: "Production Checklist",
                  link: "/convex/guides/production-checklist",
                },
              ],
            },
            {
              label: "Concepts",
              items: [
                {
                  label: "Authoring Modes",
                  link: "/convex/concepts/authoring-modes",
                },
                {
                  label: "Generated Files",
                  link: "/convex/concepts/generated-files",
                },
                { label: "Components", link: "/convex/concepts/components" },
                {
                  label: "Security Model",
                  link: "/convex/concepts/security-model",
                },
              ],
            },
            {
              label: "Recipes",
              items: [
                {
                  label: "Zero-Downtime Field Rename",
                  link: "/convex/recipes/zero-downtime-rename",
                },
                {
                  label: "Rotate a Secret",
                  link: "/convex/recipes/rotate-secret",
                },
                {
                  label: "Recover a Failed Migration",
                  link: "/convex/recipes/recover-failed-migration",
                },
                {
                  label: "Mux Video Catalog",
                  link: "/convex/recipes/mux-video-catalog",
                },
                {
                  label: "Better Auth on Cloudflare",
                  link: "/convex/recipes/better-auth-cloudflare",
                },
                {
                  label: "Dynamic Tenant Crons",
                  link: "/convex/recipes/dynamic-tenant-crons",
                },
              ],
            },
          ],
        },
        {
          label: "Concepts",
          autogenerate: { directory: "concepts" },
        },
        {
          label: "Guides",
          autogenerate: { directory: "guides" },
        },
        {
          label: "Providers",
          autogenerate: { directory: "providers", collapsed: true },
        },
      ],
      plugins: [starlightBlog()],
      routeMiddleware: ["./src/blog-sidebar.ts"],
    }),
    mdx(),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
