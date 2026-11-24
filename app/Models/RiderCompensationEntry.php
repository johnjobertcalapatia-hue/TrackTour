<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/** Stage D1: append-only compensation ledger entry (DB triggers refuse UPDATE/DELETE). */
class RiderCompensationEntry extends Model
{
    public const UPDATED_AT = null;

    public const COMPENSATION_EARNED = 'compensation_earned';

    public const ADVANCE_GRANTED = 'advance_granted';

    public const ADVANCE_RECOVERED = 'advance_recovered';

    public const VOIDED = 'voided';

    public const WRITTEN_OFF = 'written_off';

    protected $fillable = [
        'compensation_id', 'rider_id', 'penalty_id', 'payout_id', 'entry_type', 'bucket', 'amount',
        'reason', 'details', 'actor_id', 'idempotency_key', 'created_at',
    ];

    protected function casts(): array
    {
        return ['amount' => 'float', 'details' => 'array', 'created_at' => 'datetime'];
    }
}
