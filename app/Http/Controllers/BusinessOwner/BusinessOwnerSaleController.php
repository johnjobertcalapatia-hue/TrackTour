<?php

namespace App\Http\Controllers\BusinessOwner;

use App\Http\Controllers\Concerns\ActsForBusiness;
use App\Http\Controllers\Controller;
use App\Models\Business;
use App\Models\Offering;
use App\Models\Promotion;
use App\Services\SalePricing;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Dish sales (Promotions Part A): the owner, or Menu & Promotions staff, picks
 * dishes and a % or ₱ discount for a period; while it runs those dishes cost
 * less at checkout (App\Services\SalePricing).
 *
 * Rules enforced here, never only in the page:
 *  - every dish belongs to the sale's business and is not archived;
 *  - the sale price of every dish is at least ₱0.01;
 *  - a dish is in at most one sale at a time (no overlapping periods);
 *  - saving, ending or archiving locks the dishes' rows first (the same locks
 *    checkout takes), so a sale change never lands half-way through a checkout.
 * Dates without a time are Manila calendar days (start 00:00, end 23:59:59).
 */
class BusinessOwnerSaleController extends Controller
{
    use ActsForBusiness;

    private const TZ = 'Asia/Manila';

    public function __construct(private SalePricing $pricing) {}

    public function index(Request $request): JsonResponse
    {
        $ids = $this->actingBusinessIds($request);
        if ($request->filled('business_id')) {
            $ids = $ids->intersect([(int) $request->input('business_id')])->values();
        }

        $sales = Promotion::itemSales()->whereIn('business_id', $ids)
            ->with(['business:id,business_name', 'offerings:id,name,price,image'])
            ->orderByDesc('start_date')->orderByDesc('id')
            ->get();

        return $this->successResponse($sales->map(fn (Promotion $p) => $this->present($p))->values());
    }

    public function show(Request $request, int $id): JsonResponse
    {
        return $this->successResponse($this->present($this->findSale($request, $id)->load('business:id,business_name', 'offerings:id,name,price,image')));
    }

    /** Dishes the sale form can pick, with the sale each is already in. */
    public function dishes(Request $request): JsonResponse
    {
        $validated = $request->validate(['business_id' => ['required', 'integer']]);
        $business = Business::find($validated['business_id']);
        if (! $this->actsFor($request, $business)) {
            return $this->forbiddenResponse('You do not manage this business.');
        }

        $dishes = Offering::where('business_id', $business->id)
            ->whereNotIn('status', ['archived'])
            ->with(['sales' => fn ($q) => $q->where('kind', Promotion::KIND_ITEM_SALE)->where('is_active', true)->where('end_date', '>=', now())])
            ->orderBy('name')
            ->get(['id', 'business_id', 'name', 'price', 'image', 'is_available', 'status']);

        return $this->successResponse($dishes->map(fn (Offering $o) => [
            'id' => $o->id,
            'name' => $o->name,
            'price' => (float) $o->price,
            'image' => $o->image,
            'is_available' => (bool) $o->is_available,
            'sales' => $o->sales->map(fn (Promotion $s) => [
                'id' => $s->id, 'title' => $s->name,
                'starts_at' => $s->start_date?->toIso8601String(), 'ends_at' => $s->end_date?->toIso8601String(),
            ])->values(),
        ])->values());
    }

    public function store(Request $request): JsonResponse
    {
        $data = $this->validated($request);
        $business = Business::find($data['business_id']);
        if (! $this->actsFor($request, $business)) {
            return $this->forbiddenResponse('You do not manage this business.');
        }
        if ($business->status !== 'approved') {
            return $this->errorResponse('Only approved businesses can run sales.', 422);
        }

        $sale = DB::transaction(function () use ($data, $business) {
            $this->lockAndCheck($business, $data);
            $sale = $business->promotions()->create([
                'kind' => Promotion::KIND_ITEM_SALE,
                'name' => $data['title'],
                'description' => $data['description'] ?? null,
                'type' => $data['discount_type'],
                'value' => $data['discount_value'],
                'start_date' => $data['starts_at'],
                'end_date' => $data['ends_at'],
                'is_active' => true,
            ]);
            $sale->offerings()->sync($data['offering_ids']);

            return $sale;
        });

        return $this->createdResponse($this->present($sale->load('business:id,business_name', 'offerings:id,name,price,image')), 'Sale created.');
    }

