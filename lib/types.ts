export interface Version {
  id: number;
  /** What the person asked for. */
  request: string;
  html: string;
  /** "sample" marks the bundled hand-written example, not AI output. */
  source: "ai" | "sample";
}
