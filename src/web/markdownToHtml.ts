/**
 * Convert a limited Markdown subset to safe HTML for the local web UI.
 * No raw HTML pass-through; no script/style tags emitted.
 */

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Format one line segment: code spans, then **bold**, escape remainder. */
function formatInlineSegment(segment: string): string {
  const parts = segment.split(/(`+[^`]*`+)/g);
  return parts
    .map((part) => {
      const codeMatch = /^`([^`]*)`$/.exec(part);
      if (codeMatch) {
        return `<code class="prose-code">${escapeHtml(codeMatch[1])}</code>`;
      }
      const boldChunks = part.split(/(\*\*[^*]+\*\*)/g);
      return boldChunks
        .map((c) => {
          const m = /^\*\*([^*]+)\*\*$/.exec(c);
          if (m) return `<strong>${escapeHtml(m[1])}</strong>`;
          return escapeHtml(c);
        })
        .join("");
    })
    .join("");
}

function formatInline(line: string): string {
  return formatInlineSegment(line);
}

/**
 * Block-level markdown → HTML. Suitable for AI narratives and heuristic reports.
 */
export function markdownToSafeHtml(markdown: string): string {
  const raw = markdown.replace(/\r\n/g, "\n").trim();
  if (!raw) return "";

  const lines = raw.split("\n");
  const out: string[] = [];
  let i = 0;
  let listKind: "ul" | "ol" | null = null;

  const closeList = () => {
    if (listKind) {
      out.push(listKind === "ul" ? "</ul>" : "</ol>");
      listKind = null;
    }
  };

  while (i < lines.length) {
    let line = lines[i];
    const trimmed = line.trimEnd();
    const t = trimmed.trim();

    if (t === "") {
      closeList();
      i++;
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(t);
    if (heading) {
      closeList();
      const level = heading[1].length;
      const tag = level === 1 ? "h2" : level === 2 ? "h3" : "h4";
      out.push(`<${tag} class="prose-heading">${formatInline(heading[2].trim())}</${tag}>`);
      i++;
      continue;
    }

    if (t === "---" || t === "***") {
      closeList();
      out.push('<hr class="prose-hr" />');
      i++;
      continue;
    }

    if (t.startsWith("> ")) {
      closeList();
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ""));
        i++;
      }
      out.push(`<blockquote class="prose-quote">${quoteLines.map((q) => `<p>${formatInline(q)}</p>`).join("")}</blockquote>`);
      continue;
    }

    const ul = /^[-*]\s+(.*)$/.exec(t);
    if (ul) {
      if (listKind !== "ul") {
        closeList();
        out.push('<ul class="prose-list">');
        listKind = "ul";
      }
      out.push(`<li>${formatInline(ul[1])}</li>`);
      i++;
      continue;
    }

    const ol = /^(\d+)\.\s+(.*)$/.exec(t);
    if (ol) {
      if (listKind !== "ol") {
        closeList();
        out.push('<ol class="prose-list prose-ol">');
        listKind = "ol";
      }
      out.push(`<li>${formatInline(ol[2])}</li>`);
      i++;
      continue;
    }

    closeList();
    const para: string[] = [t];
    i++;
    while (i < lines.length) {
      const next = lines[i].trim();
      if (next === "") break;
      if (/^#{1,3}\s/.test(next)) break;
      if (/^[-*]\s/.test(next)) break;
      if (/^\d+\.\s/.test(next)) break;
      if (next.startsWith(">")) break;
      if (next === "---" || next === "***") break;
      para.push(lines[i].trim());
      i++;
    }
    out.push(`<p class="prose-p">${formatInline(para.join(" "))}</p>`);
  }

  closeList();
  return `<div class="prose-doc">${out.join("\n")}</div>`;
}
