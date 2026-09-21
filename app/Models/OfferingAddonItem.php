<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class OfferingAddonItem extends Model
{
    protected $table = 'offering_addon_items';

    protected $fillable = [
        'addon_group_id',
        'name',
        'price',
        'sort_order',
    ];

    protected function casts(): array
    {
        return [
            'price' => 'float',
        ];
    }

    public function group(): BelongsTo
    {
        return $this->belongsTo(OfferingAddonGroup::class, 'addon_group_id');
    }
}
