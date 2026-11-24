<?php

namespace App\Http\Controllers\Municipal;

use App\Models\ActivityLog;
use App\Services\CommissionRateSettings;
use App\Services\MunicipalScopeService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Municipal Tourism Office — its own town's commission rates (Earnings
 * Stage 1, §R2). A blank field uses the Bansud district default. The
 * TrackTour share and the Fast Delivery amounts are district-wide and shown
 * read-only. Other towns' rates are never returned.
 */
class MunicipalCommissionRateController extends MunicipalController
{
    public function __construct(MunicipalScopeService $scope, private CommissionRateSettings $rates)
    {
        parent::__construct($scope);
    }

    /** GET /municipal/commission-rates */
    public function show(Request $request): JsonResponse
    {
        $id = $this->municipalityId($request);
        $district = $this->rates->district();

        return $this->successResponse([
            'municipality' => ['id' => $id, 'name' => $this->municipality($request)->name],
            'effective' => $this->rates->effective($id),
            'overrides' => $this->rates->overrides($id),
            'district_defaults' => $district['rates'],
            // Bansud's limits: this office's own values must stay inside them.
            'limits' => $district['limits'],
            'fields' => [
                'town' => CommissionRateSettings::TOWN_FIELDS,
                'district' => CommissionRateSettings::DISTRICT_FIELDS,
            ],
        ]);
    }

    /** PUT /municipal/commission-rates */
    public function update(Request $request): JsonResponse
    {
        $id = $this->municipalityId($request);
        $validated = $request->validate($this->rates->townRules());
        [$before, $after] = $this->rates->saveTown($id, $validated);
        $changes = CommissionRateSettings::describeChanges($before, $after);
        $name = $this->municipality($request)->name;

        ActivityLog::record(
            'commission_rates.town_updated',
            sprintf('%s commission rates %s.', $name, $changes !== [] ? 'updated ('.implode(', ', $changes).')' : 'saved (values unchanged)'),
            $this->municipality($request),
            ActivityLog::TYPE_SETTINGS
        );

        return $this->successResponse([
            'effective' => $after,
            'overrides' => $this->rates->overrides($id),
        ], "{$name} commission rates saved.");
    }
}
