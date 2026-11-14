import { handler } from "./handler.js";

Deno.serve((req: Request) =>
  handler(req, {
    url: Deno.env.get("SUPABASE_URL")!,
    key: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    resendKey: Deno.env.get("RESEND_API_KEY") ?? "",
    emailKey: Deno.env.get("EMAIL_KEY") ?? "",
    mailFrom: Deno.env.get("MAIL_FROM") ?? "",
    siteUrl: Deno.env.get("SITE_URL") ?? "",
  }),
);
