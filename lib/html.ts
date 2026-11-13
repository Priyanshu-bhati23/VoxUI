import { KIT_CLASSES, KIT_CSS, KIT_JS } from "./kit";

/**
 * Helpers for the generated documents.
 * Generated HTML is untrusted: it only ever runs inside a sandboxed iframe, and
 * a Content-Security-Policy is injected so it cannot load or send anything
 * over the network.
 */

const CSP =
  "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:\">";

/**
 * Reports script errors in the generated page to VoxUI, which can then ask the
 * model to fix them. It runs before any of the page's own code.
 */
const ERROR_HOOK = `<script>(function(){var sent=0;function report(m){if(sent++<5)parent.postMessage({voxuiError:String(m).slice(0,300)},"*")}window.addEventListener("error",function(e){report((e.message||"Script error")+(e.lineno?" (line "+e.lineno+")":""))});window.addEventListener("unhandledrejection",function(e){report(e.reason&&e.reason.message||e.reason)})})();</script>`;

const KIT = `<style data-voxui-kit>${KIT_CSS}</style><script data-voxui-kit>${KIT_JS}</script>`;

const KIT_CLASS_SET = new Set(KIT_CLASSES);

/** True when a selector only restyles what the design kit already styles. */
function restylesKit(selector: string): boolean {
  const text = selector.trim();
  if (!text || text.startsWith(":root") || text.startsWith("@")) return false;
  const classes = [...text.matchAll(/\.([a-zA-Z_][\w-]*)/g)].map((m) => m[1]);
  if (classes.length === 0) return /^(html|body|\*|button|input|a)\b/.test(text);
  return classes.every((name) => KIT_CLASS_SET.has(name));
}

/**
 * Models like to redefine common class names such as .btn or .card, which
 * breaks the design kit's layout. This removes those rules from the page's own
 * stylesheet and keeps everything else: variables, new classes, media queries.
 */
export function dropKitOverrides(html: string): string {
  return html.replace(/(<style[^>]*>)([\s\S]*?)(<\/style>|$)/i, (_, open: string, css: string, close: string) => {
    let out = "";
    let depth = 0;
    let ruleStart = 0;
    let skip = false;
    for (let i = 0; i < css.length; i++) {
      const ch = css[i];
      if (ch === "{") {
        if (depth === 0) {
          const selector = css.slice(ruleStart, i);
          skip = !selector.trim().startsWith("@") && selector.split(",").every(restylesKit);
        }
        depth++;
      } else if (ch === "}") {
        depth = Math.max(0, depth - 1);
        if (depth === 0) {
          if (!skip) out += css.slice(ruleStart, i + 1);
          ruleStart = i + 1;
          skip = false;
        }
      }
    }
    // Whatever is left is a rule still being streamed: keep it out until it is complete.
    return open + out + (close ? close : "");
  });
}

/** Drop Markdown fences and anything the model wrote before the document. */
export function cleanHtml(raw: string): string {
  let text = raw;
  const start = text.search(/<!doctype html|<html/i);
  if (start > 0) text = text.slice(start);
  else if (start === -1) text = text.replace(/^\s*```[a-z]*\s*/i, "");
  const end = text.toLowerCase().lastIndexOf("</html>");
  if (end !== -1) text = text.slice(0, end + 7);
  else text = text.replace(/```\s*$/, "");
  // The page may not load other files. Models sometimes add tags for the design kit anyway.
  text = text.replace(/<link\b[^>]*>/gi, "").replace(/<script\b[^>]*\bsrc\s*=[^>]*>\s*<\/script>/gi, "");
  return text;
}

/** Matches the opening <head> tag, and not <header>. */
const HEAD = /<head(\s[^>]*)?>/i;

function intoHead(html: string, extra: string): string {
  if (HEAD.test(html)) return html.replace(HEAD, (head) => `${head}${extra}`);
  return `${extra}${html}`;
}

/** The document as the preview iframe should load it: locked down, with the design kit. */
export function forPreview(html: string, withKit: boolean, reportErrors = false): string {
  if (!html.trim()) return "";
  return intoHead(html, CSP + (reportErrors ? ERROR_HOOK : "") + (withKit ? KIT : ""));
}

/** The document as a file to keep: the design kit is included so it works on its own. */
export function forExport(html: string, withKit: boolean): string {
  return withKit ? intoHead(html, KIT) : html;
}

export function looksComplete(html: string): boolean {
  return /<\/html>\s*$/i.test(html.trim());
}
