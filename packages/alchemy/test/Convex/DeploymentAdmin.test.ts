import { ConvexEnvironment } from "@/Convex";
import {
  DeploymentAdmin,
  DeploymentAdminLive,
} from "@/Convex/Sdk/DeploymentAdmin";
import { describe, expect, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as HttpBody from "effect/unstable/http/HttpBody";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";

interface Captured {
  readonly url: string;
  readonly method: string;
  readonly authorization: string | undefined;
  readonly contentType: string | undefined;
  readonly bodyJson: unknown;
}

const harness = (response: Response) => {
  let captured: Captured | undefined;
  const client = HttpClient.make((request) =>
    Effect.sync(() => {
      const body = request.body as HttpBody.HttpBody;
      const bodyText =
        body._tag === "Uint8Array" ? new TextDecoder().decode(body.body) : "";
      captured = {
        url: request.url,
        method: request.method,
        authorization: request.headers.authorization,
        contentType: body._tag === "Uint8Array" ? body.contentType : undefined,
        bodyJson: bodyText ? JSON.parse(bodyText) : undefined,
      };
      return HttpClientResponse.fromWeb(request, response);
    }),
  );

  const layer = DeploymentAdminLive.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(HttpClient.HttpClient, client),
        Layer.succeed(ConvexEnvironment, {
          mode: "deploy-key" as const,
          deployKey: Redacted.make("deploy-key-123"),
          deploymentUrl: "https://calm-cat-123.convex.cloud",
          source: { type: "env" as const, details: "CONVEX_DEPLOY_KEY" },
        }),
      ),
    ),
  );

  return { layer, get: () => captured! };
};

const jsonResponse = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });

