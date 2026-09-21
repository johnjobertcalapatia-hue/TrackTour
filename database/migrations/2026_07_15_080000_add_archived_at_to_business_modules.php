<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('business_modules', function (Blueprint $table) {
            $table->timestamp('archived_at')->nullable()->after('sort_order');
        });
    }

    public function down(): void
    {
        Schema::table('business_modules', function (Blueprint $table) {
            $table->dropColumn('archived_at');
        });
    }
};
