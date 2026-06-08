/**
 * @reponova/lang-plantuml — entry point.
 *
 * Exports the LanguagePlugin for PlantUML diagram support.
 */
import type { LanguagePlugin } from "reponova";
import { PlantUmlExtractor } from "./extractor.js";

export const plugin: LanguagePlugin = {
  id: "plantuml",
  fileType: "plantuml",
  configDefaults: { parse: true },
  extractor: new PlantUmlExtractor(),
};

export { PlantUmlExtractor };
