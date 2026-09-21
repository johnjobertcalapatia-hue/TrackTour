<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('user_profiles', function (Blueprint $table) {
            $table->string('vehicle_type')->nullable()->after('zip_code');
            $table->string('vehicle_make')->nullable()->after('vehicle_type');
            $table->string('vehicle_model')->nullable()->after('vehicle_make');
            $table->string('vehicle_plate_number')->nullable()->after('vehicle_model');
            $table->year('vehicle_year')->nullable()->after('vehicle_plate_number');
            $table->string('license_number')->nullable()->after('vehicle_year');
            $table->date('license_expiry')->nullable()->after('license_number');
            $table->string('or_cr_number')->nullable()->after('license_expiry');
            $table->string('drivers_license_front')->nullable()->after('or_cr_number');
            $table->string('drivers_license_back')->nullable()->after('drivers_license_front');
            $table->string('or_cr_image')->nullable()->after('drivers_license_back');
            $table->string('nbi_clearance')->nullable()->after('or_cr_image');
            $table->string('drug_test_result')->nullable()->after('nbi_clearance');
        });
    }

    public function down(): void
    {
        Schema::table('user_profiles', function (Blueprint $table) {
            $table->dropColumn([
                'vehicle_type', 'vehicle_make', 'vehicle_model', 'vehicle_plate_number', 'vehicle_year',
                'license_number', 'license_expiry', 'or_cr_number',
                'drivers_license_front', 'drivers_license_back', 'or_cr_image',
                'nbi_clearance', 'drug_test_result',
            ]);
        });
    }
};
