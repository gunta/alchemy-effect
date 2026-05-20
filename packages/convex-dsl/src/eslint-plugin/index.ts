import noRawDateNowInQuery from "./rules/no-raw-date-now-in-query.ts";

export const convexDslEslintPlugin = {
  rules: {
    "no-raw-date-now-in-query": noRawDateNowInQuery,
  },
};

export default convexDslEslintPlugin;