    public function update(Request $request, int $id): JsonResponse
    {
        $sale = $this->findSale($request, $id);
        if (in_array($sale->saleStatus(), ['ended', 'stopped'], true)) {
            return $this->errorResponse('This sale has finished and can no longer be changed. Create a new sale instead.', 422);
        }
        $data = $this->validated($request, $sale);
        if ((int) $data['business_id'] !== (int) $sale->business_id) {
            return $this->errorResponse('A sale cannot be moved to another business.', 422);
        }

        DB::transaction(function () use ($sale, $data) {
            // Lock the dishes being removed too: their price changes as well.
            $this->lockOfferings($sale->offerings()->pluck('offerings.id')->all());
            $this->lockAndCheck($sale->business, $data, $sale->id);
            $sale->update([
                'name' => $data['title'],
                'description' => $data['description'] ?? null,
                'type' => $data['discount_type'],
                'value' => $data['discount_value'],
                'start_date' => $data['starts_at'],
                'end_date' => $data['ends_at'],
            ]);
            $sale->offerings()->sync($data['offering_ids']);
        });

        return $this->successResponse($this->present($sale->fresh()->load('business:id,business_name', 'offerings:id,name,price,image')), 'Sale updated.');
    }

    /** Stop a sale now; dishes go back to their menu price for new orders. */
    public function end(Request $request, int $id): JsonResponse
    {
        $sale = $this->findSale($request, $id);
        DB::transaction(function () use ($sale) {
            $this->lockOfferings($sale->offerings()->pluck('offerings.id')->all());
            $sale->update([
                'is_active' => false,
                'end_date' => $sale->end_date && $sale->end_date->lt(now()) ? $sale->end_date : now(),
            ]);
        });

        return $this->successResponse($this->present($sale->fresh()->load('business:id,business_name', 'offerings:id,name,price,image')), 'Sale ended.');
    }

    /** Archive (soft delete). Orders already placed keep the price they were sold at. */
    public function destroy(Request $request, int $id): JsonResponse
    {
        $sale = $this->findSale($request, $id);
        DB::transaction(function () use ($sale) {
            $this->lockOfferings($sale->offerings()->pluck('offerings.id')->all());
            $sale->update(['is_active' => false]);
            $sale->delete();
        });

        return $this->noContentResponse('Sale archived.');
    }

    private function findSale(Request $request, int $id): Promotion
    {
        return Promotion::itemSales()->whereIn('business_id', $this->actingBusinessIds($request))->findOrFail($id);
    }

    private function validated(Request $request, ?Promotion $existing = null): array
    {
        $data = $request->validate([
            'business_id' => ['required', 'integer', 'exists:businesses,id'],
            'title' => ['required', 'string', 'min:2', 'max:120'],
            'description' => ['nullable', 'string', 'max:1000'],
            'discount_type' => ['required', 'in:percentage,fixed'],
            // A sale may not make a dish free: a percentage is below 100.
            'discount_value' => ['required', 'numeric', 'min:0.01', $request->input('discount_type') === 'percentage' ? 'max:99' : 'max:100000'],
            'starts_at' => ['required', 'date'],
            'ends_at' => ['required', 'date'],
            'offering_ids' => ['required', 'array', 'min:1', 'max:100'],
            'offering_ids.*' => ['integer', 'distinct'],
        ], [
            'discount_value.max' => $request->input('discount_type') === 'percentage' ? 'A percentage sale must be below 100%.' : 'The discount is too large.',
            'offering_ids.required' => 'Choose at least one dish.',
            'offering_ids.min' => 'Choose at least one dish.',
        ]);

        $starts = $this->manila($data['starts_at'], false);
        $ends = $this->manila($data['ends_at'], true);
        $errors = [];
        if ($ends->lte($starts)) {
            $errors['ends_at'] = 'The end must be after the start.';
        } elseif ($ends->lte(now())) {
            $errors['ends_at'] = 'The end must be in the future.';
        } elseif ($starts->diffInDays($ends) > 366) {
            $errors['ends_at'] = 'A sale can run for at most one year.';
        }
        // A new sale (or one not started yet) may not be back-dated: it would
        // claim orders already placed at the menu price were on sale.
        $startedAlready = $existing && $existing->start_date && $existing->start_date->lte(now());
        if (! $startedAlready && $starts->lt(now()->subMinutes(5))) {
            $starts = now();
        }
        if ($startedAlready) {
            $starts = $existing->start_date; // a running sale keeps its real start
        }
        if ($errors) {
            throw ValidationException::withMessages($errors);
        }

        $data['starts_at'] = $starts->copy()->utc();
        $data['ends_at'] = $ends->copy()->utc();
        $data['offering_ids'] = array_values(array_unique(array_map('intval', $data['offering_ids'])));

        return $data;
    }

