<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\MassPrunable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\MorphTo;

/**
 * One thing that went wrong in the system (see SystemIncidentRecorder).
 *
 * status: open      — needs fixing
 *         recorded  — history only (e.g. one wrong password); nothing to fix
 *         resolved  — fixed, with who / when / how
 *         dismissed — reviewed, no action needed
 */
class SystemIncident extends Model
{
    use MassPrunable;

    public const STATUS_OPEN = 'open';
    public const STATUS_RECORDED = 'recorded';
    public const STATUS_RESOLVED = 'resolved';
    public const STATUS_DISMISSED = 'dismissed';

    public const STATUSES = [self::STATUS_OPEN, self::STATUS_RECORDED, self::STATUS_RESOLVED, self::STATUS_DISMISSED];

    public const CATEGORIES = ['auth', 'access', 'upload', 'payment', 'refund', 'dispatch', 'jobs', 'server', 'diagnostics'];

    public const SEVERITIES = ['info', 'warning', 'error', 'critical'];

    /** History-only records are kept for this long; open/fixed problems are kept. */
    public const RECORDED_RETENTION_DAYS = 180;

    protected $fillable = [
        'category', 'code', 'severity', 'status', 'title', 'message', 'context', 'user_id', 'ip_address', 'method', 'path',
        'subject_type', 'subject_id', 'fingerprint', 'occurred_at', 'resolved_at', 'resolved_by', 'resolution',
    ];

    protected $casts = [
        'context' => 'array',
        'occurred_at' => 'datetime',
        'resolved_at' => 'datetime',
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function resolver(): BelongsTo
    {
        return $this->belongsTo(User::class, 'resolved_by');
    }

    public function subject(): MorphTo
    {
        return $this->morphTo();
    }

    /** Old history-only and dismissed records are pruned; problems and their fixes are kept. */
    public function prunable(): Builder
    {
        return static::query()
            ->whereIn('status', [self::STATUS_RECORDED, self::STATUS_DISMISSED])
            ->where('occurred_at', '<', now()->subDays(self::RECORDED_RETENTION_DAYS));
    }
}
