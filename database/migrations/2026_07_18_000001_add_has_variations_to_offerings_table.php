<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('offerings', function (Blueprint $table) {
            $table->boolean('has_variations')->default(false)->after('bestseller');
        });
    }

    public function down(): void
    {
        Schema::table('offerings', function (Blueprint $table) {
            $table->dropColumn('has_variations');
        });
    }
};
