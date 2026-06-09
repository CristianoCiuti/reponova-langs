/**
 * @reponova/lang-sql — entry point.
 *
 * Exports the LanguagePlugin for SQL source support across the major
 * dialects (PostgreSQL, MySQL, SQLite, T-SQL, BigQuery).
 */
import type { LanguagePlugin } from "reponova";
import { SqlExtractor } from "./extractor.js";

export const plugin: LanguagePlugin = {
  id: "sql",
  fileType: "sql",
  extractor: new SqlExtractor(),
};

export { SqlExtractor };
export default plugin;
