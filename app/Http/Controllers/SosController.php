<?php

namespace App\Http\Controllers;

use App\Exceptions\SosException;
use App\Models\Delivery;
use App\Models\Order;
use App\Models\SosAlert;
use App\Services\SosAlertService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * SOS from a trip (2026-11-18): tourists during a ride, riders during any
 * trip. The alert goes to the trip's municipal Tourism Office and the Bansud
 * Tourism Office (Municipal Office plan Stage 3); the other party on the
 * trip is never told.
 */
class SosController extends Controller
{
    public function __construct(private SosAlertService $sos) {}

    private function location(Request $request): array
    {
        return $request->validate([
            'latitude' => ['nullable', 'numeric', 'between:-90,90', 'required_with:longitude'],
            'longitude' => ['nullable', 'numeric', 'between:-180,180', 'required_with:latitude'],
            'accuracy' => ['nullable', 'numeric', 'min:0', 'max:100000'],
            'message' => ['nullable', 'string', 'max:500'],
        ]);
    }

    private function sent(SosAlert $alert, bool $created): JsonResponse
    {
        return $this->successResponse(
            ['sos' => $alert->presentForSender()],
            // Municipal Office plan Stage 3: the trip's town office and the Bansud Tourism Office.
            $created ? 'SOS sent to the Tourism Office.' : 'Your SOS is still open. Location updated.',
            $created ? 201 : 200,
        );
    }

    /** POST /tourist/transport/trip/{id}/sos */
    public function touristRaise(Request $request, int $id): JsonResponse
    {
        $data = $this->location($request);
        $trip = Order::where('customer_email', $request->user()->email)->where('order_type', 'transport')->findOrFail($id);
        try {
            [$alert, $created] = $this->sos->raiseForRide($request->user(), $trip, $data, $data['message'] ?? null);
        } catch (SosException $e) {
            return $this->errorResponse($e->getMessage(), $e->status);
        }

        return $this->sent($alert, $created);
    }

    /** POST /tourist/transport/trip/{id}/sos/safe */
    public function touristSafe(Request $request, int $id): JsonResponse
    {
        $trip = Order::where('customer_email', $request->user()->email)->where('order_type', 'transport')->findOrFail($id);
        $alert = $this->sos->latestFor($request->user(), $trip->delivery()->value('id'));

        return $this->safe($request, $alert);
    }

    /** POST /rider/deliveries/{delivery}/sos */
    public function riderRaise(Request $request, Delivery $delivery): JsonResponse
    {
        $data = $this->location($request);
        try {
            [$alert, $created] = $this->sos->raiseForRider($request->user(), $delivery, $data, $data['message'] ?? null);
        } catch (SosException $e) {
            return $this->errorResponse($e->getMessage(), $e->status);
        }

        return $this->sent($alert, $created);
    }

    /** GET /rider/deliveries/{delivery}/sos — the rider's own SOS on this trip, if any. */
    public function riderShow(Request $request, Delivery $delivery): JsonResponse
    {
        if ((int) $delivery->rider_id !== (int) $request->user()->id) {
            return $this->errorResponse('This trip is not yours.', 403);
        }

        return $this->successResponse(['sos' => $this->sos->latestFor($request->user(), $delivery->id)?->presentForSender()]);
    }

    /** POST /rider/deliveries/{delivery}/sos/safe */
    public function riderSafe(Request $request, Delivery $delivery): JsonResponse
    {
        if ((int) $delivery->rider_id !== (int) $request->user()->id) {
            return $this->errorResponse('This trip is not yours.', 403);
        }

        return $this->safe($request, $this->sos->latestFor($request->user(), $delivery->id));
    }

    private function safe(Request $request, ?SosAlert $alert): JsonResponse
    {
        if (! $alert) {
            return $this->errorResponse('There is no SOS on this trip.', 404);
        }
        try {
            $alert = $this->sos->markSafe($request->user(), $alert);
        } catch (SosException $e) {
            return $this->errorResponse($e->getMessage(), $e->status);
        }

        return $this->successResponse(['sos' => $alert->presentForSender()], 'Thanks. The Tourism Office will confirm and close your SOS.');
    }
}
