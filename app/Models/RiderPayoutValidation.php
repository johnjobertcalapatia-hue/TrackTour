<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use LogicException;

/** One stored validation of a cashout against the earnings ledger (append-only). */
class RiderPayoutValidation extends Model
{
    public const UPDATED_AT = null;

    public const PASS = 'pass';

    public const FLAG = 'flag';

    public const BLOCK = 'block';

    protected $fillable = ['rider_payout_id', 'context', 'result', 'checks', 'destination_fingerprint', 'decision_note', 'checked_by'];

    protected function casts(): array
    {
        return ['checks' => 'array'];
    }

    protected static function booted(): void
    {
        static::updating(fn () => throw new LogicException('Cashout validations are append-only.'));
        static::deleting(fn () => throw new LogicException('Cashout validations are append-only.'));
    }
}
