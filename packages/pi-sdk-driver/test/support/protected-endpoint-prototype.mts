import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import {
  InMemoryCredentialStore,
  lazyStream,
  normalizeContext,
  type FetchFunction,
  type Model,
  type OpenAICompletionsOptions,
} from "@earendil-works/pi-ai";
import {
  stream as streamOpenAi,
  streamSimple as streamOpenAiSimple,
} from "@earendil-works/pi-ai/api/openai-completions";
import {
  BUILT_IN_PROVIDER_IDS,
  CUSTOM_PROVIDER_ID_PATTERN,
  OPENAI_COMPLETIONS_API,
} from "../../dist/custom-provider-types.js";

const SDK_PLACEHOLDER_KEY = "pi-gui-prototype-placeholder";

export const blockReason = {
  destination:
    "Model request blocked because its destination differs from the registered endpoint.",
  redirect: "Model request blocked because the registered endpoint redirected it.",
  transport: "Model request blocked because its transport cannot be checked.",
} as const;

type BlockReason = keyof typeof blockReason;
type Registration = Omit<Parameters<ModelRuntime["registerProvider"]>[1], "api" | "apiKey">;

export interface PrototypeEndpoint {
  readonly providerId: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly protect: boolean;
  readonly models: NonNullable<Registration["models"]>;
}

export async function createProtectedEndpointPrototype(
  endpoints: readonly PrototypeEndpoint[],
  onBlocked: (reason: BlockReason, message: string) => void,
): Promise<ModelRuntime> {
  const runtime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsPath: null,
    refreshOnCreate: false,
  });
  const protections = new Map<string, { base: URL; fetch: FetchFunction }>();
  const registered = new Set<string>();
  for (const endpoint of endpoints) {
    if (
      !CUSTOM_PROVIDER_ID_PATTERN.test(endpoint.providerId) ||
      BUILT_IN_PROVIDER_IDS.has(endpoint.providerId) ||
      registered.has(endpoint.providerId)
    ) {
      throw new Error("The prototype requires unique Pi-GUI custom provider IDs.");
    }
    registered.add(endpoint.providerId);
    const base = new URL(endpoint.baseUrl);
    if (!isHttpEndpoint(base)) {
      throw new Error(
        "The prototype requires an HTTP(S) base URL without credentials, query, or fragment.",
      );
    }
    base.pathname = base.pathname.replace(/\/+$/, "");
    if (endpoint.protect) {
      protections.set(endpoint.providerId, {
        base,
        fetch: createProtectedFetch(base, endpoint.apiKey, onBlocked),
      });
    }
    runtime.registerProvider(endpoint.providerId, {
      api: OPENAI_COMPLETIONS_API,
      baseUrl: endpoint.baseUrl,
      apiKey: endpoint.protect ? SDK_PLACEHOLDER_KEY : endpoint.apiKey,
      models: endpoint.models,
    });
  }

  const delegateSimple = runtime.streamSimple.bind(runtime);
  const delegateStream = runtime.stream.bind(runtime);
  const streamProtected = (
    model: Parameters<ModelRuntime["streamSimple"]>[0],
    protection: { base: URL; fetch: FetchFunction },
    dispatch: (
      model: Model<"openai-completions">,
      fetch: FetchFunction,
    ) => ReturnType<ModelRuntime["streamSimple"]>,
  ) => {
    const selectedBase = URL.parse(model.baseUrl);
    const reason =
      model.api !== OPENAI_COMPLETIONS_API
        ? "transport"
        : !selectedBase ||
            !isHttpEndpoint(selectedBase) ||
            selectedBase.origin !== protection.base.origin ||
            selectedBase.pathname.replace(/\/+$/, "") !==
              protection.base.pathname.replace(/\/+$/, "")
          ? "destination"
          : undefined;
    if (reason) {
      onBlocked(reason, blockReason[reason]);
      return lazyStream(model, () => Promise.reject(new Error(blockReason[reason])));
    }
    // Select the known HTTP adapter directly. Replacing a provider registration must never replace this dispatch.
    return dispatch(model as Model<"openai-completions">, protection.fetch);
  };

  // These are instance-local in this harness. Auto-compaction and cache warming can call the model
  // runtime directly, in addition to requests sent through the agent's stream function.
  runtime.streamSimple = (model, context, options) => {
    const protection = protections.get(model.provider);
    if (!protection) return delegateSimple(model, context, options);
    return streamProtected(model, protection, (checked, fetch) =>
      streamOpenAiSimple(checked, normalizeContext(context), {
        ...options,
        apiKey: SDK_PLACEHOLDER_KEY,
        fetch,
      }),
    );
  };
  runtime.stream = (model, context, options) => {
    const protection = protections.get(model.provider);
    if (!protection) return delegateStream(model, context, options);
    return streamProtected(model, protection, (checked, fetch) =>
      streamOpenAi(checked, normalizeContext(context), {
        ...(options as OpenAICompletionsOptions | undefined),
        apiKey: SDK_PLACEHOLDER_KEY,
        fetch,
      }),
    );
  };
  await runtime.refresh({ allowNetwork: false });
  return runtime;
}

function isHttpEndpoint(url: URL): boolean {
  return (
    (url.protocol === "http:" || url.protocol === "https:") &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash
  );
}

export function createProtectedFetch(
  base: URL,
  key: string,
  onBlocked: (reason: BlockReason, message: string) => void,
): FetchFunction {
  const pathname = `${base.pathname.replace(/\/+$/, "")}/chat/completions`;
  const send = globalThis.fetch;
  const reject = (reason: BlockReason) => {
    onBlocked(reason, blockReason[reason]);
    // A local terminal response preserves the reason through the SDK and prevents HTTP retries.
    return Response.json({ error: { message: blockReason[reason] } }, { status: 400 });
  };
  return async (input, init) => {
    let request: Request;
    try {
      request = new Request(input, init);
    } catch {
      return reject("transport");
    }
    const target = new URL(request.url);
    if (
      !isHttpEndpoint(target) ||
      target.origin !== base.origin ||
      target.pathname !== pathname ||
      request.method !== "POST"
    ) {
      return reject("destination");
    }
    const headers = new Headers(request.headers);
    // Keep the HTTP authority derived from the checked URL.
    headers.delete("host");
    headers.delete("proxy-authorization");
    let outbound: Request;
    try {
      headers.set("authorization", `Bearer ${key}`);
      outbound = new Request(request, { headers, redirect: "manual" });
    } catch {
      return reject("transport");
    }
    const response = await send(outbound);
    if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
      await response.body?.cancel().catch(() => undefined);
      return reject("redirect");
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      const retryAfter = response.headers.get("retry-after-ms");
      return Response.json(
        { error: { message: `Model endpoint returned HTTP ${response.status}.` } },
        {
          status: response.status,
          ...(retryAfter && /^\d+$/.test(retryAfter)
            ? { headers: { "retry-after-ms": retryAfter } }
            : {}),
        },
      );
    }
    return response;
  };
}
