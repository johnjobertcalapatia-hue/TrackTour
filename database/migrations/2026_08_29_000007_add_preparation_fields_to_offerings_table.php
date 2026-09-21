<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('offerings', function (Blueprint $table) {
            $table->unsignedInteger('preparation_record_count')->default(0)->after('sort_order');
            $table->boolean('prediction_eligible')->default(false)->after('preparation_record_count');
        });
    }

    public function down(): void
    {
        Schema::table('offerings', function (Blueprint $table) {
            $table->dropColumn(['preparation_record_count', 'prediction_eligible']);
        });
    }
};
