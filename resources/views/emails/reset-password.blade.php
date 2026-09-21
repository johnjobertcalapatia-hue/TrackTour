<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>Reset Your Password</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
</head>
<body style="margin:0;padding:0;background-color:#f4f7fa;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f7fa;">
    <tr>
      <td align="center" style="padding:40px 16px;">
        {{-- Main Container --}}
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
          {{-- Logo / Header --}}
          <tr>
            <td align="center" style="padding-bottom:32px;">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background:linear-gradient(135deg,#059669,#0d9488);border-radius:12px;padding:10px 14px;">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/></svg>
                  </td>
                </tr>
              </table>
              <p style="margin:12px 0 0;font-size:20px;font-weight:700;color:#111827;letter-spacing:-0.3px;">TrackTour</p>
            </td>
          </tr>

          {{-- Email Card --}}
          <tr>
            <td>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08),0 4px 12px rgba(0,0,0,0.04);">
                {{-- Green Accent Bar --}}
                <tr>
                  <td style="height:4px;background:linear-gradient(90deg,#059669,#0d9488);"></td>
                </tr>

                {{-- Content --}}
                <tr>
                  <td style="padding:48px 40px 40px;">
                    {{-- Greeting --}}
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding-bottom:24px;">
                          <h1 style="margin:0;font-size:22px;font-weight:700;color:#111827;line-height:1.3;">Password Reset Request</h1>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding-bottom:16px;">
                          <p style="margin:0;font-size:15px;color:#4b5563;line-height:1.7;">
                            Hello <strong style="color:#111827;">{{ $name }}</strong>,
                          </p>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding-bottom:24px;">
                          <p style="margin:0;font-size:15px;color:#4b5563;line-height:1.7;">
                            We received a request to reset the password for your TrackTour account. Click the button below to create a new password.
                          </p>
                        </td>
                      </tr>

                      {{-- CTA Button --}}
                      <tr>
                        <td style="padding-bottom:24px;" align="center">
                          <table role="presentation" cellpadding="0" cellspacing="0">
                            <tr>
                              <td style="background:linear-gradient(135deg,#059669,#0d9488);border-radius:10px;">
                                <a href="{{ $resetUrl }}" target="_blank" style="display:inline-block;padding:14px 36px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;letter-spacing:0.2px;">
                                  Reset My Password
                                </a>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>

                      {{-- Divider --}}
                      <tr>
                        <td style="padding-bottom:24px;">
                          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                            <tr>
                              <td style="border-top:1px solid #e5e7eb;"></td>
                            </tr>
                          </table>
                        </td>
                      </tr>

                      {{-- Security Notice --}}
                      <tr>
                        <td style="padding-bottom:8px;">
                          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#fefce8;border:1px solid #fde68a;border-radius:10px;">
                            <tr>
                              <td style="padding:16px 20px;">
                                <p style="margin:0;font-size:13px;color:#92400e;line-height:1.6;">
                                  <strong style="color:#78350f;">⏱ This link expires in 60 minutes.</strong><br>
                                  For security, this password reset link will automatically expire after one hour. If you did not request this change, please ignore this email — your password will remain unchanged.
                                </p>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          {{-- Footer --}}
          <tr>
            <td style="padding:32px 16px 0;" align="center">
              <p style="margin:0 0 8px;font-size:12px;color:#9ca3af;line-height:1.6;">
                TrackTour — Tourism Management System for Bansud, Oriental Mindoro
              </p>
              <p style="margin:0;font-size:11px;color:#d1d5db;line-height:1.6;">
                &copy; {{ date('Y') }} TrackTour. All rights reserved.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
