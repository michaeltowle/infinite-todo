// Worker-side ambient declarations. Kept out of shared-types.d.ts because these
// lean on @cloudflare/workers-types globals, which the client project (DOM lib,
// no Workers types) deliberately does not load.

// Worker bindings, as declared in wrangler.toml. TREE is the TodoTree Durable
// Object namespace; there is exactly one instance of it, named `root`.
interface Env {
  TREE: DurableObjectNamespace;
}

// wrangler's Text rule (wrangler.toml) makes this import resolve to the file's
// contents as a string. Without the declaration TS can't type the import.
declare module "*.svg" {
  const content: string;
  export default content;
}
