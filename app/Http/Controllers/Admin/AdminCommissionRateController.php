<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\ActivityLog;
use App\Models\Municipality;
use App\Services\CommissionRateSettings;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Bansud super admin — commission rates (Earnings Stage 1, §R2):
 * sets the district defaults and the TrackTour share, sets Bansud's own
 * rates, and views every municipality's rates. Other towns' rates are set
 * by their own offices (MunicipalCommissionRateController).
 */
class AdminCommissionRateController extends Controller
{
    public function __construct(private CommissionRateSettings $rates) {}

    /** GET /admin/commission-rates */
    public function index(): JsonResponse
    {
        $towns = Municipality::orderBy('name')->get(['id', 'name', 'logo'])->map(function (Municipality $m) {
            $overrides = $this->rates->overrides((int) $m->id);

            return [
                'id' => $m->id,
                'name' => $m->name,
                'is_home' => $m->isHome(),
                'can_edit' => $m->isHome(),
                'effective' => $this->rates->effective((int) $m->id),
                'overrides' => $overrides,
                'has_own_rates' => collect($overrides)->contains(fn ($v) => $v !== null),
            ];
        })->values();

        return $this->successResponse([
            'district' => $this->rates->district(),
            'municipalities' => $towns,
            'fields' => [
                'town' => CommissionRateSettings::TOWN_FIELDS,
                'district' => CommissionRateSettings::DISTRICT_FIELDS,
            ],
        ]);
    }

    /** PUT /admin/commission-rates — the district defaults. */
    public function updateDistrict(Request $request): JsonResponse
    {
        $validated = $request->validate($this->rates->districtRules());
        [$before, $after] = $this->rates->saveDistrict($validated);
        $changes = CommissionRateSettings::describeChanges($before, $after);

        ActivityLog::record(
            'commission_rates.district_updated',
            $changes !== []
                ? 'District commission rates updated ('.implode(', ', $changes).').'
                : 'District commission rates saved (values unchanged).',
            null,
            ActivityLog::TYPE_SETTINGS
        );

        return $this->successResponse($after, 'District commission rates saved.');
    }

    /** PUT /admin/commission-rates/municipalities/{municipality} — Bansud's own rates only. */
    public function updateTown(Request $request, Municipality $municipality): JsonResponse
    {
        if (! $municipality->isHome()) {
            return $this->errorResponse("Each municipality's tourism office sets its own rates. You can view them here.", 403);
        }

        $validated = $request->validate($this->rates->townRules());
        [$before, $after] = $this->rates->saveTown((int) $municipality->id, $validated);
        $changes = CommissionRateSettings::describeChanges($before, $after);

        ActivityLog::record(
            'commission_rates.town_updated',
            sprintf('%s commission rates %s.', $municipality->name, $changes !== [] ? 'updated ('.implode(', ', $changes).')' : 'saved (values unchanged)'),
            $municipality,
            ActivityLog::TYPE_SETTINGS
        );

        return $this->successResponse([
            'effective' => $after,
            'overrides' => $this->rates->overrides((int) $municipality->id),
        ], "{$municipality->name} commission rates saved.");
    }
}
