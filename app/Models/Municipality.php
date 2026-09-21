<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class Municipality extends Model
{
    use SoftDeletes;

    protected $fillable = ['name', 'district', 'province', 'latitude', 'longitude'];

    protected $casts = [
        'latitude' => 'decimal:7',
        'longitude' => 'decimal:7',
    ];

    public function barangays(): HasMany
    {
        return $this->hasMany(Barangay::class);
    }

    public function businesses(): HasMany
    {
        return $this->hasMany(Business::class);
    }

    public function destinations(): HasMany
    {
        return $this->hasMany(TouristDestination::class);
    }

    public function tourismOfficers()
    {
        return $this->hasManyThrough(User::class, UserProfile::class, 'municipality_id', 'id', 'id', 'user_id')
            ->where('role', User::ROLE_TOURISM_OFFICE);
    }
}
