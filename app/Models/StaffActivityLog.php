<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * The business owner's record of staff account and permission events
 * (Staff Management Stage 1). Append-only: never updated or deleted by the
 * application. Never holds a password or token.
 */
class StaffActivityLog extends Model
{
    public const UPDATED_AT = null;

    protected $fillable = ['business_id', 'staff_id', 'actor_id', 'actor_type', 'action', 'description', 'properties', 'ip_address'];

    protected function casts(): array
    {
        return [
            'properties' => 'array',
            'created_at' => 'datetime',
        ];
    }

    protected static function booted(): void
    {
        static::updating(fn () => throw new \LogicException('Staff activity records are never changed.'));
        static::deleting(fn () => throw new \LogicException('Staff activity records are never deleted.'));
    }

    /**
     * Record an event. The actor is the signed-in user (owner or staff) unless
     * given; with no user it is recorded as the system.
     */
    public static function record(Staff $staff, string $action, string $description, array $properties = [], ?User $actor = null): self
    {
        $actor ??= auth()->user();

        return self::create([
            'business_id' => $staff->business_id,
            'staff_id' => $staff->id,
            'actor_id' => $actor?->id,
            'actor_type' => match (true) {
                $actor === null => 'system',
                $actor->role === 'staff' => 'staff',
                default => 'owner',
            },
            'action' => $action,
            'description' => $description,
            'properties' => $properties ?: null,
            'ip_address' => request()?->ip(),
        ]);
    }

    public function staff(): BelongsTo
    {
        return $this->belongsTo(Staff::class)->withTrashed();
    }

    public function actor(): BelongsTo
    {
        return $this->belongsTo(User::class, 'actor_id');
    }
}
