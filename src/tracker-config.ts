import pricingConfigDefault from "../pricing.json" with { type: "json" };
import modelAliasesDefault from "../model-aliases.json" with { type: "json" };
import type { PricingConfig } from "./types.js";

type TrackerProvider = "openai" | "anthropic" | "google";

export interface ModelAliasConfig {
  openai?: Record<string, string[]>;
  anthropic?: Record<string, string[]>;
  google?: Record<string, string[]>;
}

export interface TrackerRuntimeConfig {
  pricing: Record<string, { input: number; output: number }>;
  aliases: ModelAliasConfig;
  canonicalModels: Record<TrackerProvider, string[]>;
}

let cachedRuntimeConfig: TrackerRuntimeConfig | null = null;

function buildPricingTable(config: PricingConfig) {
  return Object.fromEntries(
    Object.entries(config.models).map(([model, definition]) => [
      model,
      {
        input: definition.inputPricePerMToken,
        output: definition.outputPricePerMToken,
      },
    ])
  );
}

export function buildTrackerRuntimeConfig(options?: {
  pricingConfig?: PricingConfig;
  aliases?: ModelAliasConfig;
}): TrackerRuntimeConfig {
  if (!options?.pricingConfig && !options?.aliases && cachedRuntimeConfig) {
    return cachedRuntimeConfig;
  }

  const pricingConfig = options?.pricingConfig ?? (pricingConfigDefault as unknown as PricingConfig);
  const aliases = options?.aliases ?? (modelAliasesDefault as unknown as ModelAliasConfig);
  const pricing = buildPricingTable(pricingConfig);
  const canonicalModels: Record<TrackerProvider, string[]> = {
    openai: Object.entries(pricingConfig.models)
      .filter(([, definition]) => (definition as any).provider === "openai")
      .map(([model]) => model)
      .sort((a, b) => b.length - a.length),
    anthropic: Object.entries(pricingConfig.models)
      .filter(([, definition]) => (definition as any).provider === "anthropic")
      .map(([model]) => model)
      .sort((a, b) => b.length - a.length),
    google: Object.entries(pricingConfig.models)
      .filter(([, definition]) => (definition as any).provider === "google")
      .map(([model]) => model)
      .sort((a, b) => b.length - a.length),
  };

  const runtimeConfig = {
    pricing,
    aliases,
    canonicalModels,
  };

  if (!options?.pricingConfig && !options?.aliases) {
    cachedRuntimeConfig = runtimeConfig;
  }

  return runtimeConfig;
}
