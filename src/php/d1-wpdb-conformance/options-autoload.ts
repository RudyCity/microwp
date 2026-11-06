/**
 * Strict, experimental WordPress 7.1.4 wp_load_alloptions() SQL translator.
 *
 * WordPress builds autoload IN values as SQL literals. Only the four values
 * from its pinned wp_autoload_values_to_autoload() function are permitted.
 * The result is a paged, typed structured SELECT: no source SQL reaches D1.
 *
 * This is NOT an installed wpdb adapter. Calling code must collect every
 * page before using it as a complete WordPress alloptions result.
 */
import {
  decodeD1Request, MAX_OFFSET, MAX_ROWS, validIdentifier, type SelectRequest
} from "../d1-protocol/protocol";

export interface AutoloadOptionsConfig {
  /** Server-trusted table name, mapped to the current WordPress site. */
  readonly table: string;
}

const VALUES = new Set(["yes", "on", "auto-on", "auto"]);
const QUERY = /^SELECT\s+option_name\s*,\s*option_value\s+FROM\s+([A-Za-z_][A-Za-z0-9_]*)\s+WHERE\s+autoload\s+IN\s*\(\s*([^()]*)\s*\)$/i;
const QUOTED_VALUE = /^'(yes|on|auto-on|auto)'$/;

function unsupported(): never {
  throw new Error("Unsupported or unsafe WordPress autoload options query");
}

/** Translate one bounded page of a canonical WordPress autoload query. */
export function translateWordPressAutoloadOptions(
  query: string,
  requestId: string,
  config: AutoloadOptionsConfig,
  page = 0
): SelectRequest {
  if (typeof query !== "string" ||
      new TextEncoder().encode(query).byteLength > 2048 ||
      !config || !validIdentifier(config.table) ||
      !Number.isSafeInteger(page) || page < 0 ||
      page * MAX_ROWS > MAX_OFFSET) unsupported();

  const matched = QUERY.exec(query.trim());
  if (!matched || matched[1] !== config.table) unsupported();

  const autoloadValues = matched[2].trim().split(/\s*,\s*/).map((raw) => {
    const match = QUOTED_VALUE.exec(raw);
    if (!match || !VALUES.has(match[1])) unsupported();
    return match[1];
  });
  if (autoloadValues.length < 1 ||
      autoloadValues.length > VALUES.size ||
      new Set(autoloadValues).size !== autoloadValues.length) unsupported();

  // Deterministic key order is mandatory for repeated LIMIT/OFFSET pages.
  const request = {
    version: 1, id: requestId, op: "select", table: config.table,
    columns: ["option_name", "option_value"],
    whereIn: {column: "autoload", values: autoloadValues},
    orderBy: {column: "option_name", direction: "asc"},
    limit: MAX_ROWS, offset: page * MAX_ROWS,
  };
  const validated = decodeD1Request(JSON.stringify(request));
  if (validated.op !== "select") unsupported();
  return validated;
}
