import { describe, expect, it } from "vitest";
import { markdownToSafeHtml } from "../../src/web/markdownToHtml.js";

describe("markdownToSafeHtml", () => {
  it("renders headings and lists without raw asterisks", () => {
    const html = markdownToSafeHtml("## Root Cause\n\n- **Payment** down\n- `svc` error");
    expect(html).toContain("<h3 ");
    expect(html).toContain("<strong>Payment</strong>");
    expect(html).toContain("<code ");
    expect(html).not.toContain("**Payment**");
  });

  it("escapes script tags", () => {
    const html = markdownToSafeHtml("Hello <script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });
});
