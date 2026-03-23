import { SolidError } from "../contracts/errors.js";
import type { EnrichmentProvider, EnrichmentProviderConfig, EnrichmentProviderName } from "./types.js";
import { NoopProvider } from "./providers/noopProvider.js";
import { OpenAiCompatibleProvider } from "./providers/openaiCompatibleProvider.js";

const PROVIDERS: Record<EnrichmentProviderName, EnrichmentProvider> = {
  "openai-compatible": new OpenAiCompatibleProvider(),
  noop: new NoopProvider(),
};

export function listProviders(): EnrichmentProviderName[] {
  return Object.keys(PROVIDERS) as EnrichmentProviderName[];
}

export function resolveProvider(name: string): EnrichmentProvider {
  if (!name) {
    throw new SolidError("INVALID_FLAGS", "Missing --provider. Use one of: openai-compatible, noop.", {
      recoverable: true,
    });
  }
  const provider = PROVIDERS[name as EnrichmentProviderName];
  if (!provider) {
    throw new SolidError("INVALID_FLAGS", `Unknown provider "${name}". Use one of: ${listProviders().join(", ")}.`, {
      recoverable: true,
    });
  }
  return provider;
}

export function getProvider(config: EnrichmentProviderConfig): EnrichmentProvider {
  return resolveProvider(config.provider);
}
