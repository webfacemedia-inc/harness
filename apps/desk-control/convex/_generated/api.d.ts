/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as billing from "../billing.js";
import type * as boxes from "../boxes.js";
import type * as config from "../config.js";
import type * as core from "../core.js";
import type * as demos from "../demos.js";
import type * as email from "../email.js";
import type * as http from "../http.js";
import type * as lib from "../lib.js";
import type * as migrate from "../migrate.js";
import type * as ops from "../ops.js";
import type * as orders from "../orders.js";
import type * as provision from "../provision.js";
import type * as push from "../push.js";
import type * as schedule from "../schedule.js";
import type * as secrets from "../secrets.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  billing: typeof billing;
  boxes: typeof boxes;
  config: typeof config;
  core: typeof core;
  demos: typeof demos;
  email: typeof email;
  http: typeof http;
  lib: typeof lib;
  migrate: typeof migrate;
  ops: typeof ops;
  orders: typeof orders;
  provision: typeof provision;
  push: typeof push;
  schedule: typeof schedule;
  secrets: typeof secrets;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  workflow: import("@convex-dev/workflow/_generated/component.js").ComponentApi<"workflow">;
  actionRetrier: import("@convex-dev/action-retrier/_generated/component.js").ComponentApi<"actionRetrier">;
  crons: import("@convex-dev/crons/_generated/component.js").ComponentApi<"crons">;
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
};
