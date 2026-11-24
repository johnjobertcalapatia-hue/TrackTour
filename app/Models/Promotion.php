<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * A business promotion. kind = 'label' is shown to tourists as a badge only
 * (the original behaviour); kind = 'item_sale' lowers the price of the dishes
 * linked in promotion_offering while it runs (see App\Services\SalePricing).
 */
class Promotion extends Model
{
    use SoftDeletes;

    public const KIND_LABEL = 'label';

    public const KIND_ITEM_SALE = 'item_sale';

    protected $fillable = [
        'business_id',
        'kind',
        'name',
        'description',
        'type',
        'value',
        'min_order',
        'code',
        'start_date',
        'end_date',
        'is_active',
        'usage_limit',
        'usage_count',
    ];

    protected function casts(): array
    {
        return [
            'start_date' => 'datetime',
            'end_date' => 'datetime',
            'is_active' => 'boolean',
        ];
    }

    public function business(): BelongsTo
    {
        return $this->belongsTo(Business::class);
    }

    public function offerings(): BelongsToMany
    {
        return $this->belongsToMany(Offering::class, 'promotion_offering')->withTimestamps();
    }

    public function isItemSale(): bool
    {
        return $this->kind === self::KIND_ITEM_SALE;
    }

    public function scopeItemSales($query)
    {
        return $query->where('kind', self::KIND_ITEM_SALE);
    }

    public function scopeLabels($query)
    {
        return $query->where(fn ($q) => $q->where('kind', self::KIND_LABEL)->orWhereNull('kind'));
    }

    /** scheduled, active, ended or stopped (an item sale switched off early). */
    public function saleStatus(): string
    {
        if (! $this->is_active) {
            return 'stopped';
        }
        if ($this->end_date && $this->end_date->lt(now())) {
            return 'ended';
        }
        if ($this->start_date && $this->start_date->gt(now())) {
            return 'scheduled';
        }

        return 'active';
    }

    public function scopeActive($query)
    {
        return $query->where('is_active', true)
            ->where(function ($q) {
                $q->whereNull('start_date')->orWhere('start_date', '<=', now());
            })
            ->where(function ($q) {
                $q->whereNull('end_date')->orWhere('end_date', '>=', now());
            });
    }
}
