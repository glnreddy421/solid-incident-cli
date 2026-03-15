export type LiveHealthState = "watching" | "abnormal" | "incident-candidate" | "active" | "stabilizing";

export interface LiveModeState {
  enabled: boolean;
  paused: boolean;
  health: LiveHealthState;
}

export function deriveLiveHealth(signalCount: number, criticalCount: number): LiveHealthState {
  if (criticalCount >= 2) return "active";
  if (criticalCount >= 1) return "incident-candidate";
  if (signalCount >= 2) return "abnormal";
  if (signalCount === 0) return "watching";
  return "stabilizing";
}

