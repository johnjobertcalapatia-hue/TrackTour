<?php

namespace App\Http\Controllers\BusinessOwner;

use App\Http\Controllers\Controller;
use App\Models\Booking;
use App\Models\Offering;
use App\Models\OfferingCategory;
use App\Models\Order;
use App\Models\Promotion;
use App\Models\Staff;
use App\Models\BusinessMedia;
use App\Models\BusinessDocument;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;

class BusinessOwnerArchiveController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        $businessIds = $user->businesses()->pluck('id');

        $archivedOfferings = Offering::onlyTrashed()
            ->whereIn('business_id', $businessIds)
            ->get()
            ->map(fn ($m) => ['id' => $m->id, 'type' => 'offering', 'name' => $m->name, 'business_id' => $m->business_id, 'deleted_at' => $m->deleted_at]);

        $archivedPromotions = Promotion::onlyTrashed()
            ->whereIn('business_id', $businessIds)
            ->get()
            ->map(fn ($m) => ['id' => $m->id, 'type' => 'promotion', 'name' => $m->name, 'business_id' => $m->business_id, 'deleted_at' => $m->deleted_at]);

        $archivedOrders = Order::onlyTrashed()
            ->whereIn('business_id', $businessIds)
            ->get()
            ->map(fn ($m) => ['id' => $m->id, 'type' => 'order', 'name' => ($m->order_number ?? 'Order #'.$m->id), 'business_id' => $m->business_id, 'deleted_at' => $m->deleted_at]);

        $archivedBookings = Booking::onlyTrashed()
            ->whereIn('business_id', $businessIds)
            ->get()
            ->map(fn ($m) => ['id' => $m->id, 'type' => 'booking', 'name' => ($m->booking_number ?? 'Booking #'.$m->id), 'business_id' => $m->business_id, 'deleted_at' => $m->deleted_at]);

        $archivedStaff = Staff::onlyTrashed()
            ->whereIn('business_id', $businessIds)
            ->get()
            ->map(fn ($m) => ['id' => $m->id, 'type' => 'staff', 'name' => $m->name, 'business_id' => $m->business_id, 'deleted_at' => $m->deleted_at]);

        $archivedMedia = BusinessMedia::onlyTrashed()
            ->whereIn('business_id', $businessIds)
            ->get()
            ->map(fn ($m) => ['id' => $m->id, 'type' => 'media', 'name' => ($m->caption ?? 'Media #'.$m->id), 'business_id' => $m->business_id, 'deleted_at' => $m->deleted_at]);

        $archivedCategories = OfferingCategory::onlyTrashed()
            ->whereIn('business_id', $businessIds)
            ->get()
            ->map(fn ($m) => ['id' => $m->id, 'type' => 'category', 'name' => $m->name, 'business_id' => $m->business_id, 'deleted_at' => $m->deleted_at]);

        $archivedDocuments = BusinessDocument::onlyTrashed()
            ->whereIn('business_id', $businessIds)
            ->get()
            ->map(fn ($m) => ['id' => $m->id, 'type' => 'document', 'name' => ($m->document_type ?? 'Document #'.$m->id), 'business_id' => $m->business_id, 'deleted_at' => $m->deleted_at]);

        $items = collect()
            ->merge($archivedOfferings)
            ->merge($archivedPromotions)
            ->merge($archivedOrders)
            ->merge($archivedBookings)
            ->merge($archivedStaff)
            ->merge($archivedMedia)
            ->merge($archivedCategories)
            ->merge($archivedDocuments)
            ->sortByDesc('deleted_at')
            ->values();

        return $this->successResponse(['items' => $items]);
    }

    public function restore(Request $request, string $type, int $id): JsonResponse
    {
        $user = $request->user();
        $businessIds = $user->businesses()->pluck('id');

        $model = match ($type) {
            'offering' => Offering::onlyTrashed()->whereIn('business_id', $businessIds)->findOrFail($id),
            'promotion' => Promotion::onlyTrashed()->whereIn('business_id', $businessIds)->findOrFail($id),
            'order' => Order::onlyTrashed()->whereIn('business_id', $businessIds)->findOrFail($id),
            'booking' => Booking::onlyTrashed()->whereIn('business_id', $businessIds)->findOrFail($id),
            'staff' => Staff::onlyTrashed()->whereIn('business_id', $businessIds)->findOrFail($id),
            'media' => BusinessMedia::onlyTrashed()->whereIn('business_id', $businessIds)->findOrFail($id),
            'category' => OfferingCategory::onlyTrashed()->whereIn('business_id', $businessIds)->findOrFail($id),
            'document' => BusinessDocument::onlyTrashed()->whereIn('business_id', $businessIds)->findOrFail($id),
            default => abort(404, 'Unknown type'),
        };

        $model->restore();

        return $this->successResponse(['message' => ucfirst($type) . ' restored successfully.']);
    }

    public function destroy(Request $request, string $type, int $id): JsonResponse
    {
        $user = $request->user();
        $businessIds = $user->businesses()->pluck('id');

        $model = match ($type) {
            'offering' => Offering::whereIn('business_id', $businessIds)->findOrFail($id),
            'promotion' => Promotion::whereIn('business_id', $businessIds)->findOrFail($id),
            'order' => Order::whereIn('business_id', $businessIds)->findOrFail($id),
            'booking' => Booking::whereIn('business_id', $businessIds)->findOrFail($id),
            'staff' => Staff::whereIn('business_id', $businessIds)->findOrFail($id),
            'media' => BusinessMedia::whereIn('business_id', $businessIds)->findOrFail($id),
            'category' => OfferingCategory::whereIn('business_id', $businessIds)->findOrFail($id),
            default => abort(404, 'Unknown type'),
        };

        // Clean up file from storage for media
        if ($type === 'media' && $model->file_path) {
            Storage::disk('public')->delete($model->file_path);
        }

        $model->delete();

        return $this->successResponse(['message' => ucfirst($type) . ' archived successfully.']);
    }
}
