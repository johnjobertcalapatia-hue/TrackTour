<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Municipality;
use App\Models\Offering;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Review;
use App\Models\User;
use App\Services\FoodPopularityService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * Rider trip flow Stage D (decision 2026-11-08): food ratings + sales decide
 * the default "Popular" order of the tourist Food page.
 */
class FoodPopularityRankingTest extends TestCase
{
    use RefreshDatabase;

    private Business $grill;

    private User $tourist;

    private int $seq = 0;

    protected function setUp(): void
    {
        parent::setUp();
        $owner = User::create(['email' => 'owner@example.com', 'password' => Hash::make('Password123!'), 'role' => 'business_owner', 'account_status' => 'approved']);
        $this->tourist = User::create(['email' => 'tourist@example.com', 'password' => Hash::make('Password123!'), 'role' => 'tourist', 'account_status' => 'approved']);
        $m = Municipality::create(['name' => 'Bansud', 'district' => '2', 'province' => 'Oriental Mindoro']);
        $this->grill = Business::create([
            'owner_id' => $owner->id,
            'business_category_id' => BusinessCategory::create(['name' => 'Restaurant'])->id,
            'municipality_id' => $m->id,
            'business_name' => 'Ekslusibo Grill',
            'status' => 'approved',
        ]);
    }

    private function dish(string $name, bool $bestseller = false): Offering
    {
        return Offering::create(['business_id' => $this->grill->id, 'name' => $name, 'price' => 199, 'is_available' => true, 'status' => 'available', 'bestseller' => $bestseller]);
    }

    private function sell(Offering $dish, int $qty, string $status = 'delivered'): Order
    {
        $order = Order::create([
            'order_number' => 'TT-'.(++$this->seq), 'business_id' => $this->grill->id, 'user_id' => $this->tourist->id,
            'customer_name' => 'T', 'customer_email' => $this->tourist->email, 'order_type' => 'delivery',
            'payment_method' => 'cash', 'payment_status' => 'paid', 'status' => $status, 'subtotal' => 0, 'delivery_fee' => 0, 'total' => 0,
        ]);
        OrderItem::create(['order_id' => $order->id, 'business_id' => $this->grill->id, 'offering_id' => $dish->id, 'product_name' => $dish->name, 'quantity' => $qty, 'unit_price' => 199, 'subtotal' => 199 * $qty, 'status' => 'pending']);

        return $order;
    }

    private function review(Order $order, int $food, string $status = 'approved'): Review
    {
        return Review::create(['business_id' => $this->grill->id, 'user_id' => $this->tourist->id, 'order_id' => $order->id, 'rating' => $food, 'food_rating' => $food, 'status' => $status]);
    }

    /** @return array<int, string> */
    private function popularOrder(): array
    {
        return collect($this->getJson('/api/tourist/food')->assertOk()->json('data.data'))->pluck('name')->all();
    }

    public function test_well_rated_dishes_outrank_poorly_rated_ones_with_equal_sales(): void
    {
        $good = $this->dish('Good Sisig');
        $bad = $this->dish('Bad Adobo', bestseller: true);   // the flag alone no longer wins
        foreach ([5, 5, 4, 5] as $stars) {
            $this->review($this->sell($good, 1), $stars);
        }
        foreach ([2, 1, 2, 2] as $stars) {
            $this->review($this->sell($bad, 1), $stars);
        }

        $this->assertSame(['Good Sisig', 'Bad Adobo'], $this->popularOrder());
    }

