<?php

namespace App\Http\Controllers\BusinessOwner;

use App\Http\Controllers\Controller;
use App\Models\Business;
use App\Models\Staff;
use App\Models\StaffActivityLog;
use App\Models\StaffRole;
use App\Models\StaffRolePermission;
use App\Support\StaffPermissions;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Business owner — Roles & Permissions (Staff Management §6,
 * docs/staff-management-plan.md). Built-in roles (templates shared by every
 * business of a type) are read-only; the owner adds custom roles for one
 * business and chooses which modules they can manage. Owner only: staff never
 * reach these routes (managing staff is never grantable).
 */
class BusinessOwnerRoleController extends Controller
{
    public const MAX_CUSTOM_ROLES = 20;

    /** GET /business-owner/roles?business_id= — roles, modules and who holds each role. */
    public function index(Request $request): JsonResponse
    {
        $business = $this->ownedBusiness($request, $request->query('business_id'));
        if (! $business) {
            return $this->errorResponse('Business not found.', 404);
        }

        $category = $business->category?->name;
        $grantable = StaffPermissions::grantableForCategory($category);
        $roles = $this->builtInRoles($business)->concat($this->customRoles($business));
        $roles->load('grants');
        $holders = $this->holdersByRole($business, $roles->modelKeys());

        $rows = $roles->map(fn (StaffRole $role) => $this->roleRow($role, $holders[$role->id] ?? []));

        return $this->successResponse([
            'business' => ['id' => $business->id, 'name' => $business->business_name, 'category' => $category],
            'modules' => collect(StaffPermissions::modulesForCategory($category))->map(fn ($key) => [
                'key' => $key,
                'label' => StaffPermissions::MODULES[$key][0],
                'description' => StaffPermissions::MODULES[$key][1],
                'permissions' => collect(StaffPermissions::MODULES[$key][2])
                    ->filter(fn ($p) => in_array($p, $grantable, true))
                    ->map(fn ($p) => ['key' => $p, 'label' => StaffPermissions::CATALOGUE[$p][1]])->values(),
            ])->values(),
            'owner_only' => StaffPermissions::OWNER_ONLY_LABELS,
            'built_in' => $rows->where('is_custom', false)->values(),
            'custom' => $rows->where('is_custom', true)->values(),
            'max_custom_roles' => self::MAX_CUSTOM_ROLES,
        ]);
    }

    /**
     * GET /business-owner/staff/roles?business_id= — the roles the owner may
     * give staff of this business: its built-in roles plus its own custom roles.
     */
    public function offered(Request $request): JsonResponse
    {
        $business = $this->ownedBusiness($request, $request->query('business_id'));
        $roles = $business
            ? $this->builtInRoles($business)->concat($this->customRoles($business))
            : collect();

        return $this->successResponse(
            $roles->map(fn (StaffRole $r) => ['id' => $r->id, 'name' => $r->name, 'description' => $r->description, 'is_custom' => $r->isCustom()])->values(),
            'Staff roles retrieved.'
        );
    }

    /** POST /business-owner/roles — add a custom role to one of the owner's businesses. */
    public function store(Request $request): JsonResponse
    {
        $business = $this->ownedBusiness($request, $request->input('business_id'));
        if (! $business) {
            return $this->errorResponse('Business not found.', 404);
        }
        if (StaffRole::where('business_id', $business->id)->count() >= self::MAX_CUSTOM_ROLES) {
            return $this->errorResponse('A business can have up to '.self::MAX_CUSTOM_ROLES.' custom roles.', 422);
        }

        $data = $this->validated($request, $business);

        $role = DB::transaction(function () use ($business, $data, $request) {
            $role = StaffRole::create([
                'business_id' => $business->id,
                'name' => $data['name'],
                'description' => $data['description'],
                'created_by' => $request->user()->id,
            ]);
            $this->syncGrants($role, $data['permissions']);

            return $role;
        });

        return $this->successResponse($this->roleRow($role->load('grants'), []), 'Role created.', 201);
    }

    /**
     * PUT /business-owner/roles/{role} — rename a custom role or change what
     * it can manage. Takes effect at once for everyone holding it; each of
     * them gets an activity entry with their permissions before and after.
     */
    public function update(Request $request, StaffRole $role): JsonResponse
    {
        if ($error = $this->editableError($request, $role)) {
            return $error;
        }

        $data = $this->validated($request, $role->business, $role);
        $holders = $role->holders()->with('user.profile')->get();
        $before = $holders->mapWithKeys(fn (Staff $s) => [$s->id => $s->grantedPermissions()]);
        $oldName = $role->name;

        DB::transaction(function () use ($role, $data, $holders, $before, $oldName, $request) {
            $role->update(['name' => $data['name'], 'description' => $data['description']]);
            $this->syncGrants($role, $data['permissions']);

            foreach ($holders as $staff) {
                $after = $staff->grantedPermissions();
                $was = $before[$staff->id];
                if (array_diff($was, $after) === [] && array_diff($after, $was) === [] && $oldName === $role->name) {
                    continue;
                }
                StaffActivityLog::record($staff, 'staff.role_permissions_changed',
                    "The {$role->name} role was changed, which updates {$staff->full_name}'s access.", [
                        'role' => $role->name,
                        'role_renamed_from' => $oldName !== $role->name ? $oldName : null,
                        'permissions_before' => $was,
                        'permissions_after' => $after,
                    ], $request->user());
            }
        });

        $holderRows = $this->holdersByRole($role->business, [$role->id]);

        return $this->successResponse($this->roleRow($role->fresh('grants'), $holderRows[$role->id] ?? []), 'Role updated.');
    }

