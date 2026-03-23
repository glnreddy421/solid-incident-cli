import { describe, expect, it } from "vitest";
import { getProvider, resolveProvider } from "../../src/enrich/providerRegistry.js";
import { SolidError } from "../../src/contracts/errors.js";

describe("providerRegistry", () => {
  it("resolves known providers", () => {
    expect(resolveProvider("openai-compatible").name).toBe("openai-compatible");
    expect(resolveProvider("noop").name).toBe("noop");
    expect(getProvider({ provider: "noop" }).name).toBe("noop");
  });

  it("rejects unknown providers", () => {
    expect(() => resolveProvider("unknown-provider")).toThrowError(SolidError);
  });
});
