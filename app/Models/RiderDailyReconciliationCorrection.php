<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;

class RiderDailyReconciliationCorrection extends Model
{
    public const STATUS_PENDING_REVIEW = 'pending_review';

    public const STATUS_REVIEWED = 'reviewed';

    public const STATUS_REJECTED = 'rejected';

    public const STATUS_CLOSED = 'closed';

    protected $fillable = [
        'rider_daily_reconciliation_id',
        'cycle_number',
        'status',
        'balance_snapshot',
        'created_by',
        'reviewed_by',
        'reviewed_at',
        'review_decision',
        'review_note',
        'closed_by',
        'closed_at',
    ];

    protected function casts(): array
    {
        return [
            'balance_snapshot' => 'array',
            'reviewed_at' => 'datetime',
            'closed_at' => 'datetime',
        ];
    }

    public function reconciliation(): BelongsTo
    {
        return $this->belongsTo(RiderDailyReconciliation::class, 'rider_daily_reconciliation_id');
    }

    public function movements(): HasMany
    {
        return $this->hasMany(RiderDailyCashMovement::class, 'correction_cycle_id');
    }

    public function linkedMovements(): BelongsToMany
    {
        return $this->belongsToMany(
            RiderDailyCashMovement::class,
            'rider_daily_cash_movement_correction_cycles',
            'correction_id',
            'movement_id'
        )->withTimestamps();
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function reviewer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'reviewed_by');
    }

    public function closer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'closed_by');
    }
}
