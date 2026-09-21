<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class OfferingVariationGroup extends Model
{
    protected $table = 'offering_variation_groups';

    protected $fillable = [
        'offering_id',
        'name',
        'required',
        'min_select',
        'max_select',
        'sort_order',
    ];

    protected function casts(): array
    {
        return [
            'required' => 'boolean',
        ];
    }

    public function offering(): BelongsTo
    {
        return $this->belongsTo(Offering::class);
    }

    public function options(): HasMany
    {
        return $this->hasMany(OfferingVariationOption::class, 'variation_group_id');
    }
}
