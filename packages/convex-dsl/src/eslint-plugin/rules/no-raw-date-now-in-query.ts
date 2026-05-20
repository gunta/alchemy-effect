export type RawTimeKind = "Date.now" | "new Date" | "performance.now";

export interface RawTimeReport {
  readonly kind: RawTimeKind;
  readonly index: number;
  readonly message: string;
}

export interface EslintContextLike {
  readonly getSourceCode?: () => { readonly text: string };
  readonly sourceCode?: { readonly text: string };
  readonly report: (descriptor: {
    readonly messageId: "rawTimeInQuery";
    readonly loc?: unknown;
  }) => void;
}

const queryHandlerPattern =
  /\bquery\s*\(\s*\{[\s\S]*?\bhandler\s*:\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*(?:\{(?<block>[\s\S]*?)\}|(?<expression>[\s\S]*?))\s*(?:,\s*[\w$]+\s*:|\}\s*\))/g;

const rawTimePatterns: ReadonlyArray<{
  readonly kind: RawTimeKind;
  readonly pattern: RegExp;
}> = [
  { kind: "Date.now", pattern: /\bDate\s*\.\s*now\s*\(/g },
  { kind: "new Date", pattern: /\bnew\s+Date\s*\(/g },
  { kind: "performance.now", pattern: /\bperformance\s*\.\s*now\s*\(/g },
];

const analyzeHandlerSource = (
  source: string,
  offset: number,
): ReadonlyArray<RawTimeReport> =>
  rawTimePatterns.flatMap(({ kind, pattern }) =>
    [...source.matchAll(pattern)].map((match) => ({
      kind,
      index: offset + (match.index ?? 0),
      message:
        "Use Clock.currentTimeMillis in Convex query handlers so query caching stays deterministic.",
    })),
  );

export const analyzeNoRawDateNowInQuery = Object.assign(
  (source: string): ReadonlyArray<RawTimeReport> => {
    const reports: Array<RawTimeReport> = [];
    for (const match of source.matchAll(queryHandlerPattern)) {
      const handlerSource =
        match.groups?.block ?? match.groups?.expression ?? "";
      const handlerIndex = match.index ?? 0;
      reports.push(...analyzeHandlerSource(handlerSource, handlerIndex));
    }
    return reports.sort((a, b) => a.index - b.index);
  },
  {
    rule: {
      meta: {
        type: "problem",
        docs: {
          description:
            "Disallow Date.now(), new Date(), and performance.now() inside Convex query handlers.",
        },
        messages: {
          rawTimeInQuery:
            "Use Clock.currentTimeMillis in Convex query handlers so query caching stays deterministic.",
        },
        schema: [],
      },
      create(context: EslintContextLike) {
        return {
          Program() {
            const source =
              context.sourceCode?.text ?? context.getSourceCode?.().text ?? "";
            for (const report of analyzeNoRawDateNowInQuery(source)) {
              context.report({
                messageId: "rawTimeInQuery",
              });
            }
          },
        };
      },
    },
  },
);

export default analyzeNoRawDateNowInQuery.rule;
