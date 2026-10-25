import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "npm:resend@2.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Best-effort transactional email for the SALCI Support workflow.
 *
 * The in-app notification is written inside the RPC transaction and is the
 * durable channel. This function is the courtesy copy, so every failure path
 * returns a 200 with `sent: false` rather than an error the caller must
 * handle, EXCEPT for genuine misconfiguration or an unauthorised caller.
 *
 * Trust model: the client hands us a `notify` payload, but we never trust it
 * for (a) who receives the mail or (b) where the link points.
 *  - The recipient address is resolved server-side from `profiles`.
 *  - The deep-link origin is checked against the SUPPORT_APP_ORIGINS allowlist
 *    (the portal runs on two production frontends against one Supabase
 *    project, so the domain cannot be hardcoded and a client-supplied origin
 *    must never be echoed into a link).
 *  - The caller must pass `can_access_support_ticket` for this ticket under
 *    their own JWT, so a random authenticated user cannot use this as a
 *    mailer.
 *
 * An internal SALCI note never reaches here: `post_support_message` builds the
 * notify payload inside its NOT-internal branch and returns NULL otherwise, and
 * the client helper is a no-op on a null payload.
 *
 * Sender is team@salci.in. That domain is verified with Resend; support@salci.in
 * is not, and sending from it is rejected at the provider.
 */

type NotifyKind = "support_reply" | "support_status_changed" | "support_reopened";

interface SupportNotify {
  to_user_id: string;
  to_email: string | null;
  to_name: string | null;
  kind: NotifyKind;
  ticket_id: string;
  subject: string;
  preview: string;
}

interface RequestBody {
  notify?: SupportNotify;
  origin?: string;
}

const KIND_COPY: Record<NotifyKind, { subject: (s: string) => string; heading: string; lead: string }> = {
  support_reply: {
    subject: (s) => `New reply on your support request: ${s}`,
    heading: "New reply on your support request",
    lead: "There is a new message on this support request.",
  },
  support_status_changed: {
    subject: (s) => `Status update on your support request: ${s}`,
    heading: "Status update",
    lead: "The status of this support request has changed.",
  },
  support_reopened: {
    subject: (s) => `Support request reopened: ${s}`,
    heading: "Support request reopened",
    lead: "This support request has been reopened and needs another look.",
  },
};

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const clip = (value: string, max: number): string =>
  value.length > max ? `${value.slice(0, max).trimEnd()}...` : value;

/** Allowlisted origin, or the first allowlisted origin on a miss. */
const resolveOrigin = (candidate: string | undefined, allowlist: string[]): string => {
  const cleaned = (candidate ?? "").trim().replace(/\/+$/, "");
  return allowlist.includes(cleaned) ? cleaned : allowlist[0];
};

