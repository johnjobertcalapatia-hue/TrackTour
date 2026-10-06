<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * Normalize legacy offering rows written as status='active' to the canonical
     * available/unavailable/hidden vocabulary (see Offering::scopes).
     */
    public function up(): void
    {
        DB::table('offerings')
            ->where('status', 'active')
            ->update(['status' => 'available', 'is_available' => 1]);
    }

    public function down(): void
    {
        // Data normalization is intentionally not reversible because the
        // original 'active' rows can no longer be identified after the up() run.
    }
};