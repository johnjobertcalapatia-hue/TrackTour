<?php

namespace App\Notifications;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Notification;

class RiderAccountStatusChanged extends Notification implements ShouldQueue
{
    use Queueable;

    public string $status;

    public ?string $remarks;

    public function __construct(string $status, ?string $remarks = null)
    {
        $this->status = $status;
        $this->remarks = $remarks;
    }

    public function via(object $notifiable): array
    {
        return ['database'];
    }

    public function toArray(object $notifiable): array
    {
        $messages = [
            'approved' => 'Your rider application has been approved! You can now start accepting deliveries.',
            'rejected' => 'Your rider application has been rejected.',
            'suspended' => 'Your rider account has been suspended.',
            'reactivated' => 'Your rider account has been reactivated.',
        ];

        return [
            'title' => 'Rider Account '.ucfirst($this->status),
            'message' => ($messages[$this->status] ?? 'Your rider account status has been updated.').($this->remarks ? ' Reason: '.$this->remarks : ''),
            'icon' => 'rider',
            'type' => $this->status === 'approved' || $this->status === 'reactivated' ? 'success' : 'warning',
        ];
    }
}
