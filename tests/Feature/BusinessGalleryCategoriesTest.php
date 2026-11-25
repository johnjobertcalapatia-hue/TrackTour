<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\BusinessMedia;
use App\Models\Municipality;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * Business Gallery photo categories now cover resorts and tourist attractions
 * (cottages, rooms, scenery, river…) as well as restaurants; anything else is
 * still refused.
 */
class BusinessGalleryCategoriesTest extends TestCase
{
    use RefreshDatabase;

    private Business $resort;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('public');
        $owner = User::create(['email' => 'owner@example.com', 'name' => 'owner', 'password' => Hash::make('Password123!'), 'role' => 'business_owner', 'account_status' => 'approved']);
        $this->resort = Business::create([
            'owner_id' => $owner->id,
            'business_category_id' => BusinessCategory::create(['name' => 'Resort'])->id,
            'municipality_id' => Municipality::create(['name' => 'Bansud', 'district' => '2', 'province' => 'Oriental Mindoro'])->id,
            'business_name' => 'RJM Beach Resort', 'status' => 'approved', 'latitude' => 12.86, 'longitude' => 121.48,
        ]);
    }

    private function upload(string $category)
    {
        return $this->actingAs($this->resort->owner, 'sanctum')->post("/api/business-owner/businesses/{$this->resort->id}/gallery", [
            'images' => [UploadedFile::fake()->create('photo.jpg', 100, 'image/jpeg')],
            'title' => 'Beachfront',
            'category' => $category,
        ], ['Accept' => 'application/json']);
    }

    public function test_resort_and_attraction_categories_are_accepted(): void
    {
        foreach (['cottage', 'room', 'pool', 'scenery', 'river', 'campsite', 'activity', 'facility', 'signature_dish'] as $category) {
            $this->upload($category)->assertSuccessful();
        }
        $this->assertSame(9, BusinessMedia::where('business_id', $this->resort->id)->where('type', 'Gallery')->count());
    }

    public function test_an_unknown_category_is_refused(): void
    {
        $this->upload('nightclub')->assertUnprocessable()->assertJsonValidationErrors('category');
    }
}
