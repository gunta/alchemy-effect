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

const sequenceHarness = (responses: ReadonlyArray<Response>) => {
  const captured: Captured[] = [];
  let index = 0;
  const client = HttpClient.make((request) =>
    Effect.sync(() => {
      const body = request.body as HttpBody.HttpBody;
      const bodyText =
        body._tag === "Uint8Array" ? new TextDecoder().decode(body.body) : "";
      captured.push({
        url: request.url,
        method: request.method,
        authorization: request.headers.authorization,
        contentType: body._tag === "Uint8Array" ? body.contentType : undefined,
        bodyJson: bodyText ? JSON.parse(bodyText) : undefined,
      });
      const response = responses[index++];
      if (!response) throw new Error(`missing response ${index}`);
      return HttpClientResponse.fromWeb(request, response);
    }),
  );

  const layer = DeploymentAdminLive.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(HttpClient.HttpClient, client),
        Layer.succeed(ConvexEnvironment, {
          mode: "oauth" as const,
          token: Redacted.make("oauth-token-123"),
          managementApiUrl: "https://api.convex.dev/v1",
          dashboardApiUrl: "https://api.convex.dev/api",
          source: { type: "env" as const, details: "CONVEX_OAUTH_TOKEN" },
        }),
      ),
    ),
  );

  return { layer, captured };
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

  it.effect("authenticates self-hosted deployment admin calls", () => {
    let captured: Captured | undefined;
    const client = HttpClient.make((request) =>
      Effect.sync(() => {
        captured = {
          url: request.url,
          method: request.method,
          authorization: request.headers.authorization,
          contentType: undefined,
          bodyJson: undefined,
        };
        return HttpClientResponse.fromWeb(
          request,
          jsonResponse({ kind: "selfHosted" }),
        );
      }),
    );
    const layer = DeploymentAdminLive.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(HttpClient.HttpClient, client),
          Layer.succeed(ConvexEnvironment, {
            mode: "self-hosted" as const,
            managementApiUrl: "https://convex.example.com",
            adminKey: Redacted.make("admin-key"),
            source: {
              type: "env" as const,
              details: "CONVEX_SELF_HOSTED_ADMIN_KEY",
            },
          }),
        ),
      ),
    );

    return Effect.gen(function* () {
      const admin = yield* DeploymentAdmin;
      const info = yield* admin.getDeploymentInfo({
        deploymentUrl: "https://convex.example.com",
      });

      expect(info.kind).toBe("selfHosted");
      expect(captured).toMatchObject({
        authorization: "Convex admin-key",
      });
    }).pipe(Effect.provide(layer));
  });

  it.effect("fails deployment admin construction without a token", () => {
    const layer = DeploymentAdminLive.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(
            HttpClient.HttpClient,
            HttpClient.make(() => Effect.die("unused")),
          ),
          Layer.succeed(ConvexEnvironment, {
            mode: "self-hosted" as const,
            managementApiUrl: "https://convex.example.com",
            adminKey: undefined as never,
            source: {
              type: "env" as const,
              details: "CONVEX_SELF_HOSTED_ADMIN_KEY",
            },
          }),
        ),
      ),
    );

    return Effect.gen(function* () {
      const failure = yield* Effect.gen(function* () {
        yield* DeploymentAdmin;
      }).pipe(Effect.provide(layer), Effect.flip);

      expect(failure._tag).toBe("Convex.CredentialsError");
    });
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

  it.effect("covers mutating deployment admin endpoints", () => {
    const stream = {
      id: "ls/123",
      logStreamType: "webhook" as const,
      url: "https://logs.example.com",
      format: "json" as const,
      status: { type: "active" as const },
    };
    const { layer, captured } = sequenceHarness([
      jsonResponse(stream),
      jsonResponse({ hmacSecret: "rotated-secret" }),
      new Response(null, { status: 204 }),
      new Response(null, { status: 204 }),
      jsonResponse({ importId: "import_123", state: "requested" }),
      new Response(null, { status: 204 }),
    ]);

    return Effect.gen(function* () {
      const admin = yield* DeploymentAdmin;
      const created = yield* admin.createLogStream({
        deploymentUrl: "https://calm-cat-123.convex.cloud/",
        config: {
          logStreamType: "webhook",
          url: "https://logs.example.com",
          format: "json",
        },
      });
      const secret = yield* admin.rotateWebhookLogStreamSecret({
        deploymentUrl: "https://calm-cat-123.convex.cloud/",
        id: "ls/123",
      });
      yield* admin.deleteLogStream({
        deploymentUrl: "https://calm-cat-123.convex.cloud/",
        id: "ls/123",
      });
      yield* admin.unpauseDeployment({
        deploymentUrl: "https://calm-cat-123.convex.cloud/",
      });
      const imported = yield* admin.requestSnapshotImport({
        deploymentUrl: "https://calm-cat-123.convex.cloud/",
        source: { url: "https://snapshots.example.com/snapshot.zip" },
        mode: "replace",
        table: "messages",
      });
      yield* admin.updateEnvironmentVariables({
        deploymentUrl: "https://calm-cat-123.convex.cloud/",
        changes: [{ name: "OPENAI_API_KEY", value: null }],
      });

      expect(created.id).toBe("ls/123");
      expect(secret.hmacSecret).toBe("rotated-secret");
      expect(imported).toEqual({ importId: "import_123", state: "requested" });
      expect(captured.map((call) => call.url)).toEqual([
        "https://calm-cat-123.convex.cloud/api/v1/create_log_stream",
        "https://calm-cat-123.convex.cloud/api/v1/rotate_webhook_secret/ls%2F123",
        "https://calm-cat-123.convex.cloud/api/v1/delete_log_stream/ls%2F123",
        "https://calm-cat-123.convex.cloud/api/v1/unpause_deployment",
        "https://calm-cat-123.convex.cloud/api/v1/request_snapshot_import",
        "https://calm-cat-123.convex.cloud/api/v1/update_environment_variables",
      ]);
      expect(captured.at(-1)).toMatchObject({
        bodyJson: { changes: [{ name: "OPENAI_API_KEY", value: null }] },
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

  it.effect(
    "maps invalid deployment API responses to typed HTTP errors",
    () => {
      const { layer } = harness(jsonResponse({ invalid: true }));

      return Effect.gen(function* () {
        const admin = yield* DeploymentAdmin;
        const failure = yield* admin
          .getDeploymentInfo({
            deploymentUrl: "https://calm-cat-123.convex.cloud",
          })
          .pipe(Effect.flip);

        expect(failure._tag).toBe("Convex.HttpError");
        expect(failure.status).toBe(0);
        expect(failure.body).toContain("invalid response body");
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect(
    "maps deployment API transport failures to typed HTTP errors",
    () => {
      const layer = DeploymentAdminLive.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(
              HttpClient.HttpClient,
              HttpClient.make(() => Effect.fail(new Error("network down"))),
            ),
            Layer.succeed(ConvexEnvironment, {
              mode: "deploy-key" as const,
              deployKey: Redacted.make("deploy-key-123"),
              deploymentUrl: "https://calm-cat-123.convex.cloud",
              source: { type: "env" as const, details: "CONVEX_DEPLOY_KEY" },
            }),
          ),
        ),
      );

      return Effect.gen(function* () {
        const admin = yield* DeploymentAdmin;
        const failure = yield* admin
          .getDeploymentInfo({
            deploymentUrl: "https://calm-cat-123.convex.cloud",
          })
          .pipe(Effect.flip);

        expect(failure._tag).toBe("Convex.HttpError");
        expect(failure.status).toBe(0);
        expect(failure.body).toContain("network down");
      }).pipe(Effect.provide(layer));
    },
  );

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
