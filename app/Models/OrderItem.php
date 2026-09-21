<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class OrderItem extends Model
{
    protected static function booted(): void
    {
        // P5.2: keep the parent order's size tag in sync with its live items.
        // sync() only writes when the class changed, so normal orders are free.
        $syncOrderSize = fn (OrderItem $item) => $item->order?->refreshSizeClass();

        static::saved($syncOrderSize);
        static::deleted($syncOrderSize);
    }

    protected $fillable = [
        'order_id',
        'offering_id',
        'product_name',
        'quantity',
        'unit_price',
        'subtotal',
        'notes',
        'status',
        'accepted_at',
        'preparation_started_at',
        'ready_at',
        'cancelled_quantity',
        'cancelled_by',
        'cancellation_reason',
        'cancelled_at',
        'rejection_reason',
        'rejected_by',
    ];

    protected function casts(): array
    {
        return [
            'accepted_at' => 'datetime',
            'preparation_started_at' => 'datetime',
            'ready_at' => 'datetime',
            'cancelled_at' => 'datetime',
        ];
    }

    public function order(): BelongsTo
    {
        return $this->belongsTo(Order::class);
    }

    public function offering(): BelongsTo
    {
        return $this->belongsTo(Offering::class, 'offering_id');
    }

    public function canceller(): BelongsTo
    {
        return $this->belongsTo(User::class, 'cancelled_by');
    }

    public function rejector(): BelongsTo
    {
        return $this->belongsTo(User::class, 'rejected_by');
    }

    public function activeQuantity(): int
    {
        return max(0, (int) $this->quantity - (int) $this->cancelled_quantity);
    }

    public function isPending(): bool
    {
        return $this->status === 'pending';
    }

    public function isAccepted(): bool
    {
        return in_array($this->status, ['accepted', 'preparing', 'ready']);
    }

    public function isRejected(): bool
    {
        return $this->status === 'rejected';
    }

    public function isPreparing(): bool
    {
        return $this->status === 'preparing';
    }

    public function isReady(): bool
    {
        return $this->status === 'ready';
    }

    public function canAccept(): bool
    {
        return $this->status === 'pending';
    }

    public function canReject(): bool
    {
        return in_array($this->status, ['pending', 'accepted']);
    }
}