    /** DELETE /business-owner/roles/{role} — only a custom role nobody holds. */
    public function destroy(Request $request, StaffRole $role): JsonResponse
    {
        if ($error = $this->editableError($request, $role)) {
            return $error;
        }
        $held = $role->holders()->count();
        if ($held > 0) {
            return $this->errorResponse("{$held} staff ".($held === 1 ? 'member still has' : 'members still have').' this role. Give them another role first.', 422);
        }

        $role->delete();

        return $this->successResponse(null, 'Role deleted.');
    }

    // ------------------------------------------------------------------ helpers

    private function ownedBusiness(Request $request, mixed $businessId): ?Business
    {
        $query = $request->user()->businesses()->with('category');

        return $businessId !== null && $businessId !== ''
            ? $query->whereKey((int) $businessId)->first()
            : $query->orderBy('id')->first();
    }

    /** Built-in roles offered for the business type (every built-in role when the type has none set). */
    private function builtInRoles(Business $business): Collection
    {
        $offered = $business->category?->staffRoles()->builtIn()->orderBy('staff_roles.id')->get();

        return $offered && $offered->isNotEmpty() ? $offered : StaffRole::builtIn()->orderBy('id')->get();
    }

    private function customRoles(Business $business): Collection
    {
        return StaffRole::where('business_id', $business->id)->orderBy('name')->get();
    }

    private function editableError(Request $request, StaffRole $role): ?JsonResponse
    {
        if (! $role->isCustom()) {
            return $this->errorResponse('Built-in roles can\'t be changed. Duplicate it to make your own role.', 403);
        }
        if ((int) $role->business?->owner_id !== (int) $request->user()->id) {
            return $this->errorResponse('Role not found.', 404);
        }

        return null;
    }

    /** @return array{name: string, description: ?string, permissions: list<string>} */
    private function validated(Request $request, Business $business, ?StaffRole $role = null): array
    {
        $request->merge(['name' => trim((string) $request->input('name'))]);
        $grantable = StaffPermissions::grantableForCategory($business->category?->name);

        $data = $request->validate([
            'name' => ['required', 'string', 'min:2', 'max:50'],
            'description' => ['nullable', 'string', 'max:255'],
            'permissions' => ['required', 'array', 'min:1'],
            'permissions.*' => ['string', 'distinct', Rule::in($grantable)],
        ], [
            'permissions.required' => 'Choose at least one module this role can manage.',
            'permissions.min' => 'Choose at least one module this role can manage.',
            'permissions.*.in' => 'That permission is not available for this business.',
        ]);

        $name = mb_strtolower($data['name']);
        $taken = StaffRole::where(fn ($q) => $q->whereNull('business_id')->orWhere('business_id', $business->id))
            ->when($role, fn ($q) => $q->whereKeyNot($role->id))
            ->pluck('name')
            ->contains(fn ($n) => mb_strtolower($n) === $name);
        if ($taken) {
            throw ValidationException::withMessages(['name' => 'A role with this name already exists.']);
        }

        return [
            'name' => $data['name'],
            'description' => isset($data['description']) && trim($data['description']) !== '' ? trim($data['description']) : null,
            'permissions' => StaffPermissions::withImplied($data['permissions']),
        ];
    }

    /** @param list<string> $permissions */
    private function syncGrants(StaffRole $role, array $permissions): void
    {
        StaffRolePermission::where('staff_role_id', $role->id)->whereNotIn('permission', $permissions)->delete();
        $now = now();
        StaffRolePermission::insertOrIgnore(array_map(
            fn ($p) => ['staff_role_id' => $role->id, 'permission' => $p, 'created_at' => $now, 'updated_at' => $now],
            $permissions
        ));
    }

    /**
     * Staff of this business holding each role (as any of their roles or as the primary role).
     *
     * @param  list<int>  $roleIds
     * @return array<int, list<array{id: int, name: string, status: string}>>
     */
    private function holdersByRole(Business $business, array $roleIds): array
    {
        $staff = Staff::where('business_id', $business->id)->with('user.profile', 'roles')->get();
        $byRole = [];
        foreach ($staff as $member) {
            $held = $member->roles->modelKeys();
            $held[] = $member->staff_role_id;
            foreach (array_unique(array_filter($held)) as $roleId) {
                if (in_array((int) $roleId, $roleIds, true)) {
                    $byRole[(int) $roleId][] = ['id' => $member->id, 'name' => $member->full_name, 'status' => $member->status];
                }
            }
        }

        return $byRole;
    }

    private function roleRow(StaffRole $role, array $holders): array
    {
        $permissions = StaffPermissions::effective($role->grants->pluck('permission'));
        $modules = collect(StaffPermissions::MODULES)
            ->filter(fn ($module) => array_intersect($module[2], $permissions) !== [])
            ->keys()->values();

        return [
            'id' => $role->id,
            'name' => $role->name,
            'description' => $role->description,
            'is_custom' => $role->isCustom(),
            'permissions' => array_values(array_intersect(StaffPermissions::all(), $permissions)),
            'modules' => $modules,
            'staff_count' => count($holders),
            'staff' => $holders,
        ];
    }
}
