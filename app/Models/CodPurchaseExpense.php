<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class CodPurchaseExpense extends Model
{
    public const STATUS_SUBMITTED = 'submitted';

    public const STATUS_VERIFIED = 'verified';

    public const STATUS_REJECTED = 'rejected';

    protected $fillable = [
        'cod_purchase_id',
        'revision',
        'actual_purchase_amount',
        'tourism_office_cash_used',
        'rider_personal_contribution',
        'receipt_path',
        'status',
        'submitted_by',
        'submitted_at',
        'verified_by',
        'verified_at',
        'rejection_reason',
    ];

    protected function casts(): array
    {
        return [
            'actual_purchase_amount' => 'decimal:2',
            'tourism_office_cash_used' => 'decimal:2',
            'rider_personal_contribution' => 'decimal:2',
            'submitted_at' => 'datetime',
            'verified_at' => 'datetime',
        ];
    }

    public function purchase(): BelongsTo
    {
        return $this->belongsTo(CodPurchase::class, 'cod_purchase_id');
    }

    public function submitter(): BelongsTo
    {
        return $this->belongsTo(User::class, 'submitted_by');
    }

    public function verifier(): BelongsTo
    {
        return $this->belongsTo(User::class, 'verified_by');
    }

    public function fundTransactions(): HasMany
    {
        return $this->hasMany(RiderCashFundTransaction::class, 'cod_purchase_expense_id');
    }
}
