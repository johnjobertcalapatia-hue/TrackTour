<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::table('businesses')->where('id', 38)->delete();
    }

    public function down(): void
    {
        DB::table('businesses')->insert([
            'id' => 38,
            'owner_id' => 1,
            'business_name' => 'My Restaurants',
            'status' => 'under_review',
            'created_at' => '2026-07-25 11:01:50',
            'updated_at' => '2026-07-25 11:01:50',
        ]);
    }
};
