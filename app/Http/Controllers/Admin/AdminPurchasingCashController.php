<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\Delivery;
use App\Services\PurchasingCashService;
use Illuminate\Http\JsonResponse;
use InvalidArgumentException;

/**
 * Tourism Office purchasing-cash issuance for COD deliveries (professor model).
 *
 * After a rider accepts a COD delivery, the office supplies the physical cash
 * the rider needs to buy the food from the participating restaurants. The
 * issue amount is precomputed by PurchasingCashService to always equal
 * order.rider_financed_amount, the settlement base (AGENTS.md §5.3).
 */
class AdminPurchasingCashController extends Controller
{
    public function __construct(
        private PurchasingCashService $purchasingCash
    ) {}

    /**
     * POST /admin/deliveries/{delivery}/issue-purchasing-cash
     */
    public function issue(Delivery $delivery): JsonResponse
    {
        try {
            $issued = $this->purchasingCash->issuePurchasingCash($delivery, (int) auth()->id());
        } catch (InvalidArgumentException $e) {
            return $this->errorResponse($e->getMessage(), 422);
        }

        return $this->successResponse($issued, 'Purchasing cash issued.');
    }
}