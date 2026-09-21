<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::table('tourism_settings')->updateOrInsert(
            ['key' => 'ocr_enabled'],
            ['value' => '1', 'created_at' => now(), 'updated_at' => now()]
        );
    }

    public function down(): void
    {
        DB::table('tourism_settings')->where('key', 'ocr_enabled')->delete();
    }
};
