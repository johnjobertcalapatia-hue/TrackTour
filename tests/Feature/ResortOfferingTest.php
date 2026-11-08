<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Municipality;
use App\Models\ResortOffering;
use App\Models\ResortType;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * Dynamic resort system, Stage 4: bookable offerings (model, owner API,
 * validation, tourist exposure).
 */
class ResortOfferingTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;

    private Business $resort;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('public');
        $this->owner = User::create(['email' => 'owner@example.com', 'password' => Hash::make('Password123!'), 'role' => 'business_owner', 'account_status' => 'approved']);
        $m = Municipality::create(['name' => 'Bansud', 'district' => '2', 'province' => 'Oriental Mindoro']);
        $this->resort = Business::create(['owner_id' => $this->owner->id, 'business_category_id' => BusinessCategory::create(['name' => 'Resort'])->id, 'municipality_id' => $m->id, 'business_name' => 'Lagoon Pool Resort', 'status' => 'approved']);
        $this->resort->resortTypes()->attach(ResortType::where('slug', 'pool')->value('id'));
    }

    private function url(string $suffix = '', ?Business $b = null): string
    {
        return '/api/business-owner/businesses/'.($b ?? $this->resort)->id.'/resort-offerings'.$suffix;
    }

    private function cottage(array $over = []): array
    {
        return array_merge([
            'category' => 'cottage', 'name' => 'Family cottage', 'description' => 'Shaded, near the pool',
            'booking_mode' => 'day_use', 'pricing_basis' => 'per_unit', 'price' => 800,
            'inventory_mode' => 'units', 'inventory_quantity' => 6, 'max_guests' => 10, 'is_published' => true,
        ], $over);
    }

    private function create(array $data, ?User $as = null, ?Business $b = null)
    {
        return $this->actingAs($as ?? $this->owner, 'sanctum')->post($this->url('', $b), $data, ['Accept' => 'application/json']);
    }

    public function test_owner_creates_lists_and_shows_offerings_with_photos(): void
    {
        $res = $this->create($this->cottage(['images' => [UploadedFile::fake()->image('a.jpg'), UploadedFile::fake()->image('b.png')]]))->assertCreated();

        $this->assertSame('cottage', $res->json('data.category'));
        $this->assertSame('Cottage', $res->json('data.category_label'));
        $this->assertEquals(800, $res->json('data.price'));
        $this->assertCount(2, $res->json('data.images'));
        Storage::disk('public')->assertExists($res->json('data.images.0.path'));

        $list = $this->actingAs($this->owner, 'sanctum')->getJson($this->url())->assertOk();
        $this->assertSame(['Family cottage'], array_column($list->json('data.offerings'), 'name'));
        $this->assertContains('pool_access', array_column($list->json('data.options.categories'), 'value'));

        $this->actingAs($this->owner, 'sanctum')->getJson($this->url('/'.$res->json('data.id')))->assertOk()->assertJsonPath('data.max_guests', 10);
    }

    public function test_booking_configuration_must_be_coherent(): void
    {
        $this->create($this->cottage(['pricing_basis' => 'per_night']))->assertUnprocessable()->assertJsonValidationErrors('pricing_basis');
        $this->create($this->cottage(['pricing_basis' => 'per_hour']))->assertUnprocessable()->assertJsonValidationErrors('pricing_basis');
        $this->create($this->cottage(['inventory_mode' => 'slots']))->assertUnprocessable()->assertJsonValidationErrors('inventory_mode');
        $this->create($this->cottage(['booking_mode' => 'time_slot']))->assertUnprocessable()->assertJsonValidationErrors('duration_minutes');
        $this->create($this->cottage(['min_guests' => 8, 'max_guests' => 4]))->assertUnprocessable()->assertJsonValidationErrors('max_guests');
        $this->create($this->cottage(['min_quantity' => 3, 'max_quantity' => 2]))->assertUnprocessable()->assertJsonValidationErrors('max_quantity');
        $this->create($this->cottage(['category' => 'helipad']))->assertUnprocessable();
        $this->create($this->cottage(['price' => -1]))->assertUnprocessable();
        $this->create($this->cottage(['inventory_quantity' => 0]))->assertUnprocessable();
        $this->create($this->cottage(['images' => array_fill(0, ResortOffering::MAX_IMAGES + 1, UploadedFile::fake()->image('x.jpg'))]))->assertUnprocessable();

        // Valid variants: overnight per night; timed activity with slots.
        $this->create($this->cottage(['name' => 'Native room', 'category' => 'room', 'booking_mode' => 'overnight', 'pricing_basis' => 'per_night']))->assertCreated();
        $this->create($this->cottage(['name' => 'Kayaking', 'category' => 'activity', 'booking_mode' => 'time_slot', 'pricing_basis' => 'per_person', 'inventory_mode' => 'slots', 'inventory_quantity' => 8, 'duration_minutes' => 60]))
            ->assertCreated()->assertJsonPath('data.duration_minutes', 60);
        $this->assertSame(2, ResortOffering::count());
    }

    public function test_dependencies_are_same_resort_one_level_and_required_when_not_independent(): void
    {
        $cottageId = $this->create($this->cottage())->json('data.id');

        // "Grilling area only with a cottage".
        $grill = $this->create($this->cottage(['name' => 'Grilling area', 'category' => 'other', 'bookable_independently' => false, 'requires_offering_id' => $cottageId]))->assertCreated();
        $this->assertFalse($grill->json('data.bookable_independently'));
        $this->assertSame('Family cottage', $grill->json('data.requires_offering_name'));

        $this->create($this->cottage(['name' => 'X', 'bookable_independently' => false]))->assertUnprocessable()->assertJsonValidationErrors('requires_offering_id');
        $this->create($this->cottage(['name' => 'Y', 'requires_offering_id' => $grill->json('data.id')]))->assertUnprocessable()->assertJsonValidationErrors('requires_offering_id'); // no chains

        $other = Business::create(['owner_id' => $this->owner->id, 'business_category_id' => $this->resort->business_category_id, 'business_name' => 'Other Resort', 'status' => 'approved']);
        $foreign = ResortOffering::create(['business_id' => $other->id] + $this->cottage());
        $this->create($this->cottage(['name' => 'Z', 'requires_offering_id' => $foreign->id]))->assertUnprocessable()->assertJsonValidationErrors('requires_offering_id');

        // The cottage can't become dependent while something depends on it, and can't be deleted.
        $this->actingAs($this->owner, 'sanctum')->putJson($this->url('/'.$cottageId), $this->cottage(['requires_offering_id' => $foreign->id]))->assertUnprocessable();
        $this->actingAs($this->owner, 'sanctum')->deleteJson($this->url('/'.$cottageId))->assertUnprocessable();
    }

    public function test_update_replaces_photos_and_delete_is_soft(): void
    {
        $created = $this->create($this->cottage(['images' => [UploadedFile::fake()->image('old.jpg')]]));
        $id = $created->json('data.id');
        $oldImage = $created->json('data.images.0');

        $updated = $this->actingAs($this->owner, 'sanctum')->post($this->url('/'.$id), $this->cottage([
            '_method' => 'PUT', 'price' => 950, 'remove_image_ids' => [$oldImage['id']], 'images' => [UploadedFile::fake()->image('new.jpg')],
        ]), ['Accept' => 'application/json'])->assertOk();

        $this->assertEquals(950, $updated->json('data.price'));
        $this->assertCount(1, $updated->json('data.images'));
        Storage::disk('public')->assertMissing($oldImage['path']);

        $this->actingAs($this->owner, 'sanctum')->deleteJson($this->url('/'.$id))->assertOk();
        $this->assertSoftDeleted('resort_offerings', ['id' => $id]);
    }

    public function test_only_the_owner_and_only_resorts(): void
    {
        $other = User::create(['email' => 'other@example.com', 'password' => Hash::make('Password123!'), 'role' => 'business_owner', 'account_status' => 'approved']);
        $this->create($this->cottage(), $other)->assertForbidden();
        $this->actingAs($other, 'sanctum')->getJson($this->url())->assertForbidden();

        $restaurant = Business::create(['owner_id' => $this->owner->id, 'business_category_id' => BusinessCategory::create(['name' => 'Restaurant'])->id, 'business_name' => 'Grill', 'status' => 'approved']);
        $this->create($this->cottage(), null, $restaurant)->assertUnprocessable();

        // An offering from another resort is not reachable through this resort's URL.
        $mine = $this->create($this->cottage())->json('data.id');
        $second = Business::create(['owner_id' => $this->owner->id, 'business_category_id' => $this->resort->business_category_id, 'business_name' => 'Second Resort', 'status' => 'approved']);
        $this->actingAs($this->owner, 'sanctum')->getJson($this->url('/'.$mine, $second))->assertNotFound();
    }

    public function test_tourists_see_only_published_bookable_offerings_and_real_card_facts(): void
    {
        $cottage = $this->create($this->cottage(['price' => 800, 'inventory_quantity' => 6]))->json('data.id');
        $this->create($this->cottage(['name' => 'Pool access', 'category' => 'pool_access', 'pricing_basis' => 'per_person', 'price' => 150, 'inventory_mode' => 'capacity', 'inventory_quantity' => 120]));
        $this->create($this->cottage(['name' => 'Draft cabana', 'price' => 50, 'is_published' => false]));
        $draftPartner = $this->create($this->cottage(['name' => 'Hidden hut', 'is_published' => false]))->json('data.id');
        $this->create($this->cottage(['name' => 'Hut grill', 'category' => 'other', 'bookable_independently' => false, 'requires_offering_id' => $draftPartner]));
        $this->create($this->cottage(['name' => 'Cottage grill', 'category' => 'other', 'price' => 200, 'bookable_independently' => false, 'requires_offering_id' => $cottage]));

        $offerings = collect($this->getJson("/api/tourist/explore/{$this->resort->id}")->assertOk()->json('data.resort.offerings'));
        $this->assertEqualsCanonicalizing(['Family cottage', 'Pool access', 'Cottage grill'], $offerings->pluck('name')->all());

        $card = collect($this->getJson('/api/tourist/stays')->json('data.accommodations'))->firstWhere('name', 'Lagoon Pool Resort');
        $this->assertSame(6, $card['cottage_count'], 'units of published cottages');
        $this->assertEquals(150, $card['starting_price'], 'lowest published price (draft ignored)');
        $this->assertSame('per_person', $card['starting_price_basis']);
    }
}
