/**
 * Restricted WordPress get_option pre-prepare SELECT translator.
 * Experimental: not installed as a wpdb drop-in.
 */
import {decodeD1Request, type SelectRequest} from "../d1-protocol/protocol";

const OPTIONS_QUERY = "SELECT option_value FROM wp_options WHERE option_name = %s LIMIT 1";

export function translateGetOption(
  template: string,
  optionName: string,
  requestId: string
): SelectRequest {
  if (template.trim() !== OPTIONS_QUERY ||
      typeof optionName !== "string" ||
      optionName.length < 1 ||
      new TextEncoder().encode(optionName).byteLength > 191 ||
      optionName.includes("\u0000")) {
    throw new Error("Unsupported WordPress get_option query");
  }
  const decoded=decodeD1Request(JSON.stringify({
    version:1,id:requestId,op:"select",table:"wp_options",
    columns:["option_value"],
    where:[{column:"option_name",value:optionName}],
    limit:1,offset:0
  }));
  if(decoded.op!=="select")throw new Error("Unsupported D1 query operation");
  return decoded;
}
