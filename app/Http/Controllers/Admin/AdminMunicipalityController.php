<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\StoreMunicipalityRequest;
use App\Http\Requests\Admin\UpdateMunicipalityRequest;
use App\Http\Resources\MunicipalityResource;
use App\Models\ActivityLog;
use App\Models\Municipality;
use App\Models\User;
use App\Services\MunicipalScopeService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rules\Password;

/**
 * District Super Admin (Bansud Tourism Office) management of the
 * municipalities under TrackTour and their Municipality Tourism Admin accounts.
 */
class AdminMunicipalityController extends Controller
{
    public function __construct(private MunicipalScopeService $scope) {}

    public function index(Request $request): JsonResponse
    {
        $query = Municipality::withCount([
            'barangays',
            'businesses',
            'riders',
            'tourismOfficers',
            'businesses as pending_businesses_count' => fn ($q) => $q->whereIn('status', MunicipalScopeService::PENDING_BUSINESS_STATUSES),
        ]);

        if ($search = $request->input('search')) {
            $query->where(function ($q) use ($search) {
                $q->where('name', 'like', "%{$search}%")
                    ->orWhere('district', 'like', "%{$search}%")
                    ->orWhere('province', 'like', "%{$search}%");
            });
        }

        $municipalities = $query->orderBy('name')->paginate(min(100, max(1, (int) $request->input('per_page', 24))));

        return $this->paginatedResponse(
            $municipalities->through(fn (Municipality $m) => $this->summary($m))
        );
    }

    public function show(Municipality $municipality): JsonResponse
    {
        $municipality->load([
            'barangays' => function ($query) {
                $query->with([
                    'businesses' => function ($bizQuery) {
                        $bizQuery->with('category')
                            ->where('status', 'approved')
                            ->orderBy('business_name');
                    },
                ])->orderBy('name');
            },
            'tourismOfficers.profile',
        ]);

        $totalBusinesses = $municipality->barangays->sum(fn ($b) => $b->businesses->count());
        $id = (int) $municipality->id;

        return $this->successResponse([
            'municipality' => array_merge(MunicipalityResource::make($municipality)->resolve(), [
                'is_home' => $municipality->isHome(),
            ]),
            'barangays' => $municipality->barangays->map(function ($barangay) {
                return [
                    'id' => $barangay->id,
                    'name' => $barangay->name,
                    'municipality_id' => $barangay->municipality_id,
                    'businesses' => $barangay->businesses->map(function ($business) {
                        return [
                            'id' => $business->id,
                            'business_name' => $business->business_name,
                            'category' => $business->category?->name,
                            'category_id' => $business->business_category_id,
                            'status' => $business->status,
                            'logo' => $business->logo,
                            'address' => $business->address,
                        ];
                    }),
                ];
            }),
            'admins' => $municipality->tourismOfficers->map(fn (User $u) => $this->adminSummary($u))->values(),
            'stats' => [
                'barangays_count' => $municipality->barangays->count(),
                'businesses_count' => $totalBusinesses,
                'all_businesses_count' => $this->scope->businesses($id)->count(),
                'pending_businesses_count' => $this->scope->businesses($id)->whereIn('status', MunicipalScopeService::PENDING_BUSINESS_STATUSES)->count(),
                'business_owners_count' => $this->scope->businessOwners($id)->count(),
                'riders_count' => $this->scope->riders($id)->count(),
                'pending_riders_count' => $this->scope->riders($id)->where('account_status', User::ACCOUNT_STATUS_PENDING)->count(),
                'tourists_count' => $this->scope->tourists($id)->count(),
                'admins_count' => $municipality->tourismOfficers->count(),
            ],
        ]);
    }

    public function store(StoreMunicipalityRequest $request): JsonResponse
    {
        $municipality = Municipality::create($request->only('name', 'district', 'province', 'latitude', 'longitude'));

        ActivityLog::record('municipality.created', sprintf('Added municipality "%s".', $municipality->name), $municipality);

        return $this->createdResponse(
            MunicipalityResource::make($municipality),
            'Municipality added successfully.'
        );
    }

    public function update(UpdateMunicipalityRequest $request, Municipality $municipality): JsonResponse
    {
        $before = $municipality->name;
        $municipality->update($request->only('name', 'district', 'province', 'latitude', 'longitude'));

        ActivityLog::record(
            'municipality.updated',
            $before === $municipality->name
                ? sprintf('Updated municipality "%s".', $municipality->name)
                : sprintf('Updated municipality "%s" (renamed to "%s").', $before, $municipality->name),
            $municipality
        );

        return $this->successResponse(
            MunicipalityResource::make($municipality->fresh()),
            'Municipality updated successfully.'
        );
    }

