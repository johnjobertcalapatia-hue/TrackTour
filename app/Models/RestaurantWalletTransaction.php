<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Immutable restaurant-wallet ledger entry. P12.2 will create these together
 * with the common order settlement under the wallet row lock.
 */
class RestaurantWalletTransaction extends Model
{
    public const TYPE_ORDER_EARNING = 'ORDER_EARNING';

    public const TYPE_REFUND_DEDUCTION = 'REFUND_DEDUCTION';

    public const TYPE_ADJUSTMENT = 'ADJUSTMENT';

    public const TYPE_WITHDRAWAL = 'WITHDRAWAL';

    public const TYPE_WITHDRAWAL_REVERSAL = 'WITHDRAWAL_REVERSAL';

    protected $fillable = [
        'transaction_number',
        'wallet_id',
        'business_id',
        'order_settlement_id',
        'refund_id',
        'type',
        'reference_type',
        'reference_id',
        'amount',
        'available_balance_before',
        'available_balance_after',
        'pending_balance_before',
        'pending_balance_after',
        'description',
    ];

    protected function casts(): array
    {
        return [
            'amount' => 'decimal:2',
            'available_balance_before' => 'decimal:2',
            'available_balance_after' => 'decimal:2',
            'pending_balance_before' => 'decimal:2',
            'pending_balance_after' => 'decimal:2',
        ];
    }

    public function wallet(): BelongsTo
    {
        return $this->belongsTo(RestaurantWallet::class, 'wallet_id');
    }

    public function business(): BelongsTo
    {
        return $this->belongsTo(Business::class);
    }

    public function orderSettlement(): BelongsTo
    {
        return $this->belongsTo(OrderSettlement::class);
    }
}
