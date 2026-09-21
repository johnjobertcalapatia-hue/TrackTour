<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('businesses', function (Blueprint $table) {
            if (!Schema::hasColumn('businesses', 'other_social_media')) {
                $table->string('other_social_media', 500)->nullable()->after('instagram');
            }
            if (!Schema::hasColumn('businesses', 'postal_code')) {
                $table->string('postal_code', 10)->nullable()->after('building_number');
            }
            if (!Schema::hasColumn('businesses', 'opening_date')) {
                $table->date('opening_date')->nullable()->after('year_established');
            }
            if (!Schema::hasColumn('businesses', 'business_size')) {
                $table->string('business_size', 20)->nullable()->after('number_of_employees');
            }
            if (!Schema::hasColumn('businesses', 'ownership_status')) {
                $table->string('ownership_status', 20)->nullable();
            }
            if (!Schema::hasColumn('businesses', 'special_offers')) {
                $table->text('special_offers')->nullable();
            }
        });
    }

    public function down(): void
    {
        Schema::table('businesses', function (Blueprint $table) {
            $table->dropColumn([
                'other_social_media',
                'postal_code',
                'opening_date',
                'business_size',
                'ownership_status',
                'special_offers',
            ]);
        });
    }
};
