<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

class BusinessPromotion extends Model
{
    use SoftDeletes;

    protected $fillable = [
        'business_id',
        'title',
        'description',
        'image',
        'discount_type',
        'discount_value',
        'starts_at',
        'ends_at',
        'status',
        'priority',
    ];

    protected function casts(): array
    {
        return [
            'discount_value' => 'decimal:2',
            'starts_at' => 'datetime',
            'ends_at' => 'datetime',
            'priority' => 'integer',
        ];
    }

    public function business(): BelongsTo
    {
        return $this->belongsTo(Business::class);
    }
}
