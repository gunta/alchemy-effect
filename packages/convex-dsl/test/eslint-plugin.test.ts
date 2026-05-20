import { describe, expect, it } from "bun:test";
import { convexDslEslintPlugin } from "../src/eslint-plugin/index.ts";
import { analyzeNoRawDateNowInQuery } from "../src/eslint-plugin/rules/no-raw-date-now-in-query.ts";

describe("@alchemy/convex eslint plugin", () => {
  it("reports raw time access inside query handlers only", () => {
    const reports = analyzeNoRawDateNowInQuery(`
      import { action, mutation, query } from "./_generated/server";

      export const list = query({
        handler: async () => {
          Date.now();
          new Date();
          performance.now();
        },
      });

      export const create = mutation({
        handler: async () => Date.now(),
      });

      export const summarize = action({
        handler: async () => new Date(),
      });
    `);

    expect(reports.map((report) => report.kind)).toEqual([
      "Date.now",
      "new Date",
      "performance.now",
    ]);
    expect(reports.every((report) => report.message.includes("Clock"))).toBe(
      true,
    );
  });

  it("exposes an ESLint-compatible rule wrapper", () => {
    const reports: Array<{ readonly messageId: string }> = [];
    const rule = analyzeNoRawDateNowInQuery.rule;
    const visitors = rule.create({
      getSourceCode: () => ({
        text: "export const list = query({ handler: () => Date.now() });",
      }),
      report: (report: { readonly messageId: string }) => {
        reports.push(report);
      },
    });

    visitors.Program();

    expect(rule.meta.docs.description).toContain("Date.now");
    expect(reports).toEqual([{ messageId: "rawTimeInQuery" }]);
    expect(convexDslEslintPlugin.rules["no-raw-date-now-in-query"]).toBe(rule);
  });
});
