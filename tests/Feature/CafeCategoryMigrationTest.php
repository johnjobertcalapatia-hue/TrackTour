<?php

namespace Tests\Feature;

use App\Models\BusinessCategory;
use App\Models\RequiredDocument;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * Production had no Café category. Migration 2026_11_28_000004 adds it with
 * the café modules, the restaurant staff roles and the Restaurant category's
 * required documents, idempotently.
 */
class CafeCategoryMigrationTest extends TestCase
{
    use RefreshDatabase;

    private BusinessCategory $restaurant;

    protected function setUp(): void
    {
        parent::setUp();
        // Like production: no Café yet (the migration already ran on this fresh database).
        BusinessCategory::whereIn('name', ['Café', 'Cafe'])->delete();

        $this->restaurant = BusinessCategory::firstOrCreate(['name' => 'Restaurant']);
        foreach (['Order & Pickup Staff', 'Finance Staff', 'Menu & Promotions Staff'] as $role) {
            DB::table('staff_roles')->updateOrInsert(['name' => $role, 'business_id' => null], ['created_at' => now(), 'updated_at' => now()]);
        }
        $this->restaurantDocument('mayors_permit', "Mayor's Permit", true);
        $this->restaurantDocument('lease_contract', 'Notarized Lease Contract', false);
        $this->restaurantDocument('old_permit', 'Old Permit', true, archived: true);
    }

    private function restaurantDocument(string $code, string $name, bool $required, bool $archived = false): void
    {
        RequiredDocument::create([
            'business_category_id' => $this->restaurant->id,
            'document_code' => $code,
            'document_name' => $name,
            'is_required' => $required,
            'required_fields' => ['document_number'],
            'archived_at' => $archived ? now() : null,
        ]);
    }

    private function runMigration(): void
    {
        $migration = require database_path('migrations/2026_11_28_000004_add_cafe_business_category.php');
        $migration->up();
    }

    private function cafe(): ?BusinessCategory
    {
        return BusinessCategory::where('name', 'Café')->first();
    }

    public function test_adds_cafe_with_modules_staff_roles_and_restaurant_documents(): void
    {
        $this->runMigration();

        $cafe = $this->cafe();
        $this->assertNotNull($cafe);
        $this->assertNull($cafe->archived_at);

        $codes = $cafe->modules()->pluck('code')->all();
        $this->assertContains('menu_management', $codes);
        $this->assertContains('food_ordering', $codes);
        $this->assertNotContains('delivery_management', $codes);

        $this->assertEqualsCanonicalizing(
            ['Order & Pickup Staff', 'Finance Staff', 'Menu & Promotions Staff'],
            $cafe->staffRoles()->pluck('name')->all(),
        );

        $docs = RequiredDocument::where('business_category_id', $cafe->id)->get()->keyBy('document_code');
        $this->assertEqualsCanonicalizing(['mayors_permit', 'lease_contract'], $docs->keys()->all());
        $this->assertTrue((bool) $docs['mayors_permit']->is_required);
        $this->assertFalse((bool) $docs['lease_contract']->is_required);
    }

    public function test_running_twice_changes_nothing(): void
    {
        $this->runMigration();
        $this->runMigration();

        $this->assertSame(1, BusinessCategory::where('name', 'Café')->count());
        $cafe = $this->cafe();
        $this->assertSame(2, RequiredDocument::where('business_category_id', $cafe->id)->count());
        $this->assertSame(3, $cafe->staffRoles()->count());
    }

    public function test_a_fresh_install_without_categories_is_left_to_the_seeders(): void
    {
        RequiredDocument::query()->delete();
        BusinessCategory::query()->delete();

        $this->runMigration();

        $this->assertSame(0, BusinessCategory::count());
    }

    public function test_restores_an_archived_cafe_and_keeps_its_admin_choices(): void
    {
        $cafe = BusinessCategory::create(['name' => 'Café', 'archived_at' => now()]);
        $moduleId = DB::table('business_modules')->where('code', 'business_profile')->value('id');
        $cafe->modules()->attach($moduleId);

        $this->runMigration();

        $this->assertSame(1, BusinessCategory::where('name', 'Café')->count());
        $this->assertNull($cafe->fresh()->archived_at);
        $this->assertSame(['business_profile'], $cafe->modules()->pluck('code')->all());
    }
}
