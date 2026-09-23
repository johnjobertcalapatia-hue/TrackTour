<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One per-restaurant purchase stop for a COD delivery.
 *
 * Lifecycle (professor purchasing-cash flow):
 *
 *     pending → purchased (rider pays/collects the goods at the counter)
 *            → collected (stop complete, items in hand)
 *
 * purchase_amount deliberately mirrors the CodSettlementService allocation
 * (business subtotal + system-fee share), so the sum across a delivery always
 * reconciles to order.rider_financed_amount, the settlement base.
 */
class CodPurchase extends Model
{
    public const STATUS_PENDING = 'pending';

    public const STATUS_PURCHASED = 'purchased';

    public const STATUS_COLLECTED = 'collected';

    protected $fillable = [
        'purchase_number',
        'delivery_id',
        'order_id',
        'business_id',
        'purchase_amount',
        'status',
        'purchased_at',
        'collected_at',
    ];

    protected function casts(): array
    {
        return [
            'purchase_amount' => 'decimal:2',
            'purchased_at' => 'datetime',
            'collected_at' => 'datetime',
        ];
    }

    public function delivery(): BelongsTo
    {
        return $this->belongsTo(Delivery::class);
    }

    public function order(): BelongsTo
    {
        return $this->belongsTo(Order::class);
    }

    public function business(): BelongsTo
    {
        return $this->belongsTo(Business::class);
    }
}