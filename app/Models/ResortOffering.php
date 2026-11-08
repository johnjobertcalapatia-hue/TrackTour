<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * Something a tourist can reserve at a resort (dynamic resort system,
 * Stage 4): cottage, room, campsite, pool access, activity, equipment,
 * function area, package, food service or other. How it is booked is
 * structured configuration, not free JSON.
 */
class ResortOffering extends Model
{
    use SoftDeletes;

    public const CATEGORIES = [
        'cottage' => 'Cottage',
        'room' => 'Room',
        'campsite' => 'Campsite',
        'pool_access' => 'Pool access',
        'activity' => 'Activity',
        'equipment' => 'Equipment rental',
        'function_area' => 'Function area',
        'package' => 'Package',
        'food_service' => 'Food service',
        'other' => 'Other',
    ];

    /** Categories shown under "Cottages & stays" (the rest: "Activities & services"). */
    public const STAY_CATEGORIES = ['cottage', 'room', 'campsite'];

    public const BOOKING_MODES = ['day_use', 'overnight', 'time_slot', 'duration'];

    public const PRICING_BASES = ['per_person', 'per_unit', 'per_hour', 'per_night', 'per_booking'];

    public const INVENTORY_MODES = ['units', 'capacity', 'slots'];

    public const MAX_IMAGES = 8;

    protected $fillable = [
        'business_id', 'category', 'name', 'description',
        'booking_mode', 'pricing_basis', 'price', 'inventory_mode', 'inventory_quantity',
        'min_guests', 'max_guests', 'min_quantity', 'max_quantity', 'duration_minutes',
        'is_required', 'bookable_independently', 'requires_offering_id',
        'is_published', 'sort_order', 'attributes',
    ];

    protected function casts(): array
    {
        return [
            'price' => 'decimal:2',
            'inventory_quantity' => 'integer',
            'min_guests' => 'integer',
            'max_guests' => 'integer',
            'min_quantity' => 'integer',
            'max_quantity' => 'integer',
            'duration_minutes' => 'integer',
            'is_required' => 'boolean',
            'bookable_independently' => 'boolean',
            'is_published' => 'boolean',
            'sort_order' => 'integer',
            'attributes' => 'array',
        ];
    }

    public function business(): BelongsTo
    {
        return $this->belongsTo(Business::class);
    }

    public function images(): HasMany
    {
        return $this->hasMany(ResortOfferingImage::class)->orderBy('sort_order')->orderBy('id');
    }

    public function requires(): BelongsTo
    {
        return $this->belongsTo(self::class, 'requires_offering_id');
    }

    public function scopePublished($q)
    {
        return $q->where('is_published', true);
    }
}
