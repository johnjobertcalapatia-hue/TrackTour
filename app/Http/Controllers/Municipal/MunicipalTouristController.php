<?php

namespace App\Http\Controllers\Municipal;

use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Read-only view of tourists who have ordered from, or booked with, a business
 * in the municipality. Tourist accounts are district-wide, so suspension stays
 * with the District Super Admin (/admin/users).
 */
class MunicipalTouristController extends MunicipalController
{
    public function index(Request $request): JsonResponse
    {
        $id = $this->municipalityId($request);

        $query = $this->scope->tourists($id)->with('profile');

        if ($search = $request->input('search')) {
            $query->where(function ($q) use ($search) {
                $q->where('users.email', 'like', "%{$search}%")
                    ->orWhere('users.name', 'like', "%{$search}%")
                    ->orWhereHas('profile', fn ($p) => $p->where('first_name', 'like', "%{$search}%")
                        ->orWhere('last_name', 'like', "%{$search}%"));
            });
        }

        $page = $query->latest()->paginate(15)->withQueryString();

        $userIds = collect($page->items())->pluck('id');
        $orderCounts = $this->orderQuery($id)->whereIn('user_id', $userIds)
            ->selectRaw('user_id, COUNT(*) as aggregate, MAX(created_at) as last_at')
            ->groupBy('user_id')->get()->keyBy('user_id');
        $bookingCounts = $this->bookingQuery($id)->whereIn('bookings.user_id', $userIds)
            ->selectRaw('bookings.user_id, COUNT(*) as aggregate, MAX(bookings.created_at) as last_at')
            ->groupBy('bookings.user_id')->get()->keyBy('user_id');

        $page->through(fn (User $tourist) => $this->summary(
            $tourist,
            (int) ($orderCounts[$tourist->id]->aggregate ?? 0),
            (int) ($bookingCounts[$tourist->id]->aggregate ?? 0),
            collect([$orderCounts[$tourist->id]->last_at ?? null, $bookingCounts[$tourist->id]->last_at ?? null])->filter()->max()
        ));

        return $this->paginatedWithStats($page, [
            'total' => $this->scope->tourists($id)->count(),
        ], 'Tourists retrieved successfully.');
    }

    public function show(Request $request, User $tourist): JsonResponse
    {
        $id = $this->municipalityId($request);
        if (! $this->covers($request, $tourist, User::ROLE_TOURIST)) {
            return $this->notFoundResponse('Tourist not found.');
        }

        $tourist->load('profile');

        $orders = $this->orderQuery($id)
            ->where('user_id', $tourist->id)
            ->orderByDesc('created_at')
            ->limit(20)
            ->get(['id', 'order_number', 'business_id', 'status', 'payment_method', 'total', 'created_at']);
        $businessNames = DB::table('businesses')
            ->whereIn('id', $orders->pluck('business_id')->filter())
            ->pluck('business_name', 'id');

        $bookings = $this->bookingQuery($id)
            ->where('bookings.user_id', $tourist->id)
            ->orderByDesc('bookings.created_at')
            ->limit(20)
            ->get([
                'bookings.id', 'bookings.booking_number', 'bookings.status', 'bookings.booking_type',
                'bookings.check_in_date', 'bookings.total_amount', 'bookings.created_at', 'businesses.business_name',
            ]);

        return $this->successResponse([
            'tourist' => $this->summary(
                $tourist,
                $this->orderQuery($id)->where('user_id', $tourist->id)->count(),
                $this->bookingQuery($id)->where('bookings.user_id', $tourist->id)->count(),
                null
            ),
            'orders' => $orders->map(fn ($o) => [
                'id' => $o->id,
                'order_number' => $o->order_number,
                'business_name' => $businessNames[$o->business_id] ?? 'Group order',
                'status' => $o->status,
                'payment_method' => $o->payment_method,
                'total' => (float) $o->total,
                'created_at' => $o->created_at,
            ]),
            'bookings' => $bookings->map(fn ($b) => [
                'id' => $b->id,
                'booking_number' => $b->booking_number,
                'business_name' => $b->business_name,
                'booking_type' => $b->booking_type,
                'status' => $b->status,
                'check_in_date' => $b->check_in_date,
                'total_amount' => (float) $b->total_amount,
                'created_at' => $b->created_at,
            ]),
        ]);
    }

    private function orderQuery(int $municipalityId)
    {
        return DB::table('orders')
            ->whereIn('id', $this->scope->orderIds($municipalityId))
            ->whereNull('deleted_at');
    }

    private function bookingQuery(int $municipalityId)
    {
        return DB::table('bookings')
            ->join('businesses', 'businesses.id', '=', 'bookings.business_id')
            ->where('businesses.municipality_id', $municipalityId)
            ->whereNull('bookings.deleted_at');
    }

    private function summary(User $tourist, int $orders, int $bookings, ?string $lastActivity): array
    {
        $profile = $tourist->profile;

        return [
            'id' => $tourist->id,
            'name' => $tourist->full_name,
            'email' => $tourist->email,
            'phone' => $profile?->mobile_number,
            'nationality' => $profile?->nationality,
            'account_status' => $tourist->account_status,
            'created_at' => $tourist->created_at,
            'orders_count' => $orders,
            'bookings_count' => $bookings,
            'last_activity_at' => $lastActivity,
        ];
    }
}
