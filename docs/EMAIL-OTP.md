# Email OTP verification

TrackTour uses Laravel to generate and validate email verification codes. The
code is six digits, stored as a password hash in the configured cache, expires
after 10 minutes, can be resent once per minute, and is invalidated after five
failed attempts (15-minute lockout). Codes are single-use and are never
returned by the API or written to application logs.

Email delivery uses Laravel's existing mail transport. To send through
`johnjobertcalapatia@gmail.com`, configure the Laravel environment locally or
in the deployment secret store:

```dotenv
MAIL_MAILER=smtp
MAIL_SCHEME=null
MAIL_HOST=smtp.gmail.com
MAIL_PORT=587
MAIL_ENCRYPTION=tls
MAIL_USERNAME=johnjobertcalapatia@gmail.com
MAIL_PASSWORD=your_google_app_password
MAIL_FROM_ADDRESS=johnjobertcalapatia@gmail.com
MAIL_FROM_NAME="TrackTour"
```

Create a Google App Password from the Google Account security settings after
enabling 2-Step Verification. Do not use the account's normal password, commit
the App Password, or send it in chat. Restart Laravel workers and clear cached
configuration after changing deployment variables. `MAIL_MAILER=log` remains
the default for local development; it records messages in Laravel's log rather
than sending them.

OTP verification and Google Sign-In are separate features. This implementation
does not add Google Sign-In or change the existing email/password login.
