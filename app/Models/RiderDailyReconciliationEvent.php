<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class RiderDailyReconciliationEvent extends Model
{
    public $timestamps = false;

    protected $fillable = [
        'rider_daily_reconciliation_id',
        'actor_id',
        'action',
        'from_status',
        'to_status',
        'idempotency_key',
        'details',
        'created_at',
    ];

    protected function casts(): array
    {
        return [
            'details' => 'array',
            'created_at' => 'datetime',
        ];
    }

    public function reconciliation(): BelongsTo
    {
        return $this->belongsTo(RiderDailyReconciliation::class, 'rider_daily_reconciliation_id');
    }

    public function actor(): BelongsTo
    {
        return $this->belongsTo(User::class, 'actor_id');
    }
}
