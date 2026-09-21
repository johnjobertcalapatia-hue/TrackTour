<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\StoreMunicipalityRequest;
use App\Http\Requests\Admin\UpdateMunicipalityRequest;
use App\Http\Resources\MunicipalityResource;
use App\Models\Municipality;
use App\Models\User;
use App\Models\UserProfile;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AdminMunicipalityController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $municipalities = Municipality::withCount('barangays')
            ->with('tourismOfficers')
            ->latest()
            ->paginate(15);

        return $this->paginatedResponse(
            $municipalities->through(fn ($m) => MunicipalityResource::make($m))
        );
    }

    public function store(StoreMunicipalityRequest $request): JsonResponse
    {
        $municipality = Municipality::create($request->only('name', 'province'));

        return $this->createdResponse(
            MunicipalityResource::make($municipality),
            'Municipality added successfully.'
        );
    }

    public function update(UpdateMunicipalityRequest $request, Municipality $municipality): JsonResponse
    {
        $municipality->update($request->only('name', 'province'));

        return $this->successResponse(
            MunicipalityResource::make($municipality->fresh()),
            'Municipality updated successfully.'
        );
    }

    public function destroy(Municipality $municipality): JsonResponse
    {
        $municipality->delete();

        return $this->noContentResponse('Municipality deleted successfully.');
    }

    public function assignAdmin(Request $request, Municipality $municipality): JsonResponse
    {
        $request->validate([
            'user_id' => ['required', 'exists:users,id'],
        ]);

        $user = User::findOrFail($request->user_id);
        $profile = $user->profile ?? UserProfile::create(['user_id' => $user->id]);
        $profile->update(['municipality_id' => $municipality->id]);

        return $this->successResponse(
            MunicipalityResource::make($municipality->fresh()),
            "{$user->fullName} assigned to {$municipality->name}."
        );
    }

    public function removeAdmin(Municipality $municipality, User $user): JsonResponse
    {
        if ($profile = $user->profile) {
            $profile->update(['municipality_id' => null]);
        }

        return $this->successResponse(
            MunicipalityResource::make($municipality),
            "{$user->fullName} removed from {$municipality->name}."
        );
    }
}