const buildEmailHtml = (opts: {
  heading: string;
  lead: string;
  recipientName: string | null;
  ticketSubject: string;
  preview: string;
  ctaUrl: string;
}): string => {
  const greeting = opts.recipientName ? `Hi ${escapeHtml(opts.recipientName)},` : "Hi,";
  const preview = escapeHtml(clip(opts.preview ?? "", 400)).replace(/\n/g, "<br />");

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f4f7fa;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f4f7fa; padding: 40px 20px;">
        <tr>
          <td align="center">
            <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="background-color: #ffffff; border-radius: 16px; box-shadow: 0 4px 24px rgba(0, 0, 0, 0.08); overflow: hidden;">
              <tr>
                <td style="background: linear-gradient(135deg, #249ca2 0%, #1c7a7e 100%); padding: 32px 40px; text-align: center;">
                  <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 700; letter-spacing: -0.3px;">${escapeHtml(opts.heading)}</h1>
                  <p style="margin: 10px 0 0; color: rgba(255,255,255,0.9); font-size: 14px;">SALCI Support</p>
                </td>
              </tr>
              <tr>
                <td style="padding: 32px 40px;">
                  <p style="margin: 0 0 20px; font-size: 16px; color: #1f2937; line-height: 1.6;">${greeting}</p>
                  <p style="margin: 0 0 20px; font-size: 15px; color: #4b5563; line-height: 1.7;">${escapeHtml(opts.lead)}</p>

                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background: #f9fafb; border-radius: 12px; border-left: 4px solid #249ca2; margin: 0 0 24px;">
                    <tr>
                      <td style="padding: 20px 24px;">
                        <p style="margin: 0 0 8px; color: #6b7280; font-size: 12px; text-transform: uppercase; letter-spacing: 0.6px;">Request</p>
                        <p style="margin: 0 0 16px; color: #1f2937; font-size: 15px; font-weight: 600;">${escapeHtml(opts.ticketSubject)}</p>
                        <p style="margin: 0 0 8px; color: #6b7280; font-size: 12px; text-transform: uppercase; letter-spacing: 0.6px;">Latest update</p>
                        <p style="margin: 0; color: #4b5563; font-size: 14px; line-height: 1.7;">${preview}</p>
                      </td>
                    </tr>
                  </table>

                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin: 0 0 8px;">
                    <tr>
                      <td align="center">
                        <a href="${opts.ctaUrl}"
                           style="display: inline-block; background: linear-gradient(135deg, #249ca2 0%, #1c7a7e 100%); color: #ffffff; padding: 14px 36px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 15px; box-shadow: 0 4px 14px rgba(36, 156, 162, 0.3);">
                          Open the conversation
                        </a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td style="background: #f9fafb; padding: 20px 40px; border-top: 1px solid #e5e7eb;">
                  <p style="margin: 0 0 6px; color: #6b7280; font-size: 13px; text-align: center;">
                    Replies to this address are not monitored. Please reply inside the portal so your message reaches the team.
                  </p>
                  <p style="margin: 0; color: #9ca3af; font-size: 12px; text-align: center;">
                    &copy; ${new Date().getFullYear()} SALCI. All rights reserved.
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;
};

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const json = (status: number, payload: Record<string, unknown>) =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const originsRaw = Deno.env.get("SUPPORT_APP_ORIGINS") ?? "";

    const allowlist = originsRaw
      .split(",")
      .map((o) => o.trim().replace(/\/+$/, ""))
      .filter((o) => o.length > 0);

    if (!supabaseUrl || !serviceKey || !anonKey) {
      console.error("support-notify-email: missing Supabase env");
      return json(500, { error: "Notification service is not configured." });
    }
    if (allowlist.length === 0) {
      console.error("support-notify-email: SUPPORT_APP_ORIGINS is empty");
      return json(500, { error: "Notification service is not configured." });
    }
    // The module-scope `new Resend(...)` above consumes this, so a missing key
    // otherwise surfaced as a 500 thrown from inside resend.emails.send rather
    // than as a clean "not configured" beside its peers.
    if (!Deno.env.get("RESEND_API_KEY")) {
      console.error("support-notify-email: RESEND_API_KEY is not set");
      return json(500, { error: "Notification service is not configured." });
    }

    const body = (await req.json()) as RequestBody;
    const notify = body.notify;

    if (!notify || !notify.ticket_id || !notify.to_user_id || !notify.kind) {
      return json(400, { error: "Missing notify payload." });
    }
    // Own-property check, not a bare index: `kind: "constructor"` resolves
    // through the prototype to a truthy Object, skips the guard below, and
    // kills the handler on copy.subject(...) with a 500 carrying raw JS text.
    if (!Object.prototype.hasOwnProperty.call(KIND_COPY, notify.kind)) {
      return json(400, { error: "Unknown notification kind." });
    }
    const copy = KIND_COPY[notify.kind];

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return json(401, { error: "Not signed in." });
    }

    // Authority check under the CALLER's JWT: only a participant on this
    // ticket may trigger mail about it.
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: allowed, error: authErr } = await userClient.rpc("can_access_support_ticket", {
      p_ticket: notify.ticket_id,
    });
    if (authErr) {
      console.error("support-notify-email: authority check failed", authErr.message);
      return json(403, { error: "You do not have access to this support request." });
    }
    if (allowed !== true) {
      return json(403, { error: "You do not have access to this support request." });
    }

    const admin = createClient(supabaseUrl, serviceKey);

    // The ticket is fetched BEFORE the recipient, because reporter_id is what
    // authorises the recipient below. It also decides the deep-link target,
    // resolved from the ticket rather than from the client.
    const { data: ticket, error: ticketErr } = await admin
      .from("reported_issues")
      .select("id, subject, reporter_id")
      .eq("id", notify.ticket_id)
      .maybeSingle();

    if (ticketErr || !ticket) {
      console.error("support-notify-email: ticket lookup failed", ticketErr?.message ?? "not found");
      return json(200, { sent: false, reason: "ticket_lookup_failed" });
    }

    // AUTHORISE THE RECIPIENT, not only the ticket.
    //
    // can_access_support_ticket() above proves the CALLER may touch this
    // ticket. It proves nothing about who the mail is addressed to, and
    // `to_user_id` is read straight from the request body into a service-role
    // profiles lookup that bypasses RLS.
    //
    // Without this check the function was an authenticated open mailer: any
    // signed-in user who had ever raised one ticket could POST their own
    // ticket_id together with any other profile uuid and arbitrary `preview`
    // text, and SALCI would deliver it from the verified sender
    // "SALCI Support <team@salci.in>". A school admin can enumerate profile
    // ids across their institution, and nothing here is throttled (the 30/hour
    // limit lives in post_support_message, which this path never touches).
    //
    // A support conversation has exactly two sides, so the only legitimate
    // recipients are the ticket's reporter and SALCI.
    const isReporter = ticket.reporter_id === notify.to_user_id;
    if (!isReporter) {
      const { data: recipientIsSalci, error: salciErr } = await admin.rpc("is_super_admin", {
        user_id: notify.to_user_id,
      });
      if (salciErr || recipientIsSalci !== true) {
        console.warn(
          `support-notify-email: refused recipient ${notify.to_user_id} on ticket ${notify.ticket_id}`,
          salciErr?.message ?? "",
        );
        return json(403, { error: "That recipient is not part of this support request." });
      }
    }

    // Recipient address comes from the database, never from the request body.
    const { data: recipient, error: recipientErr } = await admin
      .from("profiles")
      .select("id, email, full_name")
      .eq("id", notify.to_user_id)
      .maybeSingle();

    if (recipientErr) {
      console.error("support-notify-email: recipient lookup failed", recipientErr.message);
      return json(200, { sent: false, reason: "recipient_lookup_failed" });
    }
    if (!recipient?.email) {
      console.log("support-notify-email: recipient has no email, skipping", notify.to_user_id);
      return json(200, { sent: false, reason: "no_recipient_email" });
    }

    const origin = resolveOrigin(body.origin, allowlist);
    const path = isReporter ? "/support" : "/admin/issues";
    const ctaUrl = `${origin}${path}?ticket=${encodeURIComponent(notify.ticket_id)}`;

    const ticketSubject = ticket.subject ?? notify.subject ?? "Support request";

    const emailResponse = await resend.emails.send({
      from: "SALCI Support <team@salci.in>",
      to: [recipient.email],
      subject: clip(copy.subject(ticketSubject), 160),
      html: buildEmailHtml({
        heading: copy.heading,
        lead: copy.lead,
        recipientName: recipient.full_name ?? notify.to_name ?? null,
        ticketSubject,
        preview: notify.preview ?? "",
        ctaUrl,
      }),
    });

    if (emailResponse.error) {
      console.error("support-notify-email: resend rejected", emailResponse.error);
      return json(200, { sent: false, reason: "provider_rejected" });
    }

    console.log(`support-notify-email: sent ${notify.kind} for ticket ${notify.ticket_id}`);
    return json(200, { sent: true, email_id: emailResponse.data?.id ?? "sent" });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error occurred";
    console.error("support-notify-email: unhandled error", message);
    return json(500, { error: message });
  }
});
