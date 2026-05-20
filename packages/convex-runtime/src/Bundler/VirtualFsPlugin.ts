const VIRTUAL_NS = "alchemy-convex-virtual";

export interface VirtualFsPluginOptions {
  readonly files: ReadonlyMap<string, string>;
  readonly projectRoot: string;
}

export interface VirtualFsPlugin {
  readonly name: "alchemy-convex-virtual-fs";
  readonly setup: (build: {
    readonly onResolve: (
      options: { readonly filter: RegExp },
      callback: (args: {
        readonly path: string;
        readonly importer: string;
        readonly namespace: string;
        readonly kind: string;
      }) => unknown,
    ) => void;
    readonly onLoad: (
      options: { readonly filter: RegExp; readonly namespace: string },
      callback: (args: { readonly path: string }) => unknown,
    ) => void;
  }) => void;
}

const dirname = (file: string) => file.split("/").slice(0, -1).join("/") || ".";

const extname = (file: string) => {
  const base = file.split("/").at(-1) ?? file;
  const index = base.lastIndexOf(".");
  return index === -1 ? "" : base.slice(index);
};

const normalizeSegments = (path: string) => {
  const out: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") out.pop();
    else out.push(segment);
  }
  return out.join("/");
};

const resolveVirtualImport = (
  files: ReadonlyMap<string, string>,
  importer: string,
  specifier: string,
) => {
  const base = normalizeSegments(`${dirname(importer)}/${specifier}`);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
  ];
  return candidates.find((candidate) => files.has(candidate));
};

const loaderForPath = (path: string) => {
  switch (extname(path)) {
    case ".tsx":
      return "tsx";
    case ".jsx":
      return "jsx";
    case ".js":
      return "js";
    default:
      return "ts";
  }
};

export const virtualFsPlugin = (
  opts: VirtualFsPluginOptions,
): VirtualFsPlugin => ({
  name: "alchemy-convex-virtual-fs",
  setup(build) {
    build.onResolve({ filter: /.*/ }, (args) => {
      if (args.kind === "entry-point" && opts.files.has(args.path)) {
        return { path: args.path, namespace: VIRTUAL_NS };
      }

      if (args.namespace !== VIRTUAL_NS) return undefined;
      if (args.path.startsWith("./") || args.path.startsWith("../")) {
        const resolved = resolveVirtualImport(
          opts.files,
          args.importer,
          args.path,
        );
        return resolved
          ? { path: resolved, namespace: VIRTUAL_NS }
          : {
              errors: [
                {
                  text: `Cannot resolve virtual import "${args.path}" from "${args.importer}"`,
                },
              ],
            };
      }

      return undefined;
    });

    build.onLoad({ filter: /.*/, namespace: VIRTUAL_NS }, (args) => {
      const contents = opts.files.get(args.path);
      if (contents === undefined) {
        return {
          errors: [
            { text: `Virtual module "${args.path}" missing from file map` },
          ],
        };
      }
      return {
        contents,
        loader: loaderForPath(args.path),
        resolveDir: opts.projectRoot,
      };
    });
  },
});

export const VirtualFsPlugin = {
  namespace: VIRTUAL_NS,
  virtualFsPlugin,
};
