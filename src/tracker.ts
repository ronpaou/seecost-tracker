/**
 * SeeCost Eavesdropping Tracker (Lightweight Interceptor)
 * A lightweight SDK that computes token usage and estimated cost
 * without interfering with the app's own network flow.
 */
import type { PricingConfig } from "./types.js";
import {
  buildTrackerRuntimeConfig,
  type ModelAliasConfig,
} from "./tracker-config.js";

export interface TrackerOptions {
  /** Callback invoked when a cost log has been computed */
  onCostCalculated?: (log: CostLog) => void;
  /** Whether to print debug logs to the console */
  debug?: boolean;
  /** App label used to group logs inside SeeCost */
  appName?: string;
  /** Settings used to send logs to SeeCost automatically */
  ingest?: {
    endpoint: string;
    apiKey: string;
  };
  /** Override bundled pricing definitions */
  pricingConfig?: PricingConfig;
  /** Override bundled model alias definitions */
  modelAliases?: ModelAliasConfig;
}

export interface TrackerEnv {
  SEECOST_INGEST_ENDPOINT?: string;
  SEECOST_API_KEY?: string;
  SEECOST_DEBUG?: string;
  SEECOST_APP_NAME?: string;
}

export interface CostLog {
  provider: 'openai' | 'google' | 'anthropic' | 'unknown';
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
  timestamp: string;
  app_name?: string;
}

type FetchArgs = Parameters<typeof fetch>;
const TRACKER_PATCH_FLAG = "__seecostTrackerPatched__";
const TRACKER_WRAPPED_FETCH_FLAG = "__seecostWrappedFetch__";
const TRACKER_BASE_FETCH_KEY = "__seecostBaseFetch__";
const TRACKER_ORIGINAL_FETCH_KEY = "__seecostOriginalFetch__";
const TRACKER_STATE_KEY = "__seecostTrackerState__";
const TRACKER_LOG_PREFIX = "[SeeCost Tracker]";

type TrackerState = {
  originalFetch: typeof fetch;
  options: TrackerOptions;
  runtimeConfig: ReturnType<typeof buildTrackerRuntimeConfig>;
};

type WrappedFetch = typeof fetch & Record<string, unknown>;

function resolveFetchUrl(input: FetchArgs[0]): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  if (input instanceof Request) return input.url;
  return String((input as { url?: string }).url ?? input);
}

function normalizeModelName(
  provider: CostLog["provider"],
  rawModel: string,
  runtimeConfig: ReturnType<typeof buildTrackerRuntimeConfig>
): string {
  const normalized = rawModel.trim().toLowerCase();
  if (!normalized) return "unknown";

  if (normalized in runtimeConfig.pricing) {
    return normalized;
  }

  if (provider === "unknown") {
    return normalized;
  }

  const providerAliases = runtimeConfig.aliases[provider] ?? {};
  for (const [canonical, aliases] of Object.entries(providerAliases)) {
    if (aliases.some((alias) => alias.toLowerCase() === normalized)) {
      return canonical;
    }
  }

  const candidates = runtimeConfig.canonicalModels[provider];
  for (const candidate of candidates) {
    if (
      normalized === candidate ||
      normalized.startsWith(`${candidate}-`) ||
      normalized.startsWith(`${candidate}@`) ||
      normalized.startsWith(`${candidate}:`)
    ) {
      return candidate;
    }
  }

  return normalized;
}

/**
 * Initialize the tracker once near the earliest server-side entry point.
 */
