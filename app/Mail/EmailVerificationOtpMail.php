<?php

namespace App\Mail;

use App\Services\EmailVerificationOtpService;
use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

class EmailVerificationOtpMail extends Mailable
{
    use Queueable, SerializesModels;

    public function __construct(public string $otp) {}

    public function envelope(): Envelope
    {
        return new Envelope(
            subject: 'Your TrackTour email verification code',
        );
    }

    public function content(): Content
    {
        return new Content(
            htmlString: view('emails.email-verification-otp', [
                'otp' => $this->otp,
                'ttlMinutes' => EmailVerificationOtpService::TTL_MINUTES,
            ])->render(),
        );
    }
}
