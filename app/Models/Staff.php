<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class Staff extends Model
{
    use SoftDeletes;

    /** Invited, not yet activated (cannot sign in). */
    public const STATUS_PENDING = 'pending';

    public const STATUS_ACTIVE = 'active';

    /** Deactivated by the owner (cannot sign in). */
    public const STATUS_INACTIVE = 'inactive';

    /** Suspended by the owner (cannot sign in). */
    public const STATUS_SUSPENDED = 'suspended';

    /** Removed (soft-deleted). */
    public const STATUS_ARCHIVED = 'archived';

    protected $fillable = [
        'business_id',
        'user_id',
        'staff_role_id',
        'status',
        'module_permissions',
        'employee_id',
        'middle_name',
        'suffix',
        'gender',
        'date_of_birth',
        'mobile_number',
        'address',
        'profile_picture',
        'date_hired',
        'salary_type',
        'employment_status',
        'last_login_at',
        'last_login_ip',
        'two_factor_enabled',
    ];

    protected function casts(): array
    {
        return [
            'module_permissions' => 'array',
            'date_of_birth' => 'date',
            'date_hired' => 'date',
            'last_login_at' => 'datetime',
            'two_factor_enabled' => 'boolean',
        ];
    }

    protected static function booted(): void
    {
        static::creating(function (Staff $staff) {
            if (empty($staff->employee_id)) {
                $staff->employee_id = self::generateEmployeeId();
            }
        });
    }

    public static function generateEmployeeId(): string
    {
        $last = self::withTrashed()->orderByDesc('id')->value('employee_id');
        if ($last && preg_match('/EMP-(\d+)/', $last, $m)) {
            $next = (int) $m[1] + 1;
        } else {
            $next = 1;
        }

        return 'EMP-'.str_pad($next, 5, '0', STR_PAD_LEFT);
    }

    public function business(): BelongsTo
    {
        return $this->belongsTo(Business::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function staffRole(): BelongsTo
    {
        return $this->belongsTo(StaffRole::class);
    }

    public function permissions(): HasMany
    {
        return $this->hasMany(RolePermission::class, 'staff_role_id', 'staff_role_id');
    }

    public function hasModuleAccess(string $moduleCode, string $action = 'can_view'): bool
    {
        if (! $this->staffRole) {
            return false;
        }

        $permission = RolePermission::where('staff_role_id', $this->staff_role_id)
            ->where('module_code', $moduleCode)
            ->first();

        return $permission ? $permission->{$action} : false;
    }

    public function invitations(): HasMany
    {
        return $this->hasMany(StaffInvitation::class);
    }

    public function activityLogs(): HasMany
    {
        return $this->hasMany(StaffActivityLog::class);
    }

    /** All roles held (an employee may have several; staff_role_id is the first). */
    public function roles(): BelongsToMany
    {
        return $this->belongsToMany(StaffRole::class, 'staff_role_assignments')->withTimestamps();
    }

    /**
     * Permission keys this staff member holds: the union of their roles'
     * grants (plus the primary role's), catalogue keys only.
     *
     * @return list<string>
     */
    public function grantedPermissions(): array
    {
        $roleIds = $this->roles()->pluck('staff_roles.id')->push($this->staff_role_id)->filter()->unique();
        $granted = StaffRolePermission::whereIn('staff_role_id', $roleIds)->pluck('permission');

        return \App\Support\StaffPermissions::effective($granted);
    }

    /** @return list<string> role names, primary first */
    public function roleNames(): array
    {
        $names = $this->roles()->orderBy('staff_role_assignments.id')->pluck('name')->all();
        $primary = $this->staffRole?->name;

        return array_values(array_unique(array_filter([$primary, ...$names])));
    }

    public function getAccessibleModulesAttribute(): array
    {
        return $this->module_permissions ?? [];
    }

    public function getFullNameAttribute(): string
    {
        // No double space where the middle name is missing ("Maria  Santos").
        $name = trim(preg_replace('/\s+/', ' ', ($this->user->profile?->first_name ?? '').' '.($this->middle_name ?? '').' '.($this->user->profile?->last_name ?? '')));

        return $name ?: ($this->user->email ?? 'Unknown');
    }

    public function getInitialsAttribute(): string
    {
        $first = substr($this->user->profile?->first_name ?? '', 0, 1);
        $last = substr($this->user->profile?->last_name ?? '', 0, 1);

        return strtoupper($first.$last);
    }

    public function getProfilePictureUrlAttribute(): ?string
    {
        if ($this->profile_picture) {
            return \Storage::url($this->profile_picture);
        }

        return null;
    }

    public function getStatusLabelAttribute(): string
    {
        return match ($this->status) {
            'pending' => 'Invitation pending',
            'active' => 'Active',
            'inactive' => 'Inactive',
            'suspended' => 'Suspended',
            'archived' => 'Archived',
            default => ucfirst($this->status),
        };
    }

    public function getStatusColorAttribute(): string
    {
        return match ($this->status) {
            'pending' => 'amber',
            'active' => 'emerald',
            'inactive' => 'gray',
            'suspended' => 'red',
            'archived' => 'amber',
            default => 'gray',
        };
    }
}
