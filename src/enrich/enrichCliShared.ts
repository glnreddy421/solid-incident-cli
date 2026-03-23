import { readFile } from "fs/promises";
import { resolve } from "path";
import { SolidError } from "../contracts/errors.js";

/**
 * Shown in help, docs, and UI whenever a user-configured (BYO) LLM endpoint is used.
 * SOLIDX itself runs locally; outbound enrichment is entirely under the operator’s control.
 */
export const BYO_OUTBOUND_LLM_NOTICE =
  "Bring-your-own LLM: you supply the endpoint and credentials. SOLIDX runs on your machine; when enrichment runs, it sends a structured analysis payload to your URL. You are responsible for that service, network path, data handling, compliance, and anything the model returns. The SOLIDX project does not operate your model and is not responsible for your BYO provider or its output.";

export function parseEnrichHeaders(values: string[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of values ?? []) {
    const index = entry.indexOf(":");
    if (index <= 0) {
      throw new SolidError("INVALID_FLAGS", `Invalid --header "${entry}". Expected key:value.`, {
        recoverable: true,
      });
    }
    const key = entry.slice(0, index).trim();
    const value = entry.slice(index + 1).trim();
    if (!key) {
      throw new SolidError("INVALID_FLAGS", `Invalid --header "${entry}". Header key is empty.`, {
        recoverable: true,
      });
    }
    out[key] = value;
  }
  return out;
}

export async function readOptionalEnrichTextFile(pathValue: string | undefined): Promise<string | undefined> {
  if (!pathValue) return undefined;
  const raw = await readFile(resolve(pathValue), "utf8");
  const trimmed = raw.trim();
  return trimmed.length ? trimmed : undefined;
}
