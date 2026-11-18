<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** A real, de-duplicated view of a business profile or one of its offerings. */
class BusinessEngagementEvent extends Model
{
    public const TYPE_PROFILE_VIEW = 'profile_view';

    public const TYPE_OFFERING_VIEW = 'offering_view';

    public const UPDATED_AT = null;

    protected $fillable = ['business_id', 'type', 'offering_id', 'viewer_key', 'viewed_on'];

    protected $casts = ['viewed_on' => 'date'];

    public function business(): BelongsTo
    {
        return $this->belongsTo(Business::class);
    }
}