describe("Convex DeploymentAdmin", () => {
  it.effect("gets deployment info through the deployment API", () => {
    const { layer, get } = harness(
      jsonResponse({
        kind: "cloud",
        id: 123,
        deploymentType: "prod",
        projectId: 456,
        teamId: 789,
        projectSlug: "my-app",
        reference: "production",
      }),
    );

    return Effect.gen(function* () {
      const admin = yield* DeploymentAdmin;
      const info = yield* admin.getDeploymentInfo({
        deploymentUrl: "https://calm-cat-123.convex.cloud",
      });

      expect(info).toMatchObject({
        kind: "cloud",
        deploymentType: "prod",
        projectId: 456,
      });
      expect(get()).toMatchObject({
        url: "https://calm-cat-123.convex.cloud/api/v1/deployment_info",
        method: "GET",
        authorization: "Convex deploy-key-123",
      });
    }).pipe(Effect.provide(layer));
  });

  it.effect(
    "normalizes listed environment variables from the deployment API",
    () => {
      const { layer, get } = harness(
        jsonResponse({
          environmentVariables: {
            API_URL: "https://api.example.com",
            FEATURE_FLAG: "enabled",
          },
        }),
      );

      return Effect.gen(function* () {
        const admin = yield* DeploymentAdmin;
        const envs = yield* admin.listEnvironmentVariables({
          deploymentUrl: "https://calm-cat-123.convex.cloud",
        });

        expect(envs).toEqual([
          { name: "API_URL", value: "https://api.example.com" },
          { name: "FEATURE_FLAG", value: "enabled" },
        ]);
        expect(get()).toMatchObject({
          url: "https://calm-cat-123.convex.cloud/api/v1/list_environment_variables",
          method: "GET",
          authorization: "Convex deploy-key-123",
        });
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect("gets canonical URLs through the deployment API", () => {
    const { layer, get } = harness(
      jsonResponse({
        convexCloudUrl: "https://api.example.com",
        convexSiteUrl: "https://site.example.com",
      }),
    );

    return Effect.gen(function* () {
      const admin = yield* DeploymentAdmin;
      const urls = yield* admin.getCanonicalUrls({
        deploymentUrl: "https://calm-cat-123.convex.cloud",
      });

      expect(urls.convexCloudUrl).toBe("https://api.example.com");
      expect(get()).toMatchObject({
        url: "https://calm-cat-123.convex.cloud/api/v1/get_canonical_urls",
        method: "GET",
        authorization: "Convex deploy-key-123",
      });
    }).pipe(Effect.provide(layer));
  });

  it.effect("updates canonical URLs with destination and nullable URL", () => {
    const { layer, get } = harness(new Response(null, { status: 200 }));

    return Effect.gen(function* () {
      const admin = yield* DeploymentAdmin;
      yield* admin.updateCanonicalUrl({
        deploymentUrl: "https://calm-cat-123.convex.cloud",
        requestDestination: "convexCloud",
        url: null,
      });

      expect(get()).toMatchObject({
        url: "https://calm-cat-123.convex.cloud/api/v1/update_canonical_url",
        method: "POST",
        authorization: "Convex deploy-key-123",
        contentType: "application/json",
        bodyJson: {
          requestDestination: "convexCloud",
          url: null,
        },
      });
    }).pipe(Effect.provide(layer));
  });

  it.effect("manages log streams through the deployment API", () => {
    const { layer, get } = harness(
      jsonResponse([
        {
          id: "ls_123",
          logStreamType: "webhook",
          url: "https://logs.example.com",
          format: "json",
          status: { type: "active" },
        },
      ]),
    );

    return Effect.gen(function* () {
      const admin = yield* DeploymentAdmin;
      const streams = yield* admin.listLogStreams({
        deploymentUrl: "https://calm-cat-123.convex.cloud",
      });

      expect(streams[0]!.id).toBe("ls_123");
      expect(get()).toMatchObject({
        url: "https://calm-cat-123.convex.cloud/api/v1/list_log_streams",
        method: "GET",
      });
    }).pipe(Effect.provide(layer));
  });

  it.effect("posts log stream commands with encoded ids", () => {
    const { layer, get } = harness(new Response(null, { status: 200 }));

    return Effect.gen(function* () {
      const admin = yield* DeploymentAdmin;
      yield* admin.updateLogStream({
        deploymentUrl: "https://calm-cat-123.convex.cloud",
        id: "ls/123",
        config: { logStreamType: "webhook", url: "https://logs.example.com" },
      });

      expect(get()).toMatchObject({
        url: "https://calm-cat-123.convex.cloud/api/v1/update_log_stream/ls%2F123",
        method: "POST",
        bodyJson: {
          logStreamType: "webhook",
          url: "https://logs.example.com",
        },
      });
    }).pipe(Effect.provide(layer));
  });

  it.effect("gets a single log stream with encoded ids", () => {
    const { layer, get } = harness(
      jsonResponse({
        id: "ls/123",
        logStreamType: "webhook",
        url: "https://logs.example.com",
        format: "json",
        status: { type: "active" },
      }),
    );

    return Effect.gen(function* () {
      const admin = yield* DeploymentAdmin;
      const stream = yield* admin.getLogStream({
        deploymentUrl: "https://calm-cat-123.convex.cloud",
        id: "ls/123",
      });

      expect(stream.id).toBe("ls/123");
      expect(get()).toMatchObject({
        url: "https://calm-cat-123.convex.cloud/api/v1/get_log_stream/ls%2F123",
        method: "GET",
      });
    }).pipe(Effect.provide(layer));
  });

  it.effect("preserves structured deployment API error bodies", () => {
    const { layer } = harness(
      jsonResponse(
        {
          code: "DeploymentNotReady",
          message: "Deployment is restarting.",
        },
        { status: 503 },
      ),
    );

    return Effect.gen(function* () {
      const admin = yield* DeploymentAdmin;
      const exit = yield* Effect.exit(
        admin.pauseDeployment({
          deploymentUrl: "https://calm-cat-123.convex.cloud",
        }),
      );

      expect(exit._tag).toBe("Failure");
      if (exit._tag === "Failure") {
        const failure = exit.cause.reasons.find(Cause.isFailReason);
        expect(failure?.error).toMatchObject({
          _tag: "Convex.HttpError",
          status: 503,
          code: "DeploymentNotReady",
          message: "Deployment is restarting.",
          errorKind: "overloaded",
          platformCode: "Overloaded",
          retryable: true,
        });
      }
    }).pipe(Effect.provide(layer));
  });

  it.effect("posts pause and snapshot admin commands", () => {
    const { layer, get } = harness(
      jsonResponse({ exportId: "export_123", snapshotTs: "1779150000000" }),
    );

    return Effect.gen(function* () {
      const admin = yield* DeploymentAdmin;
      const exported = yield* admin.requestSnapshotExport({
        deploymentUrl: "https://calm-cat-123.convex.cloud",
        format: "zip",
      });

      expect(exported.exportId).toBe("export_123");
      expect(get()).toMatchObject({
        url: "https://calm-cat-123.convex.cloud/api/v1/request_snapshot_export",
        method: "POST",
        bodyJson: { format: "zip" },
      });
    }).pipe(Effect.provide(layer));
  });
});
