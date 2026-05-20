import { component as ActionCache } from "./action-cache/index.ts";
import { component as ActionRetrier } from "./action-retrier/index.ts";
import { component as Agent } from "./agent/index.ts";
import { component as Aggregate } from "./aggregate/index.ts";
import { component as Authz } from "./authz/index.ts";
import { component as BetterAuth } from "./better-auth/index.ts";
import { component as Crons } from "./crons/index.ts";
import { component as Geospatial } from "./geospatial/index.ts";
import { component as Migrations } from "./migrations/index.ts";
import { component as Mux } from "./mux/index.ts";
import { component as NeutralCost } from "./neutral-cost/index.ts";
import { component as R2 } from "./r2/index.ts";
import { component as RateLimiter } from "./rate-limiter/index.ts";
import { component as ShardedCounter } from "./sharded-counter/index.ts";
import { component as Workflow } from "./workflow/index.ts";
import { component as Workpool } from "./workpool/index.ts";

export const promotedComponentModules = [
  ActionCache,
  ActionRetrier,
  Agent,
  Aggregate,
  Authz,
  BetterAuth,
  Crons,
  Geospatial,
  Migrations,
  Mux,
  NeutralCost,
  R2,
  RateLimiter,
  ShardedCounter,
  Workflow,
  Workpool,
] as const;

export const discoverPromotedComponentModules = () => promotedComponentModules;
