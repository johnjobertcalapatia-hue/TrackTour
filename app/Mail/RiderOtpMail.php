<?php

namespace App\Mail;

use App\Services\OtpService;
use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

class RiderOtpMail extends Mailable
{
    use Queueable, SerializesModels;

    public function __construct(
        public string $otp,
        public string $mobile,
    ) {}

    public function envelope(): Envelope
    {
        return new Envelope(
            subject: 'Your TrackTour rider registration code',
        );
    }

    public function content(): Content
    {
        return new Content(
            htmlString: view('emails.rider-otp', [
                'otp' => $this->otp,
                'mobile' => $this->mobile,
                'ttlMinutes' => OtpService::TTL_MINUTES,
            ])->render(),
        );
    }
}