    public function test_sales_count_too_but_ratings_can_beat_a_bulk_order(): void
    {
        $loved = $this->dish('Loved Pancit');
        $bulk = $this->dish('Bulk Rice');
        $plain = $this->dish('Never Sold');
        foreach ([5, 5, 5, 5, 5] as $stars) {
            $this->review($this->sell($loved, 1), $stars);
        }
        $this->sell($bulk, 40);    // one large unrated order (no review hook: refresh scores it)
        $this->artisan('food:recompute-popularity')->assertSuccessful();
        $this->assertGreaterThan(0, (float) $bulk->fresh()->popularity_score);

        $order = $this->popularOrder();
        $this->assertSame(['Loved Pancit', 'Bulk Rice', 'Never Sold'], $order);

        // Sales alone still rank above an unsold dish.
        $service = app(FoodPopularityService::class);
        $this->assertGreaterThan($service->score(null, 0, 0), $service->score(null, 0, 40));
        $this->assertNotNull($plain->id);
    }

    public function test_a_single_five_star_review_cannot_jump_over_a_consistently_rated_dish(): void
    {
        $oneHit = $this->dish('One Review Wonder');
        $steady = $this->dish('Steady Favorite');
        $this->review($this->sell($oneHit, 1), 5);
        foreach ([5, 4, 5, 4, 5, 4, 5, 4] as $stars) {
            $this->review($this->sell($steady, 1), $stars);
        }

        $order = $this->popularOrder();
        $this->assertSame('Steady Favorite', $order[0]);

        $s = app(FoodPopularityService::class);
        // Bayesian guard: 1 × 5★ is pulled toward the 3.5★ prior.
        $this->assertEqualsWithDelta(25 * ((5 + 3 * 3.5) / 4) + 10 * log(2), $s->score(5.0, 1, 1), 0.001);
    }

    public function test_pending_reviews_do_not_count_until_approved_and_approval_rescores_immediately(): void
    {
        $dish = $this->dish('Sizzling Tofu');
        $other = $this->dish('Plain Rice');
        $this->sell($other, 2);
        $review = $this->review($this->sell($dish, 1), 5, 'pending');

        $pendingScore = (float) $dish->fresh()->popularity_score;
        $this->assertEqualsWithDelta(app(FoodPopularityService::class)->score(null, 0, 1), $pendingScore, 0.001);

        $review->update(['status' => 'approved']);   // moderation approval
        $approvedScore = (float) $dish->fresh()->popularity_score;
        $this->assertGreaterThan($pendingScore, $approvedScore);
        $this->assertEqualsWithDelta(app(FoodPopularityService::class)->score(5.0, 1, 1), $approvedScore, 0.001);

        $review->delete();
        $this->assertEqualsWithDelta($pendingScore, (float) $dish->fresh()->popularity_score, 0.001);
    }

    public function test_the_scheduled_refresh_picks_up_new_sales(): void
    {
        $dish = $this->dish('Kare-Kare');
        $this->assertEquals(0, (float) $dish->fresh()->popularity_score);

        $this->sell($dish, 3);                         // sales don't trigger a review hook
        $this->sell($dish, 9, 'preparing');            // not delivered: not counted
        $this->artisan('food:recompute-popularity')->assertSuccessful();

        $this->assertEqualsWithDelta(app(FoodPopularityService::class)->score(null, 0, 3), (float) $dish->fresh()->popularity_score, 0.001);

        // Idempotent: nothing changes on a second run.
        $this->artisan('food:recompute-popularity')->expectsOutput('Updated 0 dish popularity score(s).')->assertSuccessful();
    }

    public function test_the_refresh_is_scheduled_every_ten_minutes(): void
    {
        $event = collect(app(\Illuminate\Console\Scheduling\Schedule::class)->events())
            ->first(fn ($e) => str_contains((string) $e->command, 'food:recompute-popularity'));

        $this->assertNotNull($event);
        $this->assertSame('*/10 * * * *', $event->expression);
    }

    public function test_other_sorts_are_unchanged(): void
    {
        $cheap = $this->dish('Cheap');
        $cheap->update(['price' => 50]);
        $loved = $this->dish('Loved');
        $this->review($this->sell($loved, 5), 5);

        $names = collect($this->getJson('/api/tourist/food?sort=price_low')->assertOk()->json('data.data'))->pluck('name')->all();
        $this->assertSame(['Cheap', 'Loved'], $names);
    }
}
