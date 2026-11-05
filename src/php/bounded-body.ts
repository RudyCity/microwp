/**
 * Read a request body with an actual byte budget, regardless of missing,
 * falsified, or chunked Content-Length. Never buffer unbounded body input.
 */
export const MAX_PHP_REQUEST_BODY_BYTES=1024*1024;

export async function readBoundedRequestBody(request:Request,maxBytes=MAX_PHP_REQUEST_BODY_BYTES):Promise<Uint8Array|null>{
 if(!Number.isSafeInteger(maxBytes)||maxBytes<0||maxBytes>MAX_PHP_REQUEST_BODY_BYTES)throw new Error("Invalid body byte budget");
 const length=request.headers.get("content-length");
 if(length!==null){
   if(!/^(?:0|[1-9][0-9]*)$/.test(length)||!Number.isSafeInteger(Number(length))||Number(length)>maxBytes)return null;
 }
 if(request.method==="GET"||request.method==="HEAD"||!request.body)return new Uint8Array();
 const reader=request.body.getReader();
 let consumed=0;
 const chunks:Uint8Array[]=[];
 try{
   for(;;){
     const {done,value}=await reader.read();
     if(done)break;
     if(!(value instanceof Uint8Array))throw new TypeError("Invalid request body chunk");
     if(value.byteLength>maxBytes-consumed){
       await reader.cancel("Request body exceeded byte limit").catch(()=>{});
       return null;
     }
     consumed+=value.byteLength;
     chunks.push(value);
   }
 }finally{
   try{reader.releaseLock()}catch{}
 }
 const body=new Uint8Array(consumed);
 let offset=0;
 for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.byteLength;}
 return body;
}
