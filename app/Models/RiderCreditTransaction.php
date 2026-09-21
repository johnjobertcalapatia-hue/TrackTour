<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class RiderCreditTransaction extends Model
{
    protected $fillable = [
        'rider_id',
        'order_id',
        'transaction_type',
        'amount',
        'balance_before',
        'balance_after',
        'reserved_before',
        'reserved_after',
        'reference',
        'description',
    ];

    protected function casts(): array
    {
        return [
            'amount' => 'decimal:2',
            'balance_before' => 'decimal:2',
            'balance_after' => 'decimal:2',
            'reserved_before' => 'decimal:2',
            'reserved_after' => 'decimal:2',
        ];
    }

    public function rider(): BelongsTo
    {
        return $this->belongsTo(User::class, 'rider_id');
    }

    public function order(): BelongsTo
    {
        return $this->belongsTo(Order::class);
    }
}
