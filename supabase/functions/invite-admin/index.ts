import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "npm:resend@2.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface InviteAdminRequest {
  email: string;
  name: string;
  password: string;
  institutionName: string;
  institutionCode: string;
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { email, name, password, institutionName, institutionCode }: InviteAdminRequest = await req.json();

    // Validate required fields
    if (!email || !name || !password || !institutionName) {
      throw new Error("Missing required fields: email, name, password, and institutionName are required");
    }

    console.log(`Sending welcome email to ${email} for institution ${institutionName}`);

    const emailResponse = await resend.emails.send({
      from: "SALCI <onboarding@resend.dev>",
      to: [email],
      subject: `Welcome to SALCI - Your ${institutionName} Account is Ready`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #2563eb; margin: 0;">Welcome to SALCI!</h1>
            <p style="color: #6b7280; margin-top: 8px;">Smart Assessment & Learning Companion for Institutions</p>
          </div>
          
          <p style="font-size: 16px;">Dear <strong>${name}</strong>,</p>
          
          <p style="font-size: 16px; line-height: 1.6;">
            Congratulations! Your institution account for <strong>${institutionName}</strong> 
            ${institutionCode ? `(Code: <strong>${institutionCode}</strong>)` : ''} 
            has been successfully created.
          </p>
          
          <div style="background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%); padding: 24px; border-radius: 12px; margin: 24px 0; border-left: 4px solid #2563eb;">
            <h3 style="margin: 0 0 16px 0; color: #1e40af;">Your Login Credentials</h3>
            <table style="width: 100%;">
              <tr>
                <td style="padding: 8px 0; color: #6b7280; width: 100px;">Email:</td>
                <td style="padding: 8px 0; font-weight: 600; color: #1f2937;">${email}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #6b7280;">Password:</td>
                <td style="padding: 8px 0; font-weight: 600; color: #1f2937; font-family: monospace; background: #fff; padding: 4px 8px; border-radius: 4px;">${password}</td>
              </tr>
            </table>
          </div>
          
          <div style="background: #fefce8; padding: 16px; border-radius: 8px; margin: 20px 0; border: 1px solid #fef08a;">
            <p style="margin: 0; color: #854d0e; font-size: 14px;">
              <strong>⚠️ Security Note:</strong> Please change your password after your first login for security purposes.
            </p>
          </div>
          
          <h3 style="color: #1f2937; margin-top: 30px;">Getting Started</h3>
          <ol style="line-height: 1.8; color: #4b5563;">
            <li>Log in to your dashboard using the credentials above</li>
            <li>Update your password for enhanced security</li>
            <li>Configure your institution's classes and sections</li>
            <li>Add subjects and assign them to classes</li>
            <li>Invite teachers and enroll students</li>
            <li>Start creating exams and assessments!</li>
          </ol>
          
          <div style="text-align: center; margin: 32px 0;">
            <a href="https://salci-eco-core.lovable.app/login" 
               style="display: inline-block; background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%); color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px; box-shadow: 0 4px 14px rgba(37, 99, 235, 0.3);">
              Login to Your Dashboard →
            </a>
          </div>
          
          <hr style="margin: 32px 0; border: none; border-top: 1px solid #e5e7eb;" />
          
          <div style="text-align: center; color: #6b7280; font-size: 14px;">
            <p style="margin: 8px 0;">Need help getting started?</p>
            <p style="margin: 8px 0;">Contact our support team for assistance.</p>
            <p style="margin: 16px 0; color: #9ca3af; font-size: 12px;">
              © ${new Date().getFullYear()} SALCI. All rights reserved.
            </p>
          </div>
        </div>
      `,
    });

    console.log("Welcome email sent successfully:", emailResponse);

    return new Response(
      JSON.stringify({ 
        success: true, 
        emailId: emailResponse.data?.id || 'sent',
        message: `Welcome email sent to ${email}` 
      }), 
      {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    console.error("Error sending invite email:", errorMessage);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: errorMessage 
      }),
      { 
        status: 500, 
        headers: { "Content-Type": "application/json", ...corsHeaders } 
      }
    );
  }
});
