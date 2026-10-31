<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

class RiderDailyCashMovement extends Model
{
    public const TYPE_COD_REMITTANCE_RECEIVED = 'cod_remittance_received';

    public const TYPE_OFFICE_CASH_RETURNED = 'office_cash_returned';

    public const TYPE_RIDER_REIMBURSEMENT_PAID = 'rider_reimbursement_paid';

    public const TYPE_REVERSAL = 'reversal';

    public const TYPE_ADJUSTMENT = 'adjustment';

    public const BALANCE_TYPES = [
        self::TYPE_COD_REMITTANCE_RECEIVED,
        self::TYPE_OFFICE_CASH_RETURNED,
        self::TYPE_RIDER_REIMBURSEMENT_PAID,
    ];

    protected $fillable = [
        'rider_id',
        'municipality_id',
        'business_date',
        'rider_daily_reconciliation_id',
        'revision',
        'movement_type',
        'affects_type',
        'amount',
        'recorded_by',
        'transaction_at',
        'reference',
        'reference_type',
        'reference_namespace',
        'reference_source',
        'reference_issuer',
        'reference_series',
        'normalized_reference',
        'reference_fingerprint',
        'evidence_details',
        'idempotency_key',
        'reverses_movement_id',
        'adjusts_movement_id',
        'correction_cycle_id',
    ];

    protected function casts(): array
    {
        return [
            'business_date' => 'date:Y-m-d',
            'amount' => 'decimal:2',
            'transaction_at' => 'datetime',
        ];
    }

    public function rider(): BelongsTo
    {
        return $this->belongsTo(User::class, 'rider_id');
    }

    public function municipality(): BelongsTo
    {
        return $this->belongsTo(Municipality::class);
    }

    public function reconciliation(): BelongsTo
    {
        return $this->belongsTo(RiderDailyReconciliation::class, 'rider_daily_reconciliation_id');
    }

    public function recorder(): BelongsTo
    {
        return $this->belongsTo(User::class, 'recorded_by');
    }

    public function reversedMovement(): BelongsTo
    {
        return $this->belongsTo(self::class, 'reverses_movement_id');
    }

    public function reversal(): HasOne
    {
        return $this->hasOne(self::class, 'reverses_movement_id');
    }

    public function adjustedMovement(): BelongsTo
    {
        return $this->belongsTo(self::class, 'adjusts_movement_id');
    }

    public function correctionCycle(): BelongsTo
    {
        return $this->belongsTo(RiderDailyReconciliationCorrection::class, 'correction_cycle_id');
    }

    public function correctionCycles(): BelongsToMany
    {
        return $this->belongsToMany(
            RiderDailyReconciliationCorrection::class,
            'rider_daily_cash_movement_correction_cycles',
            'movement_id',
            'correction_id'
        )->withTimestamps();
    }
}
