<?php

namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

class ResetPasswordMail extends Mailable
{
    use Queueable, SerializesModels;

    public function __construct(
        public string $name,
        public string $resetUrl,
    ) {}

    public function envelope(): Envelope
    {
        return new Envelope(
            subject: 'Reset Your Password — TrackTour',
        );
    }

    public function content(): Content
    {
        return new Content(
            htmlString: view('emails.reset-password', [
                'name' => $this->name,
                'resetUrl' => $this->resetUrl,
            ])->render(),
        );
    }
}
