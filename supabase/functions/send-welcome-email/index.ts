import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "npm:resend@2.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface UserCredentials {
  email: string;
  name: string;
  password: string;
  role: string;
  institutionName?: string;
}

interface SendWelcomeEmailRequest {
  users: UserCredentials[];
}

const getRoleDisplayName = (role: string): string => {
  const roleMap: Record<string, string> = {
    school_admin: "School Administrator",
    coordinator: "Coordinator",
    teacher: "Teacher",
    student: "Student",
    employee: "Employee",
  };
  return roleMap[role] || role.charAt(0).toUpperCase() + role.slice(1);
};

const generateEmailHtml = (user: UserCredentials): string => {
  const loginUrl = "https://app.salci.ai/login";
  const roleDisplay = getRoleDisplayName(user.role);
  
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
              <!-- Header -->
              <tr>
                <td style="background: linear-gradient(135deg, #249ca2 0%, #1c7a7e 100%); padding: 40px 40px 30px; text-align: center;">
                  <h1 style="margin: 0; color: #ffffff; font-size: 32px; font-weight: 700; letter-spacing: -0.5px;">Welcome to SALCI!</h1>
                  <p style="margin: 12px 0 0; color: rgba(255,255,255,0.9); font-size: 16px;">Smart Assessment & Learning Companion for Institutions</p>
                </td>
              </tr>
              
              <!-- Body -->
              <tr>
                <td style="padding: 40px;">
                  <p style="margin: 0 0 24px; font-size: 18px; color: #1f2937; line-height: 1.6;">
                    Dear <strong>${user.name}</strong>,
                  </p>
                  
                  <p style="margin: 0 0 24px; font-size: 16px; color: #4b5563; line-height: 1.7;">
                    Your account has been created successfully${user.institutionName ? ` for <strong>${user.institutionName}</strong>` : ''}. 
                    You can now access the SALCI platform using the credentials below.
                  </p>
                  
                  <!-- Credentials Box -->
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background: linear-gradient(135deg, #ecfeff 0%, #cffafe 100%); border-radius: 12px; border-left: 4px solid #249ca2; margin: 24px 0;">
                    <tr>
                      <td style="padding: 24px;">
                        <h3 style="margin: 0 0 16px; color: #0f5e62; font-size: 16px; font-weight: 600;">Your Login Credentials</h3>
                        <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                          <tr>
                            <td style="padding: 8px 0; color: #6b7280; font-size: 14px; width: 100px;">Role:</td>
                            <td style="padding: 8px 0; font-weight: 600; color: #1f2937; font-size: 14px;">
                              <span style="background: #cffafe; color: #0f5e62; padding: 4px 12px; border-radius: 20px; font-size: 13px;">${roleDisplay}</span>
                            </td>
                          </tr>
                          <tr>
                            <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Email:</td>
                            <td style="padding: 8px 0; font-weight: 600; color: #1f2937; font-size: 14px;">${user.email}</td>
                          </tr>
                          <tr>
                            <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Password:</td>
                            <td style="padding: 8px 0;">
                              <code style="font-family: 'Courier New', monospace; background: #ffffff; padding: 6px 12px; border-radius: 6px; border: 1px solid #e5e7eb; font-size: 14px; font-weight: 600; color: #1f2937; letter-spacing: 1px;">${user.password}</code>
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                  </table>
                  
                  <!-- Security Warning -->
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background: #fefce8; border-radius: 8px; border: 1px solid #fef08a; margin: 24px 0;">
                    <tr>
                      <td style="padding: 16px;">
                        <p style="margin: 0; color: #854d0e; font-size: 14px;">
                          <strong>⚠️ Security Note:</strong> Please change your password after your first login for security purposes.
                        </p>
                      </td>
                    </tr>
                  </table>
                  
                  <!-- CTA Button -->
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin: 32px 0;">
                    <tr>
                      <td align="center">
                        <a href="${loginUrl}"
                           style="display: inline-block; background: linear-gradient(135deg, #249ca2 0%, #1c7a7e 100%); color: #ffffff; padding: 16px 40px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px; box-shadow: 0 4px 14px rgba(36, 156, 162, 0.3);">
                          Login to Your Account →
                        </a>
                      </td>
                    </tr>
                  </table>
                  
                  <!-- Getting Started -->
                  <h3 style="margin: 32px 0 16px; color: #1f2937; font-size: 16px; font-weight: 600;">Getting Started</h3>
                  <ol style="margin: 0; padding-left: 20px; color: #4b5563; font-size: 14px; line-height: 2;">
                    <li>Log in using the credentials above</li>
                    <li>Update your password for enhanced security</li>
                    <li>Complete your profile setup</li>
                    <li>Explore your dashboard and features</li>
                  </ol>
                </td>
              </tr>
              
              <!-- Footer -->
              <tr>
                <td style="background: #f9fafb; padding: 24px 40px; border-top: 1px solid #e5e7eb;">
                  <p style="margin: 0 0 8px; color: #6b7280; font-size: 13px; text-align: center;">
                    Need help getting started? Contact your administrator for assistance.
                  </p>
                  <p style="margin: 0; color: #9ca3af; font-size: 12px; text-align: center;">
                    © ${new Date().getFullYear()} SALCI. All rights reserved.
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

  try {
    const { users }: SendWelcomeEmailRequest = await req.json();

    if (!users || !Array.isArray(users) || users.length === 0) {
      throw new Error("Missing required field: users (array of user objects)");
    }

    console.log(`Sending welcome emails to ${users.length} user(s)`);

    const results: Array<{ email: string; success: boolean; error?: string; emailId?: string }> = [];

    for (const user of users) {
      // Validate required fields
      if (!user.email || !user.name || !user.password || !user.role) {
        results.push({
          email: user.email || "unknown",
          success: false,
          error: "Missing required fields: email, name, password, and role are required",
        });
        continue;
      }

      try {
        const emailResponse = await resend.emails.send({
          from: "SALCI Team <team@salci.in>",
          to: [user.email],
          subject: `Welcome to SALCI - Your Account is Ready`,
          html: generateEmailHtml(user),
        });

        console.log(`Welcome email sent to ${user.email}:`, emailResponse);

        results.push({
          email: user.email,
          success: true,
          emailId: emailResponse.data?.id || "sent",
        });
      } catch (emailError: unknown) {
        const errorMessage = emailError instanceof Error ? emailError.message : "Unknown email error";
        console.error(`Failed to send email to ${user.email}:`, errorMessage);
        results.push({
          email: user.email,
          success: false,
          error: errorMessage,
        });
      }
    }

    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;

    console.log(`Email send complete: ${successCount} succeeded, ${failCount} failed`);

    return new Response(
      JSON.stringify({
        success: failCount === 0,
        message: `Sent ${successCount}/${users.length} welcome emails`,
        results,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    console.error("Error in send-welcome-email function:", errorMessage);
    return new Response(
      JSON.stringify({
        success: false,
        error: errorMessage,
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
});
