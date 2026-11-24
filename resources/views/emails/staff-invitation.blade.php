<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light">
  <title>Activate your staff account</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f7fa;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f7fa;">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
          <tr>
            <td align="center" style="padding-bottom:24px;">
              <p style="margin:0;font-size:20px;font-weight:700;color:#111827;">TrackTour</p>
            </td>
          </tr>
          <tr>
            <td style="background-color:#ffffff;border-radius:16px;padding:32px;border:1px solid #e5e7eb;">
              <p style="margin:0 0 16px;font-size:16px;color:#111827;">Hi {{ $name }},</p>
              <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#374151;">
                <strong>{{ $businessName }}</strong> has added you to their team on TrackTour as
                <strong>{{ $roleName }}</strong>.
              </p>
              <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#374151;">
                Activate your account and choose your own password:
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 24px;">
                <tr>
                  <td style="background-color:#059669;border-radius:10px;">
                    <a href="{{ $activationUrl }}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">Activate my account</a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:#6b7280;">
                This link works once and expires on {{ $expiresAt }}. If it has expired, ask {{ $businessName }} to send a new invitation.
              </p>
              <p style="margin:0;font-size:13px;line-height:1.6;color:#6b7280;">
                If you were not expecting this, you can ignore this email — no account will be activated.
              </p>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding-top:20px;">
              <p style="margin:0;font-size:12px;color:#9ca3af;">TrackTour · Bansud Tourism</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
