<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class Offering extends Model
{
    use SoftDeletes;
    protected $table = 'offerings';

    protected $fillable = [
        'business_id',
        'offering_category_id',
        'name',
        'description',
        'price',
        'preparation_time',
        'compare_price',
        'unit',
        'stock',
        'is_available',
        'status',
        'bestseller',
        'has_variations',
        'image',
        'images',
        'sort_order',
        'type',
        'offering_type',
        'preparation_record_count',
        'prediction_eligible',
    ];

    protected function casts(): array
    {
        return [
            'is_available' => 'boolean',
            'bestseller' => 'boolean',
            'has_variations' => 'boolean',
            'images' => 'array',
            'price' => 'float',
            'preparation_time' => 'integer',
            'compare_price' => 'float',
            'preparation_record_count' => 'integer',
            'prediction_eligible' => 'boolean',
        ];
    }

    const MINIMUM_RECORDS_FOR_PREDICTION = 5;

    public function scopeAvailable($q)
    {
        $q->where('status', 'available');
    }

    public function scopeUnavailable($q)
    {
        $q->where('status', 'unavailable');
    }

    public function scopeHidden($q)
    {
        $q->where('status', 'hidden');
    }

    public function scopeVisible($q)
    {
        $q->whereIn('status', ['available', 'unavailable']);
    }

    public function scopeFeatured($q)
    {
        $q->where('bestseller', true);
    }

    public function business(): BelongsTo
    {
        return $this->belongsTo(Business::class);
    }

    public function category(): BelongsTo
    {
        return $this->belongsTo(OfferingCategory::class, 'offering_category_id');
    }

    public function orderItems(): HasMany
    {
        return $this->hasMany(OrderItem::class, 'offering_id');
    }

    public function variationGroups(): HasMany
    {
        return $this->hasMany(OfferingVariationGroup::class);
    }

    public function addonGroups(): HasMany
    {
        return $this->hasMany(OfferingAddonGroup::class);
    }

    public function variations(): HasMany
    {
        return $this->hasMany(OfferingVariation::class)->orderBy('sort_order')->orderBy('name');
    }

    public function getOrdersCountAttribute(): int
    {
        return $this->orderItems()->count();
    }

    public function getRevenueAttribute(): float
    {
        return (float) $this->orderItems()->sum('subtotal');
    }

    public function preparationRecords(): HasMany
    {
        return $this->hasMany(FoodPreparationRecord::class, 'menu_item_id');
    }

    public function isPredictionEligible(): bool
    {
        return $this->preparation_record_count >= self::MINIMUM_RECORDS_FOR_PREDICTION;
    }

    public function refreshPreparationStats(): void
    {
        $validCount = FoodPreparationRecord::where('menu_item_id', $this->id)
            ->where('restaurant_id', $this->business_id)
            ->validForTraining()
            ->count();

        $this->update([
            'preparation_record_count' => $validCount,
            'prediction_eligible' => $validCount >= self::MINIMUM_RECORDS_FOR_PREDICTION,
        ]);
    }
}