export function initSeeCostTracker(options: TrackerOptions = {}) {
  if (typeof globalThis.fetch === 'undefined') return;

  const globalState = globalThis as typeof globalThis & Record<string, unknown>;
  const currentFetch = globalThis.fetch as WrappedFetch;
  const existingState = globalState[TRACKER_STATE_KEY] as TrackerState | undefined;
  const runtimeConfig = buildTrackerRuntimeConfig({
    pricingConfig: options.pricingConfig,
    aliases: options.modelAliases,
  });

  if (existingState) {
    existingState.options = options;
    existingState.runtimeConfig = runtimeConfig;
  }

  const patchFetch = (baseFetch: typeof fetch, state: TrackerState) => {
    // Monkey-patch fetch while preserving the original response path.
    const wrappedFetch = async (...args: FetchArgs) => {
      const start = Date.now();
      const url = resolveFetchUrl(args[0]);
      let provider: CostLog['provider'] = 'unknown';

      // Detect whether this request targets a supported provider.
      if (url.includes('api.openai.com')) provider = 'openai';
      else if (url.includes('generativelanguage.googleapis.com')) provider = 'google';
      else if (url.includes('api.anthropic.com')) provider = 'anthropic';

      // Pass through non-target requests untouched.
      if (provider === 'unknown') {
        return baseFetch.apply(globalThis, args as any);
      }

      debugLog(state.options, `intercepted ${provider} request -> ${url}`);

      // Run the original request without modifying the destination.
      const response = await baseFetch.apply(globalThis, args as any);
      const latencyMs = Date.now() - start;

      try {
        // Clone the response so the app can still consume the original body.
        const clone = response.clone();
        const contentType = clone.headers.get("content-type") ?? "";

        if (!contentType.includes("application/json")) {
          debugLog(
            state.options,
            `skipped ${provider} response because content-type is ${contentType || "unknown"}`
          );
          return response;
        }
        
        // Parse asynchronously so request handling is not blocked.
        clone.json().then(data => {
          let inputTokens = 0;
          let outputTokens = 0;
          let rawModel = 'unknown';

          if (provider === 'openai') {
            rawModel = data.model || 'unknown';
            inputTokens = data.usage?.prompt_tokens || 0;
            outputTokens = data.usage?.completion_tokens || 0;
          } else if (provider === 'google') {
            // Gemini model names are extracted from the request URL.
            const match = url.match(/models\/([^:]+)/);
            if (match) rawModel = match[1];
            inputTokens = data.usageMetadata?.promptTokenCount || 0;
            outputTokens = data.usageMetadata?.candidatesTokenCount || 0;
          } else if (provider === 'anthropic') {
            rawModel = data.model || 'unknown';
            inputTokens = data.usage?.input_tokens || 0;
            outputTokens = data.usage?.output_tokens || 0;
          }

          const model = normalizeModelName(provider, rawModel, state.runtimeConfig);

          let costUsd = 0;
          // Compute cost only when the model has a known pricing entry.
          const rate = state.runtimeConfig.pricing[model];
          if (rate) {
            costUsd = (inputTokens / 1_000_000) * rate.input + (outputTokens / 1_000_000) * rate.output;
          }

          const log: CostLog = {
            provider,
            model,
            inputTokens,
            outputTokens,
            costUsd,
            latencyMs,
            timestamp: new Date().toISOString(),
            app_name: state.options.appName?.trim() || undefined,
          };

          if (state.options.debug) {
            console.log(`\x1b[36m${TRACKER_LOG_PREFIX}\x1b[0m 💰 $${costUsd.toFixed(6)} | ${model} | In:${inputTokens} Out:${outputTokens} | ${latencyMs}ms`);
          }

          if (state.options.onCostCalculated) {
            state.options.onCostCalculated(log);
          }

          if (state.options.ingest?.endpoint && state.options.ingest.apiKey) {
            void sendToSeeCost(baseFetch, log, state.options.ingest, state.options);
          }
        }).catch(() => {
          // Ignore parse failures quietly for unsupported cases such as streams.
          debugLog(
            state.options,
            `failed to parse ${provider} response as JSON. Streaming responses are not tracked by the current SDK.`
          );
        });

      } catch (err) {
        // Never let tracker failures take down the app request.
        console.error(`${TRACKER_LOG_PREFIX} error`, err);
      }

      // Always return the original response to the application.
      return response;
    };

    const taggedFetch = wrappedFetch as WrappedFetch;
    taggedFetch[TRACKER_WRAPPED_FETCH_FLAG] = true;
    taggedFetch[TRACKER_BASE_FETCH_KEY] = baseFetch;
    return taggedFetch as typeof fetch;
  };

  const isWrapped = Boolean(currentFetch[TRACKER_WRAPPED_FETCH_FLAG]);
  const baseFetch = (isWrapped
    ? currentFetch[TRACKER_BASE_FETCH_KEY]
    : currentFetch) as typeof fetch;

  if (isWrapped && existingState && existingState.originalFetch === baseFetch) {
    debugLog(options, `reconfigured${options.ingest ? ` -> ${options.ingest.endpoint}` : ""}`);
    globalState[TRACKER_PATCH_FLAG] = true;
    return;
  }

  const state = existingState ?? {
    originalFetch: baseFetch,
    options,
    runtimeConfig,
  };
  state.originalFetch = baseFetch;
  state.options = options;
  state.runtimeConfig = runtimeConfig;

  globalState[TRACKER_ORIGINAL_FETCH_KEY] = baseFetch;
  globalState[TRACKER_STATE_KEY] = state;
  globalState[TRACKER_PATCH_FLAG] = true;
  globalThis.fetch = patchFetch(baseFetch, state);
  debugLog(
    options,
    `${existingState ? "re-patched" : "initialized"}${options.ingest ? ` -> ${options.ingest.endpoint}` : ""}`
  );
}

export function getSeeCostOptionsFromEnv(env: TrackerEnv = process.env): TrackerOptions {
  const endpoint = env.SEECOST_INGEST_ENDPOINT?.trim();
  const apiKey = env.SEECOST_API_KEY?.trim();

  if (!endpoint) {
    throw new Error("SEECOST_INGEST_ENDPOINT is required");
  }

  if (!apiKey) {
    throw new Error("SEECOST_API_KEY is required");
  }

  return {
    appName: env.SEECOST_APP_NAME?.trim() || undefined,
    ingest: {
      endpoint,
      apiKey,
    },
    debug: env.SEECOST_DEBUG === "true",
  };
}

export function initSeeCostTrackerFromEnv(env: TrackerEnv = process.env) {
  const options = getSeeCostOptionsFromEnv(env);
  initSeeCostTracker(options);
  return options;
}

async function sendToSeeCost(
  fetchImpl: typeof fetch,
  log: CostLog,
  ingest: NonNullable<TrackerOptions["ingest"]>,
  options: TrackerOptions
) {
  try {
    const response = await fetchImpl(ingest.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-SeeCost-API-Key': ingest.apiKey,
      },
      body: JSON.stringify(log),
    });

    if (!response.ok) {
      const errorMessage = await getSeeCostErrorMessage(response);
      debugLog(options, `ingest failed: ${errorMessage}`);
      return;
    }

    debugLog(options, `ingest ok for ${log.provider}:${log.model}`);
  } catch {
    // Swallow ingest failures so the app request remains unaffected.
    debugLog(options, `ingest request failed`);
  }
}

async function getSeeCostErrorMessage(response: Response) {
  const fallback = `${response.status} ${response.statusText}`.trim();
  try {
    const payload = await response.clone().json() as {
      error?: {
        message?: unknown;
      };
    };
    if (typeof payload.error?.message === "string" && payload.error.message.trim()) {
      return payload.error.message.trim();
    }
  } catch {
    // Keep the original HTTP status if the ingest endpoint does not return JSON.
  }
  return fallback;
}

function debugLog(options: TrackerOptions, message: string) {
  if (!options.debug) return;
  console.log(`${TRACKER_LOG_PREFIX} ${message}`);
}
