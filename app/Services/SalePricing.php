<?php

namespace App\Services;

use App\Models\Offering;
use App\Models\Promotion;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Dish sale prices (Promotions Part A). The ONLY place a sale price is worked
 * out: menus shown to tourists, the cart price refresh, both checkouts and the
 * final locked recheck (CheckoutAvailabilityGuard) all call this, so the price
 * a tourist sees is the price they are charged. Prices sent by the browser are
 * never used.
 *
 * A sale lowers the dish's unit price for that order; the business pays for it
 * (decision 2026-11-24). The 10% system fee and the restaurant's share are then
 * worked out on the lower food total; delivery fees are unchanged. The order's
 * own `discount` column is NOT used for dish sales, so a sale can never be
 * subtracted twice.
 */
class SalePricing
{
    public function salePrice(float $price, string $type, float $value): float
    {
        return $type === 'percentage'
            ? round($price * (1 - $value / 100), 2)
            : round($price - $value, 2);
    }

    public function label(string $type, float $value): string
    {
        return $type === 'percentage'
            ? rtrim(rtrim(number_format($value, 2, '.', ''), '0'), '.').'% off'
            : '₱'.rtrim(rtrim(number_format($value, 2, '.', ','), '0'), '.').' off';
    }

    /**
     * The running item sale of each dish at $at (at most one: overlapping sales
     * are refused when a sale is saved). Keyed by offering id.
     *
     * @param  list<int>  $offeringIds
     * @return array<int, object{id: int, name: string, type: string, value: float, end_date: string}>
     */
    public function runningSales(array $offeringIds, ?Carbon $at = null): array
    {
        if ($offeringIds === []) {
            return [];
        }
        $at = ($at ?? now())->copy()->utc();

        $rows = DB::table('promotion_offering')
            ->join('promotions', 'promotions.id', '=', 'promotion_offering.promotion_id')
            ->whereIn('promotion_offering.offering_id', $offeringIds)
            ->where('promotions.kind', Promotion::KIND_ITEM_SALE)
            ->where('promotions.is_active', true)
            ->whereNull('promotions.deleted_at')
            ->where('promotions.start_date', '<=', $at)
            ->where('promotions.end_date', '>=', $at)
            ->orderBy('promotions.id')
            ->get(['promotion_offering.offering_id', 'promotions.id', 'promotions.name', 'promotions.type', 'promotions.value', 'promotions.end_date']);

        $out = [];
        foreach ($rows as $row) {
            $out[(int) $row->offering_id] ??= $row;
        }

        return $out;
    }

    /**
     * Price of one unit of each dish now.
     *
     * @param  iterable<Offering>  $offerings
     * @return array<int, array{unit_price: float, original_unit_price: float|null, promotion_id: int|null, sale_label: string|null, sale: array|null}>
     */
    public function quoteMany(iterable $offerings, ?Carbon $at = null): array
    {
        $list = collect($offerings);
        $sales = $this->runningSales($list->pluck('id')->map(fn ($id) => (int) $id)->all(), $at);

        return $list->mapWithKeys(fn (Offering $o) => [(int) $o->id => $this->quoteWith($o, $sales[(int) $o->id] ?? null)])->all();
    }

    public function quote(Offering $offering, ?Carbon $at = null): array
    {
        return $this->quoteMany([$offering], $at)[(int) $offering->id];
    }

    private function quoteWith(Offering $offering, ?object $sale): array
    {
        $base = round((float) $offering->price, 2);
        $plain = ['unit_price' => $base, 'original_unit_price' => null, 'promotion_id' => null, 'sale_label' => null, 'sale' => null];
        if ($sale === null) {
            return $plain;
        }

        $price = $this->salePrice($base, (string) $sale->type, (float) $sale->value);
        // Defence in depth: saving a sale or a menu price refuses this, but a
        // sale that would make a dish free or negative never applies.
        if ($price < 0.01 || $price >= $base) {
            return $plain;
        }
        $label = $this->label((string) $sale->type, (float) $sale->value);

        return [
            'unit_price' => $price,
            'original_unit_price' => $base,
            'promotion_id' => (int) $sale->id,
            'sale_label' => mb_substr($label.' · '.$sale->name, 0, 160),
            'sale' => [
                'id' => (int) $sale->id,
                'title' => $sale->name,
                'label' => $label,
                'ends_at' => Carbon::parse($sale->end_date, 'UTC')->toIso8601String(),
            ],
        ];
    }

    /**
     * For read-only tourist responses that serialise Offering models directly:
     * sets `price` to what the tourist pays now, plus `original_price` and
     * `sale`. The models must never be saved afterwards.
     *
     * @param  iterable<Offering>  $offerings
     */
    public function decorateForTourists(iterable $offerings): void
    {
        $list = collect($offerings)->filter();
        $quotes = $this->quoteMany($list);
        foreach ($list as $offering) {
            $quote = $quotes[(int) $offering->id];
            $offering->setAttribute('price', $quote['unit_price']);
            $offering->setAttribute('original_price', $quote['original_unit_price']);
            $offering->setAttribute('sale', $quote['sale']);
        }
    }

    /**
     * Tourist-facing price fields for a dish: `price` is what the tourist pays
     * now; `original_price` and `sale` are set only while a sale runs.
     */
    public static function presentFields(array $quote): array
    {
        return [
            'price' => $quote['unit_price'],
            'original_price' => $quote['original_unit_price'],
            'sale' => $quote['sale'],
        ];
    }
}
