import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import nodemailer from 'npm:nodemailer@6.9.7';
import { createEmailTemplate } from './email-template.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

interface EmailAttachment {
  filename: string;
  content_base64: string;
  content_type?: string;
}

interface EmailRequest {
  to: string;
  subject: string;
  body: string;
  body_type?: 'text' | 'html';
  use_template?: boolean;
  button_text?: string;
  button_link?: string;
  attachment_base64?: string;        // base64-encoded content (single, legacy)
  attachment_filename?: string;      // e.g. "invoice-TXN123.html"
  attachment_content_type?: string;  // e.g. "text/html" or "application/pdf" (default)
  attachments?: EmailAttachment[];  // multiple attachments
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const {
      to,
      subject,
      body,
      body_type = 'html',
      use_template = true,
      button_text,
      button_link,
      attachment_base64,
      attachment_filename,
      attachment_content_type = 'application/pdf',
      attachments,
    } = await req.json() as EmailRequest;

    if (!to || !subject || !body) {
      console.error('Missing required fields:', { to: !!to, subject: !!subject, body: !!body });
      return new Response(
        JSON.stringify({ error: 'Missing required fields: to, subject, body' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    console.log(`📧 Fetching email settings for recipient: ${to}`);

    const { data: settings, error: settingsError } = await supabase
      .from('email_settings')
      .select('*')
      .eq('is_active', true)
      .maybeSingle();

    if (settingsError) {
      console.error('❌ Error fetching email settings:', settingsError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch email settings', details: settingsError.message }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    if (!settings) {
      console.error('❌ No active email settings found in database');
      return new Response(
        JSON.stringify({ error: 'No active email settings configured. Please configure email settings in admin panel.' }),
        {
          status: 503,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    console.log(`📨 Email settings found:`, {
      smtp_server: settings.smtp_server,
      smtp_port: settings.smtp_port,
      use_tls: settings.use_tls,
      use_ssl: settings.use_ssl,
      from_email: settings.from_email,
    });

    let emailContent = body;

    if (use_template && body_type === 'html') {
      console.log('📝 Creating HTML email template');
      emailContent = createEmailTemplate({
        title: subject,
        content: body,
        buttonText: button_text,
        buttonLink: button_link,
        showFooter: true,
      });
    }

    console.log('🔧 Creating SMTP transport with nodemailer');

    const transportConfig: any = {
      host: settings.smtp_server,
      port: settings.smtp_port,
      secure: settings.use_ssl || false,
      auth: {
        user: settings.smtp_username,
        pass: settings.smtp_password,
      },
    };

    if (settings.use_tls && !settings.use_ssl) {
      transportConfig.requireTLS = true;
      transportConfig.tls = {
        rejectUnauthorized: false,
      };
    }

    console.log('📤 Transport config:', {
      host: transportConfig.host,
      port: transportConfig.port,
      secure: transportConfig.secure,
      requireTLS: transportConfig.requireTLS,
    });

    const transporter = nodemailer.createTransport(transportConfig);

    console.log('✅ Verifying SMTP connection...');

    try {
      await transporter.verify();
      console.log('✅ SMTP connection verified successfully');
    } catch (verifyError) {
      console.error('❌ SMTP verification failed:', verifyError);
      return new Response(
        JSON.stringify({
          error: 'SMTP connection verification failed',
          details: verifyError instanceof Error ? verifyError.message : 'Connection failed',
        }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const allAttachments: any[] = [];
    if (attachment_base64) {
      allAttachments.push({
        filename: attachment_filename || 'attachment',
        content: attachment_base64,
        encoding: 'base64',
        contentType: attachment_content_type || 'application/octet-stream',
      });
    }
    if (attachments && Array.isArray(attachments)) {
      for (const att of attachments) {
        if (att.content_base64) {
          allAttachments.push({
            filename: att.filename || 'attachment',
            content: att.content_base64,
            encoding: 'base64',
            contentType: att.content_type || 'application/octet-stream',
          });
        }
      }
    }

    const mailOptions: any = {
      from: `${settings.from_display_name} <${settings.from_email}>`,
      to: to,
      subject: subject,
      text: body_type === 'text' ? body : undefined,
      html: body_type === 'html' ? emailContent : undefined,
      ...(allAttachments.length > 0 ? { attachments: allAttachments } : {}),
    };

    console.log('📧 Sending email to:', to);

    try {
      const info = await transporter.sendMail(mailOptions);
      console.log('✅ Email sent successfully! Message ID:', info.messageId);
      console.log('📬 Response:', info.response);

      return new Response(
        JSON.stringify({
          success: true,
          message: 'Email sent successfully',
          to: to,
          messageId: info.messageId,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    } catch (smtpError) {
      console.error('❌ SMTP sending error:', smtpError);

      const errorMessage = smtpError instanceof Error ? smtpError.message : 'SMTP connection failed';
      console.error('Error details:', errorMessage);

      return new Response(
        JSON.stringify({
          error: 'Failed to send email',
          details: errorMessage,
        }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }
  } catch (error) {
    console.error('❌ Unexpected error:', error);

    const errorDetails = error instanceof Error ? {
      message: error.message,
      stack: error.stack,
      name: error.name,
    } : 'Unknown error';

    console.error('Full error details:', errorDetails);

    return new Response(
      JSON.stringify({
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});

// redeploy
