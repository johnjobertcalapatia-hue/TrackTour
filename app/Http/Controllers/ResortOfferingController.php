<?php

namespace App\Http\Controllers;

use App\Models\Business;
use App\Models\ResortOffering;
use App\Services\ResortClassificationService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Owner management of bookable resort offerings (dynamic resort system,
 * Stage 4). Resort-category businesses owned by the caller only.
 *
 *   GET    /api/business-owner/businesses/{business}/resort-offerings
 *   POST   /api/business-owner/businesses/{business}/resort-offerings
 *   GET    /api/business-owner/businesses/{business}/resort-offerings/{offering}
 *   PUT    /api/business-owner/businesses/{business}/resort-offerings/{offering}
 *   DELETE /api/business-owner/businesses/{business}/resort-offerings/{offering}
 *
 * Booking behaviour is structured and validated here (one place) so the
 * reservation engine (later stages) can rely on coherent configuration.
 */
class ResortOfferingController extends Controller
{
    public function index(Request $request, Business $business): JsonResponse
    {
        $this->authorizeResort($request, $business);

        $offerings = $business->resortOfferings()->with('images', 'requires')->get();

        return $this->successResponse([
            'offerings' => $offerings->map(fn (ResortOffering $o) => self::present($o))->values(),
            'options' => [
                'categories' => collect(ResortOffering::CATEGORIES)->map(fn ($label, $value) => ['value' => $value, 'label' => $label])->values(),
                'booking_modes' => ResortOffering::BOOKING_MODES,
                'pricing_bases' => ResortOffering::PRICING_BASES,
                'inventory_modes' => ResortOffering::INVENTORY_MODES,
                'max_images' => ResortOffering::MAX_IMAGES,
            ],
        ]);
    }

    public function show(Request $request, Business $business, ResortOffering $offering): JsonResponse
    {
        $this->authorizeResort($request, $business);
        $this->assertBelongs($business, $offering);

        return $this->successResponse(self::present($offering->load('images', 'requires')));
    }

    public function store(Request $request, Business $business): JsonResponse
    {
        $this->authorizeResort($request, $business);
        $data = $this->validated($request, $business, null);

        $offering = DB::transaction(function () use ($request, $business, $data) {
            $offering = $business->resortOfferings()->create($data);
            $this->syncImages($request, $offering);

            return $offering;
        });

        return $this->createdResponse(self::present($offering->fresh()->load('images', 'requires')), 'Offering created.');
    }

    public function update(Request $request, Business $business, ResortOffering $offering): JsonResponse
    {
        $this->authorizeResort($request, $business);
        $this->assertBelongs($business, $offering);
        $data = $this->validated($request, $business, $offering);

        DB::transaction(function () use ($request, $offering, $data) {
            $offering->update($data);
            $this->syncImages($request, $offering);
        });

        return $this->successResponse(self::present($offering->fresh()->load('images', 'requires')), 'Offering updated.');
    }

    public function destroy(Request $request, Business $business, ResortOffering $offering): JsonResponse
    {
        $this->authorizeResort($request, $business);
        $this->assertBelongs($business, $offering);

        $dependents = ResortOffering::where('requires_offering_id', $offering->id)->pluck('name');
        if ($dependents->isNotEmpty()) {
            return $this->errorResponse('Other offerings depend on this one ('.$dependents->join(', ').'). Change them first.', 422);
        }

        // Soft delete: past reservations keep their own snapshots (later stages).
        $offering->delete();

        return $this->successResponse(null, 'Offering removed.');
    }

    /** Validates and normalises the offering configuration. */
    private function validated(Request $request, Business $business, ?ResortOffering $current): array
    {
        $data = $request->validate([
            'category' => ['required', Rule::in(array_keys(ResortOffering::CATEGORIES))],
            'name' => ['required', 'string', 'max:150'],
            'description' => ['nullable', 'string', 'max:2000'],
            'booking_mode' => ['required', Rule::in(ResortOffering::BOOKING_MODES)],
            'pricing_basis' => ['required', Rule::in(ResortOffering::PRICING_BASES)],
            'price' => ['required', 'numeric', 'min:0', 'max:1000000'],
            'inventory_mode' => ['required', Rule::in(ResortOffering::INVENTORY_MODES)],
            'inventory_quantity' => ['required', 'integer', 'min:1', 'max:100000'],
            'min_guests' => ['nullable', 'integer', 'min:1', 'max:10000'],
            'max_guests' => ['nullable', 'integer', 'min:1', 'max:10000'],
            'min_quantity' => ['nullable', 'integer', 'min:1', 'max:10000'],
            'max_quantity' => ['nullable', 'integer', 'min:1', 'max:10000'],
            'duration_minutes' => ['nullable', 'integer', 'min:15', 'max:1440'],
            'is_required' => ['nullable', 'boolean'],
            'bookable_independently' => ['nullable', 'boolean'],
            'requires_offering_id' => ['nullable', 'integer'],
            'is_published' => ['nullable', 'boolean'],
            'sort_order' => ['nullable', 'integer', 'min:0', 'max:65535'],
            'attributes' => ['nullable', 'array', 'max:20'],
            'attributes.*' => ['nullable', 'string', 'max:200'],
            'images' => ['nullable', 'array', 'max:'.ResortOffering::MAX_IMAGES],
            'images.*' => ['image', 'mimes:jpg,jpeg,png,webp', 'max:5120'],
            'remove_image_ids' => ['nullable', 'array'],
            'remove_image_ids.*' => ['integer'],
        ]);

        $errors = [];
        $mode = $data['booking_mode'];
        $basis = $data['pricing_basis'];
        if ($basis === 'per_night' && $mode !== 'overnight') {
            $errors['pricing_basis'] = 'A per-night price needs the overnight booking mode.';
        }
        if ($basis === 'per_hour' && ! in_array($mode, ['time_slot', 'duration'], true)) {
            $errors['pricing_basis'] = 'A per-hour price needs a time-slot or duration booking.';
        }
        if ($data['inventory_mode'] === 'slots' && $mode !== 'time_slot') {
            $errors['inventory_mode'] = 'Scheduled slots need the time-slot booking mode.';
        }
        if (in_array($mode, ['time_slot', 'duration'], true) && empty($data['duration_minutes'])) {
            $errors['duration_minutes'] = 'Set how long each booking lasts.';
        }
        if (isset($data['min_guests'], $data['max_guests']) && $data['max_guests'] < $data['min_guests']) {
            $errors['max_guests'] = 'The maximum guests must be at least the minimum.';
        }
        $minQty = (int) ($data['min_quantity'] ?? 1);
        if (isset($data['max_quantity']) && $data['max_quantity'] < $minQty) {
            $errors['max_quantity'] = 'The maximum quantity must be at least the minimum.';
        }

        $independent = (bool) ($data['bookable_independently'] ?? true);
        $requiresId = $data['requires_offering_id'] ?? null;
        if ($requiresId !== null) {
            $required = ResortOffering::where('business_id', $business->id)->find($requiresId);
            if (! $required || ($current && (int) $required->id === (int) $current->id)) {
                $errors['requires_offering_id'] = 'Choose another offering from this resort.';
            } elseif ($required->requires_offering_id !== null) {
                // One level only: no chains or cycles.
                $errors['requires_offering_id'] = 'That offering itself depends on another one. Pick an offering that can be booked on its own.';
            } elseif ($current && ResortOffering::where('requires_offering_id', $current->id)->exists()) {
                $errors['requires_offering_id'] = 'Other offerings depend on this one, so it cannot depend on another.';
            }
        } elseif (! $independent) {
            $errors['requires_offering_id'] = 'Choose which offering this one must be booked with.';
        }

        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }

