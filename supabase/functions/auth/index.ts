import { handler } from "./handler.js";

Deno.serve((req: Request) =>
  handler(req, { url: Deno.env.get("SUPABASE_URL")!, key: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")! }),
);
