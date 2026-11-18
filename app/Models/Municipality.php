<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class Municipality extends Model
{
    use SoftDeletes;

    /** TrackTour's home municipality; its office is the District Super Admin. */
    public const HOME_MUNICIPALITY = 'Bansud';

    protected $fillable = ['name', 'district', 'province', 'logo', 'cover_photo', 'latitude', 'longitude'];

    protected $casts = [
        'latitude' => 'decimal:7',
        'longitude' => 'decimal:7',
    ];

    public function isHome(): bool
    {
        return strcasecmp((string) $this->name, self::HOME_MUNICIPALITY) === 0;
    }

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

    /**
     * Municipality Tourism Admin accounts. Scope is `users.municipality_id`
     * (docs/PHASE2-ROLES-PERMISSIONS.md F-7), not the profile column.
     */
    public function tourismOfficers(): HasMany
    {
        return $this->hasMany(User::class)->where('role', User::ROLE_TOURISM_OFFICE);
    }

    public function riders(): HasMany
    {
        return $this->hasMany(User::class)->where('role', User::ROLE_RIDER);
    }
}
