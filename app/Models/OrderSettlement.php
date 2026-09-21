<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasOne;

/**
 * Common completed-order financial effect. COD retains CodSettlement as its
 * allocation authority; this row is the idempotent wallet-posting authority.
 */
class OrderSettlement extends Model
{
    public const SOURCE_COD = 'cod';

    public const SOURCE_GCASH = 'gcash';

    public const STATUS_SETTLED = 'settled';

    protected $fillable = [
        'settlement_number',
        'order_id',
        'business_id',
        'cod_settlement_id',
        'source',
        'payment_method',
        'settlement_base',
        'restaurant_amount',
        'platform_amount',
        'status',
        'settled_at',
    ];

    protected function casts(): array
    {
        return [
            'settlement_base' => 'decimal:2',
            'restaurant_amount' => 'decimal:2',
            'platform_amount' => 'decimal:2',
            'settled_at' => 'datetime',
        ];
    }

    public function order(): BelongsTo
    {
        return $this->belongsTo(Order::class);
    }

    public function business(): BelongsTo
    {
        return $this->belongsTo(Business::class);
    }

    public function codSettlement(): BelongsTo
    {
        return $this->belongsTo(CodSettlement::class);
    }

    public function walletTransaction(): HasOne
    {
        return $this->hasOne(RestaurantWalletTransaction::class);
    }
}
