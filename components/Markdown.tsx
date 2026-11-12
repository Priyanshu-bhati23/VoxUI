import { Fragment, type ReactNode } from "react";

/**
 * A small Markdown renderer for model output: paragraphs, headings, lists,
 * fenced code, inline code and bold. It builds React nodes directly, so model
 * text is never injected as HTML.
 */

function inline(text: string, onPath?: (path: string) => void): ReactNode[] {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      const code = part.slice(1, -1);
      if (onPath && /[\w-]\.[a-z]{1,5}$|\//i.test(code) && !code.includes(" ")) {
        return (
          <button key={i} type="button" className="md-path" onClick={() => onPath(code)}>
            {code}
          </button>
        );
      }
      return <code key={i}>{code}</code>;
    }
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}

export function Markdown({ text, onPath }: { text: string; onPath?: (path: string) => void }) {
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim().startsWith("```")) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) body.push(lines[i++]);
      i++;
      blocks.push(
        <pre key={blocks.length}>
          <code>{body.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push(<h4 key={blocks.length}>{inline(heading[2], onPath)}</h4>);
      i++;
      continue;
    }

    if (/^\s*([-*]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*]|\d+[.)])\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*]|\d+[.)])\s+/, ""));
        i++;
      }
      const List = ordered ? "ol" : "ul";
      blocks.push(
        <List key={blocks.length}>
          {items.map((item, n) => (
            <li key={n}>{inline(item, onPath)}</li>
          ))}
        </List>,
      );
      continue;
    }

    if (!line.trim()) {
      i++;
      continue;
    }

    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].trim().startsWith("```") &&
      !/^(#{1,4})\s+/.test(lines[i]) &&
      !/^\s*([-*]|\d+[.)])\s+/.test(lines[i])
    ) {
      para.push(lines[i++]);
    }
    blocks.push(<p key={blocks.length}>{inline(para.join(" "), onPath)}</p>);
  }

  return <div className="md">{blocks}</div>;
}
