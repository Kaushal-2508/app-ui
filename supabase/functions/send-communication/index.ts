import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function sendEmail(settings: any, recipient: string, subject: string, message: string) {
  if (settings.email_provider === "resend") {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${settings.email_api_key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: settings.email_from_address,
        to: [recipient],
        subject: subject || "Notification",
        html: message,
      }),
    });
    if (!res.ok) throw new Error(await res.text());
  } else {
    throw new Error(`Unsupported email provider: ${settings.email_provider}`);
  }
}

async function sendSMS(settings: any, recipient: string, message: string) {
  const provider = settings.sms_provider;

  if (provider === "twilio") {
    const accountSid = settings.sms_sender_id; // Twilio Account SID stored as sender_id
    const authToken = settings.sms_api_key;
    const fromNumber = settings.sms_sender_id;
    
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          "Authorization": "Basic " + btoa(`${accountSid}:${authToken}`),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          To: recipient,
          From: fromNumber,
          Body: message,
        }),
      }
    );
    if (!res.ok) throw new Error(await res.text());
  } else if (provider === "msg91") {
    const res = await fetch("https://control.msg91.com/api/v5/flow/", {
      method: "POST",
      headers: {
        "authkey": settings.sms_api_key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        flow_id: settings.sms_sender_id, // Flow ID stored as sender_id
        sender: settings.sms_sender_id,
        mobiles: recipient,
        message: message,
      }),
    });
    if (!res.ok) throw new Error(await res.text());
  } else if (provider === "textlocal") {
    const params = new URLSearchParams({
      apikey: settings.sms_api_key,
      numbers: recipient,
      message: message,
      sender: settings.sms_sender_id || "TXTLCL",
    });
    const res = await fetch("https://api.textlocal.in/send/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
    });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    if (data.status !== "success") throw new Error(JSON.stringify(data));
  } else {
    throw new Error(`Unsupported SMS provider: ${provider}`);
  }
}

async function sendWhatsApp(settings: any, recipient: string, message: string) {
  const provider = settings.whatsapp_provider;

  if (provider === "twilio") {
    // Twilio WhatsApp uses same API with whatsapp: prefix
    const accountSid = settings.whatsapp_api_key.split(":")[0] || settings.whatsapp_api_key;
    const authToken = settings.whatsapp_api_key.split(":")[1] || settings.whatsapp_api_key;
    const fromNumber = `whatsapp:${settings.whatsapp_phone_number}`;

    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          "Authorization": "Basic " + btoa(`${accountSid}:${authToken}`),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          To: `whatsapp:${recipient}`,
          From: fromNumber,
          Body: message,
        }),
      }
    );
    if (!res.ok) throw new Error(await res.text());
  } else if (provider === "wati") {
    const res = await fetch(
      `https://live-server-${settings.whatsapp_phone_number}.wati.io/api/v1/sendSessionMessage/${recipient}`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${settings.whatsapp_api_key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ messageText: message }),
      }
    );
    if (!res.ok) throw new Error(await res.text());
  } else if (provider === "gupshup") {
    const res = await fetch("https://api.gupshup.io/wa/api/v1/msg", {
      method: "POST",
      headers: {
        "apikey": settings.whatsapp_api_key,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        channel: "whatsapp",
        source: settings.whatsapp_phone_number,
        destination: recipient,
        "message": JSON.stringify({ type: "text", text: message }),
        "src.name": settings.whatsapp_phone_number,
      }),
    });
    if (!res.ok) throw new Error(await res.text());
  } else {
    throw new Error(`Unsupported WhatsApp provider: ${provider}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { institution_id, channel, recipients, subject, message } = await req.json();

    if (!institution_id || !channel || !recipients?.length || !message) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get institution communication settings
    const { data: settings, error: settingsError } = await supabase
      .from("institution_communication_settings")
      .select("*")
      .eq("institution_id", institution_id)
      .single();

    if (settingsError || !settings) {
      return new Response(JSON.stringify({ error: "Communication settings not configured" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result: any = { sent: 0, failed: 0, errors: [] };

    if (channel === "email" && settings.email_enabled) {
      for (const recipient of recipients) {
        try {
          await sendEmail(settings, recipient, subject, message);
          result.sent++;
        } catch (e) {
          result.failed++;
          result.errors.push(e.message);
        }
      }
    } else if (channel === "sms" && settings.sms_enabled) {
      for (const recipient of recipients) {
        try {
          await sendSMS(settings, recipient, message);
          result.sent++;
        } catch (e) {
          result.failed++;
          result.errors.push(e.message);
        }
      }
    } else if (channel === "whatsapp" && settings.whatsapp_enabled) {
      for (const recipient of recipients) {
        try {
          await sendWhatsApp(settings, recipient, message);
          result.sent++;
        } catch (e) {
          result.failed++;
          result.errors.push(e.message);
        }
      }
    } else {
      return new Response(JSON.stringify({ error: `Channel '${channel}' is not enabled` }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true, result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