        return [
            'category' => $data['category'],
            'name' => trim($data['name']),
            'description' => $data['description'] ?? null,
            'booking_mode' => $mode,
            'pricing_basis' => $basis,
            'price' => $data['price'],
            'inventory_mode' => $data['inventory_mode'],
            'inventory_quantity' => (int) $data['inventory_quantity'],
            'min_guests' => $data['min_guests'] ?? null,
            'max_guests' => $data['max_guests'] ?? null,
            'min_quantity' => $minQty,
            'max_quantity' => $data['max_quantity'] ?? null,
            'duration_minutes' => in_array($mode, ['time_slot', 'duration'], true) ? (int) $data['duration_minutes'] : null,
            'is_required' => (bool) ($data['is_required'] ?? false),
            'bookable_independently' => $requiresId === null ? true : $independent,
            'requires_offering_id' => $requiresId,
            'is_published' => (bool) ($data['is_published'] ?? false),
            'sort_order' => (int) ($data['sort_order'] ?? 0),
            'attributes' => isset($data['attributes']) ? array_filter($data['attributes'], fn ($v) => $v !== null && $v !== '') : null,
        ];
    }

    private function syncImages(Request $request, ResortOffering $offering): void
    {
        $remove = $offering->images()->whereIn('id', (array) $request->input('remove_image_ids', []))->get();
        foreach ($remove as $img) {
            Storage::disk('public')->delete($img->path);
            $img->delete();
        }

        $uploads = $request->file('images', []);
        if ($uploads === []) {
            return;
        }
        $existing = $offering->images()->count();
        if ($existing + count($uploads) > ResortOffering::MAX_IMAGES) {
            throw ValidationException::withMessages(['images' => 'An offering can have up to '.ResortOffering::MAX_IMAGES.' photos.']);
        }
        $order = (int) $offering->images()->max('sort_order');
        foreach ($uploads as $file) {
            $offering->images()->create(['path' => $file->store('resort-offerings', 'public'), 'sort_order' => ++$order]);
        }
    }

    /** Owner and tourist shape. */
    public static function present(ResortOffering $o): array
    {
        return [
            'id' => $o->id,
            'category' => $o->category,
            'category_label' => ResortOffering::CATEGORIES[$o->category] ?? $o->category,
            'name' => $o->name,
            'description' => $o->description,
            'booking_mode' => $o->booking_mode,
            'pricing_basis' => $o->pricing_basis,
            'price' => (float) $o->price,
            'inventory_mode' => $o->inventory_mode,
            'inventory_quantity' => $o->inventory_quantity,
            'min_guests' => $o->min_guests,
            'max_guests' => $o->max_guests,
            'min_quantity' => $o->min_quantity,
            'max_quantity' => $o->max_quantity,
            'duration_minutes' => $o->duration_minutes,
            'is_required' => $o->is_required,
            'bookable_independently' => $o->bookable_independently,
            'requires_offering_id' => $o->requires_offering_id,
            'requires_offering_name' => $o->requires?->name,
            'is_published' => $o->is_published,
            'sort_order' => $o->sort_order,
            'attributes' => $o->attributes ?? (object) [],
            'images' => $o->images->map(fn ($i) => ['id' => $i->id, 'path' => $i->path])->values(),
        ];
    }

    private function assertBelongs(Business $business, ResortOffering $offering): void
    {
        if ((int) $offering->business_id !== (int) $business->id) {
            abort(404);
        }
    }

    private function authorizeResort(Request $request, Business $business): void
    {
        if ((int) $business->owner_id !== (int) $request->user()->id) {
            abort(403);
        }
        $business->loadMissing('category');
        if (! ResortClassificationService::isResort($business)) {
            abort(response()->json(['success' => false, 'message' => 'Offerings are only for Resort businesses.'], 422));
        }
    }
}
