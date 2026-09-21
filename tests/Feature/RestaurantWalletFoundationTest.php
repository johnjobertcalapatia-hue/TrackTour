<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Municipality;
use App\Models\RestaurantWallet;
use App\Models\User;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class RestaurantWalletFoundationTest extends TestCase
{
    use RefreshDatabase;

    public function test_an_approved_restaurant_receives_one_empty_wallet(): void
    {
        $restaurant = $this->makeBusiness('Restaurant', 'approved');

        $wallet = $restaurant->fresh()->restaurantWallet;

        $this->assertNotNull($wallet);
        $this->assertSame('0.00', $wallet->available_balance);
        $this->assertSame('0.00', $wallet->pending_balance);
        $this->assertSame('0.00', $wallet->total_earned);
        $this->assertSame('0.00', $wallet->total_withdrawn);

        $restaurant->update(['business_name' => 'Renamed Restaurant']);

        $this->assertSame(1, RestaurantWallet::where('business_id', $restaurant->id)->count());
    }

    public function test_wallet_is_provisioned_only_when_a_food_business_is_approved(): void
    {
        $pendingRestaurant = $this->makeBusiness('Restaurant', 'pending_review');
        $approvedHotel = $this->makeBusiness('Hotel', 'approved');

        $this->assertNull($pendingRestaurant->fresh()->restaurantWallet);
        $this->assertNull($approvedHotel->fresh()->restaurantWallet);

        $pendingRestaurant->update(['status' => 'approved']);

        $this->assertNotNull($pendingRestaurant->fresh()->restaurantWallet);
        $this->assertSame(1, RestaurantWallet::count());
    }

    public function test_database_allows_only_one_wallet_per_business(): void
    {
        $restaurant = $this->makeBusiness('Restaurant', 'approved');

        $this->expectException(QueryException::class);

        RestaurantWallet::create(['business_id' => $restaurant->id]);
    }

    private function makeBusiness(string $categoryName, string $status): Business
    {
        $owner = User::factory()->create();
        $category = BusinessCategory::create(['name' => $categoryName]);
        $municipality = Municipality::create([
            'name' => 'Bansud '.$categoryName.' '.$status,
            'district' => '1st',
            'province' => 'Oriental Mindoro',
            'latitude' => 12.5,
            'longitude' => 121.3,
        ]);

        return Business::create([
            'owner_id' => $owner->id,
            'business_category_id' => $category->id,
            'municipality_id' => $municipality->id,
            'business_name' => $categoryName.' '.$status,
            'status' => $status,
        ]);
    }
}
