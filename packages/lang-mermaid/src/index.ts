/**
 * @reponova/lang-mermaid — entry point.
 *
 * Exports the LanguagePlugin for Mermaid diagram support.
 */
import type { LanguagePlugin } from "reponova";
import { MermaidExtractor } from "./extractor.js";

export const plugin: LanguagePlugin = {
  id: "mermaid",
  fileType: "mermaid",
  configDefaults: { parse: true },
  extractor: new MermaidExtractor(),
};

export { MermaidExtractor };
export default plugin;
