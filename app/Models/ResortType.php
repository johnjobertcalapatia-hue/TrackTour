<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;

/** Resort classification (Pool, Nature, Beach, …). A resort can have several. */
class ResortType extends Model
{
    protected $fillable = ['slug', 'name', 'description', 'sort_order'];

    public function businesses(): BelongsToMany
    {
        return $this->belongsToMany(Business::class, 'business_resort_types')->withTimestamps();
    }
}
