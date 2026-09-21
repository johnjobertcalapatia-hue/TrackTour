<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class OfferingVariationOption extends Model
{
    protected $table = 'offering_variation_options';

    protected $fillable = [
        'variation_group_id',
        'name',
        'price_adjustment',
        'sort_order',
    ];

    protected function casts(): array
    {
        return [
            'price_adjustment' => 'float',
        ];
    }

    public function group(): BelongsTo
    {
        return $this->belongsTo(OfferingVariationGroup::class, 'variation_group_id');
    }
}
