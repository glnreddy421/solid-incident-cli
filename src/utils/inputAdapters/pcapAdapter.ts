import type { AdapterCandidate, AdapterIngestResult, AdapterInput, AdapterMatchResult, CanonicalEvent, InputAdapter } from "./types.js";

const PCAP_MAGIC = [0xa1b2c3d4, 0xd4c3b2a1, 0xa1b23c4d, 0x4d3cb2a1];
const PCAPNG_MAGIC = 0x0a0d0d0a;

function readU32(buffer: Buffer, offset: number): number | null {
  if (buffer.length < offset + 4) return null;
  return buffer.readUInt32BE(offset);
}

function hasPcapMagic(buffer: Buffer): boolean {
  const v = readU32(buffer, 0);
  if (v == null) return false;
  if (v === PCAPNG_MAGIC) return true;
  return PCAP_MAGIC.includes(v);
}

function toBuffer(content: string | Buffer): Buffer {
  return Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
}

export const pcapAdapter: InputAdapter = {
  adapterId: "pcap",
  displayName: "PCAP Adapter (Scaffold)",
  category: "binary-capture",
  supportedExtensions: [".pcap", ".pcapng", ".cap"],
  supportedMimeTypes: ["application/vnd.tcpdump.pcap", "application/octet-stream"],
  canHandle: (input: AdapterInput): AdapterMatchResult => {
    const path = input.context?.path?.toLowerCase() ?? "";
    const buf = toBuffer(input.content);
    if (path.endsWith(".pcap") || path.endsWith(".pcapng") || path.endsWith(".cap")) {
      return { matched: true, confidence: 0.92, reasons: ["pcap-like extension detected"] };
    }
    if (hasPcapMagic(buf)) {
      return { matched: true, confidence: 0.9, reasons: ["pcap magic bytes detected"] };
    }
    return { matched: false, confidence: 0, reasons: ["no pcap signature detected"] };
  },
  ingest: (_input: AdapterInput, selection: AdapterMatchResult, candidates: AdapterCandidate[]): AdapterIngestResult => {
    const events: CanonicalEvent[] = [];
    return {
      adapterId: "pcap",
      adapterConfidence: selection.confidence,
      adapterReasons: selection.reasons,
      adapterWarnings: selection.warnings,
      candidateAdapters: candidates,
      kind: "canonical-events",
      events,
      warnings: [
        "PCAP adapter scaffold active: full packet decode not implemented yet.",
        "Future extension points: flow extraction, DNS/TLS summaries, HTTP-over-capture reconstruction.",
      ],
    };
  },
};

