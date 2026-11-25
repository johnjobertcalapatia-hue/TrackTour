<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Municipality;
use App\Models\RequiredDocument;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * Aelia Cafe and Cafe Dayo were registered under Restaurant before production
 * had a Café category. Migration 2026_11_28_000005 moves them to Café without
 * re-approval, keeps their uploaded documents counting, and leaves the real
 * restaurants alone.
 */
class MoveCafesToCafeCategoryTest extends TestCase
{
    use RefreshDatabase;

    private BusinessCategory $restaurant;
    private BusinessCategory $cafe;
    private Business $aelia;
    private Business $dayo;
    private Business $parine;

    protected function setUp(): void
    {
        parent::setUp();
        // Like production before deploy: Restaurant only, no Café.
        BusinessCategory::whereIn('name', ['Café', 'Cafe'])->delete();
        $this->restaurant = BusinessCategory::firstOrCreate(['name' => 'Restaurant']);
        RequiredDocument::create(['business_category_id' => $this->restaurant->id, 'document_code' => 'mayors_permit', 'document_name' => "Mayor's Permit", 'required_fields' => ['document_number']]);

        $muni = Municipality::create(['name' => 'Gloria', 'district' => '1st', 'province' => 'Oriental Mindoro']);
        $owner = User::create(['email' => 'owner@cafes.test', 'password' => Hash::make('x'), 'role' => 'business_owner', 'account_status' => 'approved']);
        $make = fn (string $name, string $status) => Business::create(['owner_id' => $owner->id, 'business_category_id' => $this->restaurant->id, 'municipality_id' => $muni->id, 'business_name' => $name, 'status' => $status]);
        $this->aelia = $make('Aelia Cafe', 'approved');
        $this->dayo = $make('Cafe Dayo', 'approved');
        $this->parine = $make('Parine', 'under_review');

        // Deploy order: 000004 creates Café (copying Restaurant's documents), then the cafés get their uploads moved.
        $this->runMigration('2026_11_28_000004_add_cafe_business_category.php');
        $this->cafe = BusinessCategory::where('name', 'Café')->firstOrFail();

        $restaurantPermit = RequiredDocument::where('business_category_id', $this->restaurant->id)->value('id');
        DB::table('business_document_uploads')->insert([
            'business_id' => $this->aelia->id, 'required_document_id' => $restaurantPermit,
            'file_path' => 'docs/permit.pdf', 'created_at' => now(), 'updated_at' => now(),
        ]);
        $menu = DB::table('business_modules')->where('code', 'menu_management')->value('id');
        $delivery = DB::table('business_modules')->where('code', 'delivery_management')->value('id');
        DB::table('business_module_assignments')->insert([
            ['business_id' => $this->aelia->id, 'business_module_id' => $menu, 'is_active' => false, 'created_at' => now(), 'updated_at' => now()],
            ['business_id' => $this->aelia->id, 'business_module_id' => $delivery, 'is_active' => true, 'created_at' => now(), 'updated_at' => now()],
        ]);
    }

    private function runMigration(string $file, string $direction = 'up'): void
    {
        $migration = require database_path("migrations/{$file}");
        $migration->{$direction}();
    }

    private function moveCafes(string $direction = 'up'): void
    {
        $this->runMigration('2026_11_28_000005_move_cafes_from_restaurant_to_cafe.php', $direction);
    }

    public function test_cafes_move_to_cafe_and_restaurants_stay(): void
    {
        $this->moveCafes();

        $this->assertSame($this->cafe->id, $this->aelia->fresh()->business_category_id);
        $this->assertSame($this->cafe->id, $this->dayo->fresh()->business_category_id);
        $this->assertSame($this->restaurant->id, $this->parine->fresh()->business_category_id);

        // No re-approval: the cafés stay visible to tourists.
        $this->assertSame('approved', $this->aelia->fresh()->status);
        $this->assertTrue($this->aelia->fresh()->isRestaurant());
    }

    public function test_uploaded_documents_point_to_cafe_documents(): void
    {
        $this->moveCafes();

        $cafePermit = RequiredDocument::where('business_category_id', $this->cafe->id)->where('document_code', 'mayors_permit')->value('id');
        $this->assertSame(
            [$cafePermit],
            DB::table('business_document_uploads')->where('business_id', $this->aelia->id)->pluck('required_document_id')->map(fn ($id) => (int) $id)->all(),
        );
    }

    public function test_modules_are_kept_and_missing_cafe_modules_added(): void
    {
        $this->moveCafes();

        $modules = DB::table('business_module_assignments as a')
            ->join('business_modules as m', 'm.id', '=', 'a.business_module_id')
            ->where('a.business_id', $this->aelia->id)
            ->pluck('a.is_active', 'm.code');

        $this->assertFalse((bool) $modules['menu_management']);   // owner turned it off: stays off
        $this->assertTrue((bool) $modules['delivery_management']); // kept
        $this->assertTrue((bool) $modules['pos_sales']);           // Café module added
    }

    public function test_running_twice_changes_nothing_and_down_moves_them_back(): void
    {
        $this->moveCafes();
        $this->moveCafes();
        $this->assertSame($this->cafe->id, $this->aelia->fresh()->business_category_id);

        $this->moveCafes('down');

        $this->assertSame($this->restaurant->id, $this->aelia->fresh()->business_category_id);
        $this->assertSame($this->restaurant->id, $this->dayo->fresh()->business_category_id);
        $restaurantPermit = RequiredDocument::where('business_category_id', $this->restaurant->id)->value('id');
        $this->assertSame((int) $restaurantPermit, (int) DB::table('business_document_uploads')->where('business_id', $this->aelia->id)->value('required_document_id'));
    }
}
