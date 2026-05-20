export const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

export function withBase(path: string) {
  if (!path.startsWith("/") || path.startsWith("//")) return path;
  return `${basePath}${path}` || "/";
}

export const githubRepository =
  import.meta.env.PUBLIC_GITHUB_REPOSITORY ?? "alchemy-run/alchemy-effect";
