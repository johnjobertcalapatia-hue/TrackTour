<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('orders', function ($table) {
            $table->unsignedBigInteger('user_id')->nullable()->after('business_id');
            $table->index('user_id');
        });
    }

    public function down(): void
    {
        Schema::table('orders', function ($table) {
            $table->dropIndex(['user_id']);
            $table->dropColumn('user_id');
        });
    }
};
