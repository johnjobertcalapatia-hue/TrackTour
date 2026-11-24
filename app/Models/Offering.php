<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
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
        // 'stock' is deprecated and unused (no inventory quantities, Stage 3).
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

    protected static function booted(): void
    {
        // Promotions Part A: a menu price change may not make a running or
        // upcoming dish sale ₱0 or less (every menu edit path saves through here).
        static::saving(function (Offering $offering) {
            if (! $offering->exists || ! $offering->isDirty('price')) {
                return;
            }
            $pricing = app(\App\Services\SalePricing::class);
            $conflict = $offering->sales()
                ->where('promotions.kind', Promotion::KIND_ITEM_SALE)
                ->where('promotions.is_active', true)
                ->where('promotions.end_date', '>=', now())
                ->get(['promotions.id', 'promotions.name', 'promotions.type', 'promotions.value'])
                ->first(fn (Promotion $sale) => $pricing->salePrice((float) $offering->price, (string) $sale->type, (float) $sale->value) < 0.01);
            if ($conflict) {
                throw \Illuminate\Validation\ValidationException::withMessages([
                    'price' => "This price would make the sale \"{$conflict->name}\" ₱0 or less. Change or end the sale first.",
                ]);
            }
        });
    }

    public function sales(): BelongsToMany
    {
        return $this->belongsToMany(Promotion::class, 'promotion_offering')->withTimestamps();
    }

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
