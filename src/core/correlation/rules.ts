import type { CanonicalEvent } from "../../utils/inputAdapters/types.js";
import {
  detectConnectionFailureClusters,
  detectCrossSourcePropagationFindings,
  detectErrorBurstFindings,
  detectTimeoutRetryFailureChains,
  detectUserVisibleBackendCorroboration,
} from "./heuristics.js";
import type { CausalChain, Finding } from "./types.js";

export interface CorrelationRuleOutput {
  ruleName?: string;
  findings?: Finding[];
  chains?: CausalChain[];
}

export interface CorrelationRule {
  id: string;
  name?: string;
  run: (events: CanonicalEvent[]) => CorrelationRuleOutput;
}

const builtinRules: CorrelationRule[] = [
  {
    id: "timeout-retry-failure-chain",
    name: "Timeout -> Retry -> Failure",
    run: (events) => ({ ruleName: "Timeout -> Retry -> Failure", chains: detectTimeoutRetryFailureChains(events) }),
  },
  {
    id: "error-burst",
    name: "Error Burst",
    run: (events) => ({ ruleName: "Error Burst", findings: detectErrorBurstFindings(events) }),
  },
  {
    id: "cross-source-propagation",
    name: "Cross-source Propagation",
    run: (events) => ({ ruleName: "Cross-source Propagation", findings: detectCrossSourcePropagationFindings(events) }),
  },
  {
    id: "user-visible-backend-corroboration",
    name: "User-visible + Backend Corroboration",
    run: (events) => ({ ruleName: "User-visible + Backend Corroboration", findings: detectUserVisibleBackendCorroboration(events) }),
  },
  {
    id: "connection-failure-cluster",
    name: "Connection Failure Cluster",
    run: (events) => ({ ruleName: "Connection Failure Cluster", findings: detectConnectionFailureClusters(events) }),
  },
];

const customRules: CorrelationRule[] = [];

export function registerCorrelationRule(rule: CorrelationRule): void {
  customRules.push(rule);
}

export function resetCorrelationRulesForTests(): void {
  customRules.length = 0;
}

export function getCorrelationRules(): CorrelationRule[] {
  // Deterministic execution order: builtins then user-registered.
  return [...builtinRules, ...customRules];
}

