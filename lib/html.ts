/**
 * Helpers for the generated documents.
 * Generated HTML is untrusted: it only ever runs inside a sandboxed iframe, and
 * a Content-Security-Policy is injected so it cannot load or send anything
 * over the network.
 */

const CSP =
  "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:\">";

/** Drop Markdown fences and anything the model wrote before the document. */
export function cleanHtml(raw: string): string {
  let text = raw;
  const start = text.search(/<!doctype html|<html/i);
  if (start > 0) text = text.slice(start);
  else if (start === -1) text = text.replace(/^\s*```[a-z]*\s*/i, "");
  const end = text.toLowerCase().lastIndexOf("</html>");
  if (end !== -1) text = text.slice(0, end + 7);
  else text = text.replace(/```\s*$/, "");
  return text;
}

/** The document as the preview iframe should load it. */
export function forPreview(html: string): string {
  if (!html.trim()) return "";
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (head) => `${head}${CSP}`);
  return `${CSP}${html}`;
}

export function looksComplete(html: string): boolean {
  return /<\/html>\s*$/i.test(html.trim());
}
