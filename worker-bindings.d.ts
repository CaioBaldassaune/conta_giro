// Logical platform bindings. Runtime resources are provisioned by Sites.
interface Fetcher { fetch(input:Request|string,init?:RequestInit):Promise<Response>; }
interface D1Database { prepare(sql:string):any; batch(statements:any[]):Promise<any[]>; exec(sql:string):Promise<any>; }
declare module "cloudflare:workers" { export const env:{DB:D1Database;DOCUMENTS:any}; }