    /**
     * Soft-delete a municipality that has nothing attached to it. TrackTour's
     * home municipality can never be removed.
     */
    public function destroy(Municipality $municipality): JsonResponse
    {
        if ($municipality->isHome()) {
            return $this->errorResponse('Bansud is TrackTour\'s home municipality and cannot be deleted.', 422);
        }

        $attached = array_filter([
            'businesses' => $municipality->businesses()->count(),
            'riders' => $municipality->riders()->count(),
            'tourism office accounts' => $municipality->tourismOfficers()->count(),
        ]);

        if ($attached !== []) {
            $parts = collect($attached)->map(fn ($n, $label) => "{$n} {$label}")->implode(', ');

            return $this->errorResponse(
                "Cannot delete {$municipality->name} while it still has {$parts}. Reassign or remove them first.",
                422
            );
        }

        $municipality->delete();

        ActivityLog::record('municipality.deleted', sprintf('Deleted municipality "%s".', $municipality->name), $municipality);

        return $this->noContentResponse('Municipality deleted successfully.');
    }

    /**
     * Every Municipality Tourism Admin account across TrackTour, including
     * accounts that were removed from their municipality (unassigned).
     */
    public function accounts(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'municipality_id' => ['nullable', 'string', 'max:20'],
            'status' => ['nullable', 'in:approved,suspended,pending_review,rejected'],
            'search' => ['nullable', 'string', 'max:100'],
        ]);

        $base = fn () => User::query()->where('role', User::ROLE_TOURISM_OFFICE);
        $query = $base()->with(['profile', 'municipality' => fn ($q) => $q->withTrashed()]);

        if (($validated['municipality_id'] ?? '') === 'unassigned') {
            $query->whereNull('municipality_id');
        } elseif (! empty($validated['municipality_id'])) {
            $query->where('municipality_id', (int) $validated['municipality_id']);
        }

        if ($status = $validated['status'] ?? null) {
            $query->where('account_status', $status);
        }

        if ($search = $validated['search'] ?? null) {
            $query->where(function ($q) use ($search) {
                $q->where('email', 'like', "%{$search}%")
                    ->orWhere('name', 'like', "%{$search}%")
                    ->orWhereHas('profile', fn ($p) => $p->where('first_name', 'like', "%{$search}%")->orWhere('last_name', 'like', "%{$search}%"));
            });
        }

        $page = $query->orderBy('municipality_id')->latest()->paginate(20)->withQueryString()
            ->through(fn (User $u) => array_merge($this->adminSummary($u), [
                'municipality_id' => $u->municipality_id,
                'municipality' => $u->municipality?->name,
            ]));

        $covered = $base()->whereNotNull('municipality_id')->where('account_status', User::ACCOUNT_STATUS_APPROVED)
            ->distinct()->pluck('municipality_id');

        return $this->successResponse($page->items(), 'Municipality accounts retrieved successfully.', 200, [
            'current_page' => $page->currentPage(),
            'last_page' => $page->lastPage(),
            'per_page' => $page->perPage(),
            'total' => $page->total(),
            'stats' => [
                'total' => $base()->count(),
                'active' => $base()->whereNotNull('municipality_id')->where('account_status', User::ACCOUNT_STATUS_APPROVED)->count(),
                'suspended' => $base()->where('account_status', User::ACCOUNT_STATUS_SUSPENDED)->count(),
                'unassigned' => $base()->whereNull('municipality_id')->count(),
                'municipalities_without_account' => Municipality::query()
                    ->whereNotIn('id', $covered)
                    ->get(['id', 'name'])
                    ->reject(fn (Municipality $m) => $m->isHome())
                    ->count(),
            ],
        ]);
    }

    /** Create a Municipality Tourism Admin account for the chosen municipality. */
    public function storeAccount(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'municipality_id' => ['required', 'integer', \Illuminate\Validation\Rule::exists('municipalities', 'id')->whereNull('deleted_at')],
        ], [
            'municipality_id.required' => 'Choose the municipality this account will manage.',
            'municipality_id.exists' => 'Choose an active municipality.',
        ]);

        return $this->storeAdmin($request, Municipality::findOrFail($validated['municipality_id']));
    }

    /**
     * Assign an existing (typically removed) Tourism Office account to a
     * municipality and reactivate it.
     */
    public function assignAccount(Request $request, User $user): JsonResponse
    {
        if ($user->role !== User::ROLE_TOURISM_OFFICE) {
            return $this->notFoundResponse('Tourism Office account not found.');
        }

        $validated = $request->validate([
            'municipality_id' => ['required', 'integer', \Illuminate\Validation\Rule::exists('municipalities', 'id')->whereNull('deleted_at')],
        ]);
        $municipality = Municipality::findOrFail($validated['municipality_id']);

        DB::transaction(function () use ($user, $municipality) {
            $user->update([
                'municipality_id' => $municipality->id,
                'account_status' => User::ACCOUNT_STATUS_APPROVED,
            ]);
            $user->profile
                ? $user->profile->update(['municipality_id' => $municipality->id])
                : $user->profile()->create(['municipality_id' => $municipality->id, 'first_name' => $user->name]);
        });

        ActivityLog::record(
            'municipality.admin_assigned',
            sprintf('Assigned Tourism Office account (%s) to %s.', $user->email, $municipality->name),
            $user
        );

        return $this->successResponse(
            array_merge($this->adminSummary($user->fresh('profile')), ['municipality_id' => $municipality->id, 'municipality' => $municipality->name]),
            "{$user->email} now manages {$municipality->name}."
        );
    }

    /** Create a Municipality Tourism Admin account bound to this municipality. */
    public function storeAdmin(Request $request, Municipality $municipality): JsonResponse
    {
        $validated = $request->validate([
            'first_name' => ['required', 'string', 'max:100'],
            'last_name' => ['required', 'string', 'max:100'],
            'email' => ['required', 'email', 'max:255', 'unique:users,email'],
            'mobile_number' => ['nullable', 'string', 'max:20'],
            'password' => ['required', 'confirmed', Password::min(8)->letters()->numbers()],
        ]);

        $user = DB::transaction(function () use ($validated, $municipality) {
            $user = User::create([
                'name' => trim($validated['first_name'].' '.$validated['last_name']),
                'email' => strtolower($validated['email']),
                'password' => $validated['password'],
                'role' => User::ROLE_TOURISM_OFFICE,
                'account_status' => User::ACCOUNT_STATUS_APPROVED,
                'municipality_id' => $municipality->id,
                'email_verified_at' => now(),
            ]);

            $user->profile()->create([
                'first_name' => $validated['first_name'],
                'last_name' => $validated['last_name'],
                'mobile_number' => $validated['mobile_number'] ?? null,
                'municipality_id' => $municipality->id,
            ]);

            return $user;
        });

        ActivityLog::record(
            'municipality.admin_created',
            sprintf('Created Tourism Office account (%s) for %s.', $user->email, $municipality->name),
            $user
        );

        return $this->createdResponse(
            $this->adminSummary($user->load('profile')),
            "Tourism Office account created for {$municipality->name}."
        );
    }

    /**
     * Remove a Municipality Tourism Admin from this municipality: the account
     * loses its scope, is suspended, and every session token is revoked.
     */
    public function removeAdmin(Municipality $municipality, User $user): JsonResponse
    {
        if ($user->role !== User::ROLE_TOURISM_OFFICE || (int) $user->municipality_id !== (int) $municipality->id) {
            return $this->notFoundResponse('Tourism Office account not found for this municipality.');
        }

        DB::transaction(function () use ($user) {
            $user->update([
                'municipality_id' => null,
                'account_status' => User::ACCOUNT_STATUS_SUSPENDED,
            ]);
            $user->profile?->update(['municipality_id' => null]);
            $user->tokens()->delete();
        });

        ActivityLog::record(
            'municipality.admin_removed',
            sprintf('Removed Tourism Office account (%s) from %s.', $user->email, $municipality->name),
            $user
        );

        return $this->successResponse(null, "{$user->fullName} removed from {$municipality->name}.");
    }

    private function summary(Municipality $m): array
    {
        return array_merge(MunicipalityResource::make($m)->resolve(), [
            'is_home' => $m->isHome(),
            'barangays_count' => (int) $m->barangays_count,
            'businesses_count' => (int) $m->businesses_count,
            'pending_businesses_count' => (int) $m->pending_businesses_count,
            'riders_count' => (int) $m->riders_count,
            'admins_count' => (int) $m->tourism_officers_count,
        ]);
    }

    private function adminSummary(User $user): array
    {
        return [
            'id' => $user->id,
            'name' => $user->full_name,
            'email' => $user->email,
            'phone' => $user->profile?->mobile_number,
            'account_status' => $user->account_status,
            'created_at' => $user->created_at,
        ];
    }
}
