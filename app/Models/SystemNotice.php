<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A system maintenance notice sent by the admin (Bansud Tourism Office).
 * Audience decides which roles receive it; see AUDIENCE_ROLES.
 */
class SystemNotice extends Model
{
    public const AUDIENCE_ROLES = [
        'business_owners' => [User::ROLE_BUSINESS_OWNER, 'staff'],
        'riders' => [User::ROLE_RIDER],
        'tourists' => [User::ROLE_TOURIST],
        'everyone' => [User::ROLE_TOURIST, User::ROLE_BUSINESS_OWNER, 'staff', User::ROLE_RIDER, User::ROLE_TOURISM_OFFICE],
    ];

    public const AUDIENCE_LABELS = [
        'business_owners' => 'Business owners',
        'riders' => 'Riders',
        'tourists' => 'Tourists',
        'everyone' => 'Everyone',
    ];

    protected $fillable = [
        'title', 'message', 'audience', 'starts_at', 'ends_at',
        'recipients_count', 'created_by', 'cancelled_at', 'cancelled_by',
    ];

    protected function casts(): array
    {
        return [
            'starts_at' => 'datetime',
            'ends_at' => 'datetime',
            'cancelled_at' => 'datetime',
            'recipients_count' => 'integer',
        ];
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    /** Audiences that include this role. */
    public static function audiencesFor(string $role): array
    {
        return array_keys(array_filter(self::AUDIENCE_ROLES, fn ($roles) => in_array($role, $roles, true)));
    }

    /** Not cancelled and not over yet: shown as a banner until it ends. */
    public function scopeActive(Builder $query): Builder
    {
        return $query->whereNull('cancelled_at')->where('ends_at', '>', now());
    }

    public function status(): string
    {
        if ($this->cancelled_at) {
            return 'cancelled';
        }
        if ($this->ends_at->isPast()) {
            return 'ended';
        }

        return $this->starts_at->isPast() ? 'in_progress' : 'scheduled';
    }

    public function toSummary(): array
    {
        return [
            'id' => $this->id,
            'title' => $this->title,
            'message' => $this->message,
            'audience' => $this->audience,
            'audience_label' => self::AUDIENCE_LABELS[$this->audience] ?? $this->audience,
            'starts_at' => $this->starts_at?->toISOString(),
            'ends_at' => $this->ends_at?->toISOString(),
            'status' => $this->status(),
            'recipients_count' => $this->recipients_count,
            'cancelled_at' => $this->cancelled_at?->toISOString(),
            'created_at' => $this->created_at?->toISOString(),
        ];
    }
}
