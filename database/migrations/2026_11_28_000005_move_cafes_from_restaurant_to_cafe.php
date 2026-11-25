<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Cafés registered as restaurants move to the Café category (2026-11-28).
 *
 * Before 2026_11_28_000004 production had no Café category, so Aelia Cafe and
 * Cafe Dayo were registered under Restaurant. Matched by exact name AND a
 * Restaurant category, so a business renamed or already moved is left alone.
 *
 * For each café:
 *  - business_category_id becomes Café; its status is kept (no re-approval:
 *    the office already approved these businesses);
 *  - each uploaded document is re-pointed to Café's required document with the
 *    same document_code (Café's list was copied from Restaurant), so its
 *    compliance stays the same;
 *  - module assignments are kept, and any Café module it lacks is added.
 */
return new class extends Migration
{
    private const BUSINESSES = ['Aelia Cafe', 'Cafe Dayo'];

    private const CAFE_NAMES = ['café', 'cafe', 'cafés', 'cafes'];

    private const RESTAURANT_NAMES = ['restaurant', 'restaurants'];

    public function up(): void
    {
        $this->move(from: self::RESTAURANT_NAMES, to: self::CAFE_NAMES, addModules: true);
    }

    public function down(): void
    {
        $this->move(from: self::CAFE_NAMES, to: self::RESTAURANT_NAMES, addModules: false);
    }

    private function move(array $from, array $to, bool $addModules): void
    {
        foreach (['business_categories', 'businesses'] as $table) {
            if (! Schema::hasTable($table)) {
                return;
            }
        }

        $fromIds = $this->categoryIds($from);
        $toId = $this->categoryIds($to)->first();
        if ($fromIds->isEmpty() || ! $toId) {
            return;
        }

        $businessIds = DB::table('businesses')
            ->whereIn('business_name', self::BUSINESSES)
            ->whereIn('business_category_id', $fromIds)
            ->pluck('id');

        $now = now();
        foreach ($businessIds as $businessId) {
            DB::table('businesses')->where('id', $businessId)
                ->update(['business_category_id' => $toId, 'updated_at' => $now]);

            $this->repointDocuments($businessId, $toId, $now);
            if ($addModules) {
                $this->addMissingModules($businessId, $toId, $now);
            }
            Cache::forget("business_{$businessId}_modules");
        }
    }

    /** Active categories first, so an archived duplicate is never the target. */
    private function categoryIds(array $lowerNames)
    {
        return DB::table('business_categories')
            ->whereIn(DB::raw('LOWER(name)'), $lowerNames)
            ->orderByRaw('archived_at IS NOT NULL')
            ->orderBy('id')
            ->pluck('id');
    }

    private function repointDocuments(int $businessId, int $categoryId, $now): void
    {
        if (! Schema::hasTable('business_document_uploads') || ! Schema::hasTable('required_documents')) {
            return;
        }

        $targets = DB::table('required_documents')
            ->where('business_category_id', $categoryId)
            ->orderByRaw('archived_at IS NOT NULL')
            ->get(['id', 'document_code'])
            ->unique('document_code')
            ->pluck('id', 'document_code');

        $uploads = DB::table('business_document_uploads as u')
            ->join('required_documents as d', 'd.id', '=', 'u.required_document_id')
            ->where('u.business_id', $businessId)
            ->where('d.business_category_id', '!=', $categoryId)
            ->get(['u.id', 'd.document_code']);

        foreach ($uploads as $upload) {
            $target = $targets[$upload->document_code] ?? null;
            if ($target) {
                DB::table('business_document_uploads')->where('id', $upload->id)
                    ->update(['required_document_id' => $target, 'updated_at' => $now]);
            }
        }
    }

    private function addMissingModules(int $businessId, int $categoryId, $now): void
    {
        if (! Schema::hasTable('business_type_module') || ! Schema::hasTable('business_module_assignments')) {
            return;
        }

        $moduleIds = DB::table('business_type_module')->where('business_category_id', $categoryId)->pluck('business_module_id');

        DB::table('business_module_assignments')->insertOrIgnore($moduleIds->map(fn ($id) => [
            'business_id' => $businessId,
            'business_module_id' => $id,
            'is_active' => true,
            'created_at' => $now,
            'updated_at' => $now,
        ])->all());
    }
};
