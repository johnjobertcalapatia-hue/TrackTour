<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::table('offerings', function (Blueprint $table) {
            $table->string('status', 20)->default('available')->after('is_available');
        });

        DB::table('offerings')->update([
            'status' => DB::raw("CASE WHEN is_available = 1 THEN 'available' ELSE 'unavailable' END"),
        ]);
    }

    public function down(): void
    {
        Schema::table('offerings', function (Blueprint $table) {
            $table->dropColumn('status');
        });
    }
};
