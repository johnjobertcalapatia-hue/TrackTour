<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class RiderDailyReconciliation extends Model
{
    public const STATUS_SUBMITTED = 'submitted';

    public const STATUS_DISPUTED = 'disputed';

    public const STATUS_VERIFIED = 'verified';

    public const STATUS_CLOSED = 'closed';

    protected $fillable = [
        'rider_id',
        'municipality_id',
        'working_date',
        'revision',
        'status',
        'idempotency_key',
        'expected_cod_remittance',
        'expected_office_cash_return',
        'expected_rider_payable',
        'submitted_cod_remittance',
        'submitted_office_cash_return',
        'remittance_reference',
        'rider_note',
        'receipt_snapshot',
        'submitted_at',
        'verified_cod_received',
        'verified_office_cash_return',
        'verified_rider_reimbursement',
        'verification_note',
        'verified_by',
        'verified_at',
        'closed_by',
        'closed_at',
    ];

    protected function casts(): array
    {
        return [
            'working_date' => 'date:Y-m-d',
            'receipt_snapshot' => 'array',
            'submitted_at' => 'datetime',
            'verified_at' => 'datetime',
            'closed_at' => 'datetime',
            'expected_cod_remittance' => 'decimal:2',
            'expected_office_cash_return' => 'decimal:2',
            'expected_rider_payable' => 'decimal:2',
            'submitted_cod_remittance' => 'decimal:2',
            'submitted_office_cash_return' => 'decimal:2',
            'verified_cod_received' => 'decimal:2',
            'verified_office_cash_return' => 'decimal:2',
            'verified_rider_reimbursement' => 'decimal:2',
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

    public function verifier(): BelongsTo
    {
        return $this->belongsTo(User::class, 'verified_by');
    }

    public function closer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'closed_by');
    }

    public function events(): HasMany
    {
        return $this->hasMany(RiderDailyReconciliationEvent::class);
    }

    public function corrections(): HasMany
    {
        return $this->hasMany(RiderDailyReconciliationCorrection::class);
    }
}
