<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

class BusinessMedia extends Model
{
    use SoftDeletes;

    /**
     * Gallery photo categories for every kind of business (restaurant, resort,
     * tourist attraction, others); the owner's Business Gallery page offers the
     * ones that fit the business type (business-profile-kind.ts).
     */
    public const GALLERY_CATEGORIES = [
        // restaurants
        'food', 'restaurant', 'signature_dish', 'interior', 'dining_area', 'behind_the_scenes', 'new_menu', 'best_seller', 'dessert', 'drink',
        // resorts and tourist attractions
        'beach', 'nature', 'attraction', 'pool', 'cottage', 'room', 'facility', 'activity', 'scenery', 'campsite', 'river',
        // any business
        'promotion', 'event',
    ];

    protected $fillable = [
        'business_id',
        'type',
        'title',
        'category',
        'file_path',
        'caption',
        'sort_order',
        'featured',
        'visibility',
        'status',
    ];

    protected $casts = [
        'featured' => 'boolean',
        'sort_order' => 'integer',
    ];

    public function business(): BelongsTo
    {
        return $this->belongsTo(Business::class);
    }
}
