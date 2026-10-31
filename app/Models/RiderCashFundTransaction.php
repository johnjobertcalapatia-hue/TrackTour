<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class RiderCashFundTransaction extends Model
{
    public const TYPE_CASH_ISSUED = 'cash_issued';

    public const TYPE_ADDITIONAL_CASH_ISSUED = 'additional_cash_issued';

    public const TYPE_PURCHASE_OFFICE_CASH_USED = 'purchase_office_cash_used';

    public const TYPE_RIDER_PERSONAL_CONTRIBUTION = 'rider_personal_contribution';

    protected $fillable = [
        'rider_cash_fund_id',
        'reference_number',
        'idempotency_key',
        'type',
        'amount',
        'occurred_at',
        'delivery_id',
        'cod_purchase_id',
        'cod_purchase_expense_id',
        'recorded_by',
        'received_by',
        'received_at',
        'metadata',
    ];

    protected function casts(): array
    {
        return [
            'amount' => 'decimal:2',
            'occurred_at' => 'datetime',
            'received_at' => 'datetime',
            'metadata' => 'array',
        ];
    }

    public function fund(): BelongsTo
    {
        return $this->belongsTo(RiderCashFund::class, 'rider_cash_fund_id');
    }

    public function delivery(): BelongsTo
    {
        return $this->belongsTo(Delivery::class);
    }

    public function purchase(): BelongsTo
    {
        return $this->belongsTo(CodPurchase::class, 'cod_purchase_id');
    }

    public function expense(): BelongsTo
    {
        return $this->belongsTo(CodPurchaseExpense::class, 'cod_purchase_expense_id');
    }
}
