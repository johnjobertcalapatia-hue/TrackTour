<?php

namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

/**
 * Staff Management Stage 1: invites a new staff member to activate their
 * TrackTour account. Carries only the single-use activation link; never a
 * password.
 */
class StaffInvitationMail extends Mailable
{
    use Queueable, SerializesModels;

    public function __construct(
        public string $name,
        public string $businessName,
        public string $roleName,
        public string $activationUrl,
        public string $expiresAt,
    ) {}

    public function envelope(): Envelope
    {
        return new Envelope(
            subject: "You're invited to join {$this->businessName} on TrackTour",
        );
    }

    public function content(): Content
    {
        return new Content(
            htmlString: view('emails.staff-invitation', [
                'name' => $this->name,
                'businessName' => $this->businessName,
                'roleName' => $this->roleName,
                'activationUrl' => $this->activationUrl,
                'expiresAt' => $this->expiresAt,
            ])->render(),
        );
    }
}
