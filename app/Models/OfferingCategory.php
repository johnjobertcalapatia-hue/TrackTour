<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class OfferingCategory extends Model
{
    use SoftDeletes;

    protected $table = 'offering_categories';

    protected $fillable = [
        'business_id',
        'name',
        'icon',
        'description',
        'is_available',
        'sort_order',
    ];

    protected $casts = [
        'is_available' => 'boolean',
    ];

    public function business(): BelongsTo
    {
        return $this->belongsTo(Business::class);
    }

    public function offerings(): HasMany
    {
        return $this->hasMany(Offering::class, 'offering_category_id');
    }
}
