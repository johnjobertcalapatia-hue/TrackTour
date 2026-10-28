<?php

namespace App\Models;

use App\Enums\DiscoveryGroup;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;
use App\Models\RequiredDocument;

class BusinessCategory extends Model
{
    protected $fillable = [
        'name',
        'description',
        'archived_at',
    ];

    protected function casts(): array
    {
        return [
            'archived_at' => 'datetime',
        ];
    }

    public function businesses(): HasMany
    {
        return $this->hasMany(Business::class);
    }

    public function modules(): BelongsToMany
    {
        return $this->belongsToMany(BusinessModule::class, 'business_type_module', 'business_category_id', 'business_module_id');
    }

    public function enabledModuleCodes(): array
    {
        return $this->modules()->pluck('code')->toArray();
    }

    public function staffRoles(): BelongsToMany
    {
        return $this->belongsToMany(StaffRole::class, 'business_category_staff_role');
    }

    public function requiredDocuments(): HasMany
    {
        return $this->hasMany(RequiredDocument::class, 'business_category_id')->orderBy('sort_order');
    }

    public function scopeNotArchived($query)
    {
        return $query->whereNull('archived_at');
    }

    /**
     * Restrict categories to a canonical tourist-facing discovery group.
     *
     * SQL is kept deliberately in sync with DiscoveryGroup::fromCategoryName().
     * Dining excludes combined hotel/restaurant categories, and Spot excludes
     * accommodation names so "Beach Resort" is never treated as an attraction.
     */
    public function scopeInDiscoveryGroup($query, DiscoveryGroup $group)
    {
        return match ($group) {
            DiscoveryGroup::Spot => $query
                ->where(function ($q) {
                    $this->applyCategoryPatterns($q, [
                        '%attraction%',
                        '%tourism%',
                        '%nature%',
                        '%beach%',
                        '%park%',
                        '%historical%',
                        '%cultural%',
                        '%adventure%',
                        '%viewpoint%',
                        '%tourist spot%',
                        '%destination%',
                        '%museum%',
                    ]);
                })
                ->whereRaw('LOWER(name) NOT LIKE ?', ['%resort%'])
                ->whereRaw('LOWER(name) NOT LIKE ?', ['%hotel%'])
                ->whereRaw('LOWER(name) NOT LIKE ?', ['%inn%'])
                ->whereRaw('LOWER(name) NOT LIKE ?', ['%homestay%'])
                ->whereRaw('LOWER(name) NOT LIKE ?', ['%lodging%'])
                ->whereRaw('LOWER(name) NOT LIKE ?', ['%motel%'])
                ->whereRaw('LOWER(name) NOT LIKE ?', ['%apartel%']),

            DiscoveryGroup::Dining => $query
                ->where(function ($q) {
                    $this->applyCategoryPatterns($q, [
                        '%restaurant%',
                        '%café%',
                        '%cafe%',
                        '%food%',
                        '%bakery%',
                        '%carinderia%',
                    ]);

                    $q->orWhereRaw('LOWER(name) = ?', ['bar']);
                })
                ->whereRaw('LOWER(name) NOT LIKE ?', ['%hotel%'])
                ->whereRaw('LOWER(name) NOT LIKE ?', ['%resort%']),

            DiscoveryGroup::Accommodation => $query
                ->where(function ($q) {
                    $this->applyCategoryPatterns($q, [
                        '%hotel%',
                        '%resort%',
                        '%homestay%',
                        '%camping%',
                        '%inn%',
                        '%lodging%',
                        '%stay%',
                        '%apartel%',
                        '%motel%',
                    ]);
                }),

            DiscoveryGroup::Other => $query
                ->whereNot(function ($q) {
                    $q->where(function ($q) {
                        $q->inDiscoveryGroup(DiscoveryGroup::Spot);
                    })->orWhere(function ($q) {
                        $q->inDiscoveryGroup(DiscoveryGroup::Dining);
                    })->orWhere(function ($q) {
                        $q->inDiscoveryGroup(DiscoveryGroup::Accommodation);
                    });
                }),
        };
    }

    private function applyCategoryPatterns($query, array $patterns): void
    {
        foreach ($patterns as $index => $pattern) {
            if ($index === 0) {
                $query->whereRaw('LOWER(name) LIKE ?', [$pattern]);
            } else {
                $query->orWhereRaw('LOWER(name) LIKE ?', [$pattern]);
            }
        }
    }

    public function archive(): void
    {
        $this->update(['archived_at' => now()]);
    }

    public function unarchive(): void
    {
        $this->update(['archived_at' => null]);
    }

    public function getIsArchivedAttribute(): bool
    {
        return $this->archived_at !== null;
    }
}
