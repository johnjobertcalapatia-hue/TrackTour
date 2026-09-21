<?php

namespace App\Notifications;

use Illuminate\Auth\Notifications\ResetPassword as ResetPasswordNotification;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Messages\MailMessage;

class ResetPassword extends ResetPasswordNotification implements ShouldQueue
{
    use Queueable;

    public function toMail($notifiable): MailMessage
    {
        $url = url(route('password.reset', [
            'token' => $this->token,
            'email' => $notifiable->getEmailForPasswordReset(),
        ], false));

        $appName = config('app.name');

        return (new MailMessage)
            ->subject('Reset Your Password - TrackTour')
            ->greeting('Hello!')
            ->line('We received a request to reset the password for your **TrackTour** account.')
            ->line('Click the button below to choose a new password:')
            ->action('Reset Password', $url)
            ->line('**Security Notice:**')
            ->line('• This password reset link will expire in '.config('auth.passwords.users.expire').' minutes.')
            ->line('• If you did not request this reset, you can safely ignore this email — your account remains secure.')
            ->line('• For security reasons, never share this link with anyone.')
            ->line('---')
            ->line('Having trouble clicking the button? Copy and paste the URL below into your browser:')
            ->line($url)
            ->salutation('Best regards,<br>The TrackTour Team');
    }
}
