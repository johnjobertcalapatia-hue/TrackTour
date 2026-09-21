<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('businesses', function (Blueprint $table) {
            $table->string('facebook')->nullable()->after('website');
            $table->string('instagram')->nullable()->after('facebook');
            $table->foreignId('barangay_id')->nullable()->after('municipality_id')->constrained()->nullOnDelete();
            $table->time('opening_time')->nullable()->after('longitude');
            $table->time('closing_time')->nullable()->after('opening_time');
            $table->json('business_days')->nullable()->after('closing_time');
            $table->text('holiday_schedule')->nullable()->after('business_days');
        });
    }

    public function down(): void
    {
        Schema::table('businesses', function (Blueprint $table) {
            $table->dropColumn(['facebook', 'instagram', 'barangay_id', 'opening_time', 'closing_time', 'business_days', 'holiday_schedule']);
        });
    }
};
