<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;

/** Catalogue facility (swimming pool, beach access, parking, …). */
class ResortFacility extends Model
{
    protected $fillable = ['slug', 'name', 'sort_order'];

    public function businesses(): BelongsToMany
    {
        return $this->belongsToMany(Business::class, 'business_resort_facilities')->withTimestamps();
    }
}
