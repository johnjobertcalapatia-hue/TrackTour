<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::table('businesses')
            ->where('status', 'draft')
            ->update(['status' => 'under_review']);
    }

    public function down(): void
    {
        DB::table('businesses')
            ->where('status', 'under_review')
            ->update(['status' => 'draft']);
    }
};
