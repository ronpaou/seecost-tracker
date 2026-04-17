export interface PricingDefinition {
  provider: string;
  name: string;
  inputPricePerMToken: number;
  outputPricePerMToken: number;
}

export interface PricingConfig {
  models: Record<string, PricingDefinition>;
}
