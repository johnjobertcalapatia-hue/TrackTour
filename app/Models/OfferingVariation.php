<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class OfferingVariation extends Model
{
    protected $fillable = [
        'offering_id',
        'name',
        'price',
        'compare_price',
        'image',
        'is_available',
        'sort_order',
    ];

    protected $casts = [
        'price' => 'decimal:2',
        'compare_price' => 'decimal:2',
        'is_available' => 'boolean',
    ];

    public function offering()
    {
        return $this->belongsTo(Offering::class);
    }
}
