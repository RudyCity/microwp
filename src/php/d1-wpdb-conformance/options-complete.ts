/**
 * Experimental, fail-closed complete reader for pinned WordPress autoload
 * options. NEVER install as a WordPress wpdb or HTTP endpoint.
 *
 * Two identical bounded reads detect many concurrent modifications but are
 * NOT a D1 transaction or an atomic, consistent multi-page snapshot.
 */
import {MAX_RESPONSE_BYTES, MAX_ROWS} from "../d1-protocol/protocol";
import {
  translateWordPressAutoloadOptions, type AutoloadOptionsConfig
} from "./options-autoload";

export const MAX_AUTOLOAD_PAGES = 10;
export const MAX_AUTOLOAD_OPTIONS = MAX_AUTOLOAD_PAGES * MAX_ROWS;
export const MAX_AUTOLOAD_TOTAL_BYTES = 256 * 1024;
export const MAX_AUTOLOAD_VALUE_BYTES = 32 * 1024;

/**
 * Host-owned and already authorized D1 adapter callback. The callerKey and
 * D1 binding are intentionally not exposed to WordPress PHP or network input.
 */
export type PrivateD1Query = (message: string) => Promise<string>;

/** Return null-prototype string values; never return partially read options. */
export type AutoloadOptions = Readonly<Record<string, string>>;

function refuse(): never {
  throw new Error("WordPress autoload options could not be verified");
}
const encoder = new TextEncoder();

function utf8Bytes(value: string): number {
  return encoder.encode(value).byteLength;
}
function lessThanUtf8(previous: string, current: string): boolean {
  const left = encoder.encode(previous);
  const right = encoder.encode(current);
  for (let index=0; index < Math.min(left.length,right.length); index++) {
    if (left[index] !== right[index]) return left[index] < right[index];
  }
  return left.length < right.length;
}
interface Option {
  readonly option_name: string;
  readonly option_value: string;
}
function readRows(raw: unknown, id: string): Option[] {
  if (typeof raw !== "string" || utf8Bytes(raw) > MAX_RESPONSE_BYTES) refuse();
  let value: unknown;
  try { value=JSON.parse(raw); } catch { return refuse(); }
  if (value===null || typeof value!=="object" || Array.isArray(value)) refuse();
  const result=value as Record<string, unknown>;
  if (Object.keys(result).sort().join(",")!=="id,ok,op,rows,version" ||
      result.version!==1 || result.id!==id || result.ok!==true ||
      result.op!=="select" || !Array.isArray(result.rows) ||
      result.rows.length>MAX_ROWS) refuse();
  const options: Option[] = [];
  for (const item of result.rows) {
    if (item===null || typeof item!=="object" || Array.isArray(item)) refuse();
    const row=item as Record<string, unknown>;
    if (Object.keys(row).sort().join(",")!=="option_name,option_value" ||
        typeof row.option_name!=="string" ||
        typeof row.option_value!=="string" ||
        !row.option_name || row.option_name.includes("\u0000") ||
        utf8Bytes(row.option_name)>191 ||
        utf8Bytes(row.option_value)>MAX_AUTOLOAD_VALUE_BYTES) refuse();
    options.push({
      option_name:row.option_name,
      option_value:row.option_value
    });
  }
  return options;
}

/**
 * Reads at most ten pages (500 options) plus a non-empty overflow probe, twice.
 * Never treats a full final page as proof of completeness: an extra page is
 * required to distinguish exactly 500 entries from an overflow.
 */
export async function loadVerifiedWordPressAutoloadOptions(
  query: string,
  config: AutoloadOptionsConfig,
  dispatch: PrivateD1Query,
  requestPrefix = "autoload"
): Promise<AutoloadOptions> {
  if (typeof dispatch!=="function" || typeof requestPrefix!=="string" ||
      !/^[A-Za-z0-9_-]{1,40}$/.test(requestPrefix)) refuse();
  // Parse the canonical SQL before invoking even one private D1 query.
  translateWordPressAutoloadOptions(query, requestPrefix+"_preflight", config);

  let original: Option[] | undefined;
  for (let pass=0; pass<2; pass++) {
    const rows: Option[]=[];
    let previousName: string|undefined;
    let totalBytes=0;
    let completed=false;
    for (let page=0; page<=MAX_AUTOLOAD_PAGES; page++) {
      const id=requestPrefix+"_v"+pass+"_p"+page;
      const wire=JSON.stringify(translateWordPressAutoloadOptions(query,id,config,page));
      let raw:string;
      try { raw=await dispatch(wire); } catch { return refuse(); }
      const pageRows=readRows(raw,id);
      // Page MAX_AUTOLOAD_PAGES is a bounded overflow probe only.
      if (page===MAX_AUTOLOAD_PAGES) {
        if (pageRows.length!==0) refuse();
        completed=true;
        break;
      }
      for (const row of pageRows) {
        if (previousName!==undefined &&
            !lessThanUtf8(previousName,row.option_name)) refuse();
        previousName=row.option_name;
        totalBytes+=utf8Bytes(row.option_name)+utf8Bytes(row.option_value);
        if (totalBytes>MAX_AUTOLOAD_TOTAL_BYTES ||
            rows.length>=MAX_AUTOLOAD_OPTIONS) refuse();
        rows.push(row);
      }
      if (pageRows.length<MAX_ROWS) {
        completed=true;
        break;
      }
    }
    if (!completed) refuse();
    if (!original) original=rows;
    else {
      if (rows.length!==original.length) refuse();
      for (let index=0; index<rows.length; index++) {
        if (rows[index].option_name!==original[index].option_name ||
            rows[index].option_value!==original[index].option_value) refuse();
      }
    }
  }
  const options=Object.create(null) as Record<string,string>;
  for (const row of original??[]) options[row.option_name]=row.option_value;
  return Object.freeze(options);
}
