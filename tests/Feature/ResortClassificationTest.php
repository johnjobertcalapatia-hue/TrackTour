<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\BusinessDetail;
use App\Models\Municipality;
use App\Models\ResortFacility;
use App\Models\ResortType;
use App\Models\User;
use App\Services\ResortClassificationService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * Dynamic resort system, Stage 1: multiple resort types and structured
 * facilities per resort (docs/resort-reservation-architecture.md).
 */
class ResortClassificationTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;

    private Business $resort;

    private Business $restaurant;

    protected function setUp(): void
    {
        parent::setUp();
        $this->owner = User::create(['email' => 'owner@example.com', 'password' => Hash::make('Password123!'), 'role' => 'business_owner', 'account_status' => 'approved']);
        $m = Municipality::create(['name' => 'Bansud', 'district' => '2', 'province' => 'Oriental Mindoro']);
        $this->resort = Business::create(['owner_id' => $this->owner->id, 'business_category_id' => BusinessCategory::create(['name' => 'Resort'])->id, 'municipality_id' => $m->id, 'business_name' => 'Bansud Bay Resort', 'status' => 'approved']);
        $this->restaurant = Business::create(['owner_id' => $this->owner->id, 'business_category_id' => BusinessCategory::create(['name' => 'Restaurant'])->id, 'municipality_id' => $m->id, 'business_name' => 'Ekslusibo Grill', 'status' => 'approved']);
    }

    private function ids(string $model, array $slugs): array
    {
        return $model::whereIn('slug', $slugs)->pluck('id')->all();
    }

    private function save(array $data, ?Business $business = null, ?User $as = null)
    {
        $business ??= $this->resort;

        return $this->actingAs($as ?? $this->owner, 'sanctum')->putJson("/api/business-owner/businesses/{$business->id}/resort-profile", $data);
    }

    public function test_catalogue_lists_the_seeded_types_and_facilities(): void
    {
        $res = $this->getJson('/api/resort-catalogue')->assertOk();

        $this->assertSame(['pool', 'nature', 'beach', 'riverside', 'adventure', 'farm', 'other'], array_column($res->json('data.types'), 'slug'));
        $this->assertCount(count(ResortClassificationService::FACILITIES), $res->json('data.facilities'));
        $this->assertContains('swimming_pool', array_column($res->json('data.facilities'), 'slug'));
    }

    public function test_owner_sets_multiple_types_facilities_and_custom_facilities(): void
    {
        $res = $this->save([
            'resort_type_ids' => $this->ids(ResortType::class, ['pool', 'nature']),
            'facility_ids' => $this->ids(ResortFacility::class, ['swimming_pool', 'gardens', 'parking']),
            'custom_facilities' => ['  Videoke   room ', 'videoke room', 'Hammock area'],
        ])->assertOk();

        $this->assertEqualsCanonicalizing(['pool', 'nature'], array_column($res->json('data.types'), 'slug'));
        $this->assertEqualsCanonicalizing(['swimming_pool', 'gardens', 'parking'], array_column($res->json('data.facilities'), 'slug'));
        $this->assertSame(['Hammock area', 'Videoke room'], $res->json('data.custom_facilities'), 'trimmed, de-duplicated');

        // Re-saving replaces the selection.
        $this->save(['resort_type_ids' => $this->ids(ResortType::class, ['beach']), 'facility_ids' => [], 'custom_facilities' => ['Hammock area']])->assertOk();
        $this->resort->refresh();
        $this->assertSame(['beach'], $this->resort->resortTypes->pluck('slug')->all());
        $this->assertCount(0, $this->resort->resortFacilities);
        $this->assertSame(['Hammock area'], $this->resort->resortCustomFacilities->pluck('name')->all());

        $this->actingAs($this->owner, 'sanctum')->getJson("/api/business-owner/businesses/{$this->resort->id}/resort-profile")
            ->assertOk()->assertJsonPath('data.types.0.slug', 'beach');
    }

    public function test_validation_ownership_and_resort_only(): void
    {
        $this->save(['resort_type_ids' => []])->assertUnprocessable();               // at least one type
        $this->save(['resort_type_ids' => [99999]])->assertUnprocessable();          // unknown type
        $typeId = $this->ids(ResortType::class, ['pool'])[0];
        $this->save(['resort_type_ids' => [$typeId, $typeId]])->assertUnprocessable(); // duplicates

        $other = User::create(['email' => 'other@example.com', 'password' => Hash::make('Password123!'), 'role' => 'business_owner', 'account_status' => 'approved']);
        $this->save(['resort_type_ids' => [$typeId]], null, $other)->assertForbidden();
        $this->save(['resort_type_ids' => [$typeId]], $this->restaurant)->assertUnprocessable();
        $this->assertCount(0, $this->resort->resortTypes()->get());
    }

    public function test_backfill_from_registration_details_is_additive_and_idempotent(): void
    {
        foreach (['resort_type' => 'Beach Resort', 'swimming_pool' => '1', 'parking' => 'yes', 'number_of_cottages' => '4', 'beach_access' => '0'] as $k => $v) {
            BusinessDetail::create(['business_id' => $this->resort->id, 'field_name' => $k, 'field_value' => $v]);
        }
        $this->resort->resortTypes()->attach($this->ids(ResortType::class, ['farm'])); // owner's own choice stays

        $service = app(ResortClassificationService::class);
        $service->backfillFromDetails($this->resort);
        $service->backfillFromDetails($this->resort); // twice: no duplicates

        $this->resort->refresh();
        $this->assertEqualsCanonicalizing(['beach', 'pool', 'farm'], $this->resort->resortTypes->pluck('slug')->all());
        $this->assertEqualsCanonicalizing(['swimming_pool', 'parking', 'cottages'], $this->resort->resortFacilities->pluck('slug')->all());
        $this->assertSame(1, $service->backfillAllResorts(), 'only Resort-category businesses');
    }

    public function test_tourist_place_page_includes_resort_types_and_facilities_only_for_resorts(): void
    {
        $this->resort->resortTypes()->attach($this->ids(ResortType::class, ['pool', 'nature']));
        $this->resort->resortFacilities()->attach($this->ids(ResortFacility::class, ['swimming_pool']));

        $this->getJson("/api/tourist/explore/{$this->resort->id}")
            ->assertOk()
            ->assertJsonPath('data.resort.types.0.slug', 'pool')
            ->assertJsonPath('data.resort.types.1.slug', 'nature')
            ->assertJsonPath('data.resort.facilities.0.name', 'Swimming pool');

        $this->getJson("/api/tourist/explore/{$this->restaurant->id}")->assertOk()->assertJsonPath('data.resort', null);
    }
}
