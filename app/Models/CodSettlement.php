<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasOne;

/**
 * P11.1 COD settlement ledger. One row per settled COD order, recording the
 * auditable 80% restaurant / 20% Tourism Office split of the rider-financed
 * settlement base. Serves as BOTH the restaurant receivable ledger and the
 * Tourism Office (admin) revenue ledger.
 */
class CodSettlement extends Model
{
    public const STATUS_SETTLED = 'settled';

    public const STATUS_PAID = 'paid';

    protected $fillable = [
        'settlement_number',
        'order_id',
        'delivery_id',
        'business_id',
        'rider_id',
        'settlement_base',
        'restaurant_share',
        'platform_fee',
        'status',
        'settled_at',
    ];

    protected function casts(): array
    {
        return [
            'settlement_base' => 'decimal:2',
            'restaurant_share' => 'decimal:2',
            'platform_fee' => 'decimal:2',
            'settled_at' => 'datetime',
        ];
    }

    public function order(): BelongsTo
    {
        return $this->belongsTo(Order::class);
    }

    public function delivery(): BelongsTo
    {
        return $this->belongsTo(Delivery::class);
    }

    public function business(): BelongsTo
    {
        return $this->belongsTo(Business::class, 'business_id');
    }

    public function rider(): BelongsTo
    {
        return $this->belongsTo(User::class, 'rider_id');
    }

    public function orderSettlement(): HasOne
    {
        return $this->hasOne(OrderSettlement::class);
    }
}
