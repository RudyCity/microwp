declare module "*.wasm" { const instance: WebAssembly.Module; export default instance; }
declare module "*.bin" { const bytes: ArrayBuffer; export default bytes; }
declare module "../../experiments/generated/php-loader.js" {
  export function init(runtime: string, loader: Record<string, unknown>): any;
  export const phpWasmAsyncMode: string | undefined;
}
