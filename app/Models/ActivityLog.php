<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ActivityLog extends Model
{
    const UPDATED_AT = null;

    const TYPE_ADMIN = 'admin';
    const TYPE_SECURITY = 'security';
    const TYPE_SETTINGS = 'settings';
    const TYPE_FINANCIAL = 'financial';

    protected $fillable = [
        'user_id',
        'action',
        'type',
        'description',
        'model_type',
        'model_id',
        'ip_address',
        'user_agent',
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * Canonical audit-trail writer (Admin Phase 1).
     *
     * Every admin governance action (approval, rejection, suspension, payout
     * decisions, settings changes) records exactly one row through this
     * method so the audit explorer can filter by type/action and resolve the
     * affected subject.
     */
    public static function record(
        string $action,
        ?string $description = null,
        ?Model $subject = null,
        string $type = self::TYPE_ADMIN
    ): self {
        $request = request();

        return self::create([
            'user_id' => auth()->id(),
            'action' => $action,
            'type' => $type,
            'description' => $description,
            'model_type' => $subject !== null ? $subject::class : null,
            'model_id' => $subject?->getKey(),
            'ip_address' => $request?->ip(),
            'user_agent' => $request?->userAgent(),
        ]);
    }
}
