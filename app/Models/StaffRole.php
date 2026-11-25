<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;

class StaffRole extends Model
{
    protected $fillable = [
        'business_id',
        'name',
        'description',
        'created_by',
    ];

    /** Custom role of one business (Staff Management §6); null for built-in roles (templates). */
    public function business(): BelongsTo
    {
        return $this->belongsTo(Business::class);
    }

    public function isCustom(): bool
    {
        return $this->business_id !== null;
    }

    /** Built-in roles only (templates shared by every business of a type). */
    public function scopeBuiltIn(Builder $query): Builder
    {
        return $query->whereNull('staff_roles.business_id');
    }

    /** Staff holding this role (any of their roles, or their primary role). */
    public function holders(): Builder
    {
        return Staff::query()->where(fn ($q) => $q->where('staff_role_id', $this->id)
            ->orWhereHas('roles', fn ($r) => $r->where('staff_roles.id', $this->id)));
    }

    public function businessCategories(): BelongsToMany
    {
        return $this->belongsToMany(BusinessCategory::class, 'business_category_staff_role');
    }

    public function staff(): HasMany
    {
        return $this->hasMany(Staff::class);
    }

    public function permissions(): HasMany
    {
        return $this->hasMany(RolePermission::class);
    }

    /** Staff Management Stage 1 grants: permission keys (App\Support\StaffPermissions). */
    public function grants(): HasMany
    {
        return $this->hasMany(StaffRolePermission::class);
    }

    /** @return list<string> */
    public function grantedPermissions(): array
    {
        return $this->grants()->pluck('permission')->all();
    }

    public function hasPermission(string $moduleCode, string $action = 'can_view'): bool
    {
        $permission = $this->permissions()->where('module_code', $moduleCode)->first();

        return $permission ? $permission->{$action} : false;
    }

    public function getPermissionsByModule(): array
    {
        return $this->permissions->groupBy('module_code')->map(function ($perms) {
            return $perms->first();
        })->toArray();
    }
}