    /** "2026-11-30" is a Manila day; "2026-11-30T18:00" is Manila wall time; an ISO time with an offset is kept. */
    private function manila(string $value, bool $endOfDay): Carbon
    {
        if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $value)) {
            $day = Carbon::createFromFormat('Y-m-d', $value, self::TZ);

            return $endOfDay ? $day->endOfDay() : $day->startOfDay();
        }
        if (preg_match('/(Z|[+-]\d{2}:?\d{2})$/', $value)) {
            return Carbon::parse($value);
        }

        return Carbon::parse($value, self::TZ);
    }

    /** @param list<int> $ids */
    private function lockOfferings(array $ids): \Illuminate\Support\Collection
    {
        $ids = array_values(array_unique(array_map('intval', $ids)));
        sort($ids); // same order as checkout, so the two never deadlock

        return $ids ? Offering::whereIn('id', $ids)->orderBy('id')->lockForUpdate()->get()->keyBy('id') : collect();
    }

    private function lockAndCheck(Business $business, array $data, ?int $ignoreSaleId = null): void
    {
        $dishes = $this->lockOfferings($data['offering_ids']);
        $errors = [];

        foreach ($data['offering_ids'] as $id) {
            $dish = $dishes->get($id);
            if (! $dish || (int) $dish->business_id !== (int) $business->id || $dish->status === 'archived') {
                throw ValidationException::withMessages(['offering_ids' => 'One of the chosen dishes is not on this business\'s menu.']);
            }
            $price = $this->pricing->salePrice((float) $dish->price, $data['discount_type'], (float) $data['discount_value']);
            if ($price < 0.01) {
                $errors[] = "{$dish->name} would cost ₱0 or less (menu price ₱".number_format((float) $dish->price, 2).').';
            }
        }
        if ($errors) {
            throw ValidationException::withMessages(['discount_value' => implode(' ', $errors)]);
        }

        // Overlap: another sale (not stopped, not archived) that shares a dish and a moment.
        $clash = DB::table('promotion_offering')
            ->join('promotions', 'promotions.id', '=', 'promotion_offering.promotion_id')
            ->join('offerings', 'offerings.id', '=', 'promotion_offering.offering_id')
            ->whereIn('promotion_offering.offering_id', $data['offering_ids'])
            ->where('promotions.kind', Promotion::KIND_ITEM_SALE)
            ->where('promotions.is_active', true)
            ->whereNull('promotions.deleted_at')
            ->when($ignoreSaleId, fn ($q) => $q->where('promotions.id', '!=', $ignoreSaleId))
            ->where('promotions.start_date', '<', $data['ends_at'])
            ->where('promotions.end_date', '>', $data['starts_at'])
            ->get(['offerings.name as dish', 'promotions.name as sale']);
        if ($clash->isNotEmpty()) {
            $list = $clash->map(fn ($c) => "{$c->dish} (in \"{$c->sale}\")")->unique()->implode(', ');
            throw ValidationException::withMessages(['offering_ids' => "A dish can be in only one sale at a time: {$list}."]);
        }
    }

    private function present(Promotion $p): array
    {
        return [
            'id' => $p->id,
            'kind' => $p->kind,
            'business_id' => $p->business_id,
            'business_name' => $p->business?->business_name,
            'title' => $p->name,
            'description' => $p->description,
            'discount_type' => $p->type,
            'discount_value' => (float) $p->value,
            'label' => $this->pricing->label((string) $p->type, (float) $p->value),
            'starts_at' => $p->start_date?->toIso8601String(),
            'ends_at' => $p->end_date?->toIso8601String(),
            'status' => $p->saleStatus(),
            'dishes' => $p->relationLoaded('offerings') ? $p->offerings->map(fn (Offering $o) => [
                'id' => $o->id,
                'name' => $o->name,
                'image' => $o->image,
                'price' => (float) $o->price,
                'sale_price' => max(0, $this->pricing->salePrice((float) $o->price, (string) $p->type, (float) $p->value)),
            ])->values() : [],
        ];
    }
}
