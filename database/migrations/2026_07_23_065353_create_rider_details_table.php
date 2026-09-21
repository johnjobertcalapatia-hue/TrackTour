<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('rider_details', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('vehicle_type')->nullable();
            $table->string('vehicle_make')->nullable();
            $table->string('vehicle_model')->nullable();
            $table->string('vehicle_plate_number')->nullable();
            $table->year('vehicle_year')->nullable();
            $table->string('license_number')->nullable();
            $table->date('license_expiry')->nullable();
            $table->string('or_cr_number')->nullable();
            $table->string('drivers_license_front')->nullable();
            $table->string('drivers_license_back')->nullable();
            $table->string('or_cr_image')->nullable();
            $table->string('nbi_clearance')->nullable();
            $table->string('drug_test_result')->nullable();
            $table->string('rider_status')->default('offline');
            $table->timestamp('rider_status_updated_at')->nullable();
            $table->string('current_service')->default('food');
            $table->timestamps();

            $table->unique('user_id');
        });

        // Migrate existing rider data from user_profiles
        $profiles = DB::table('user_profiles')
            ->join('users', 'users.id', '=', 'user_profiles.user_id')
            ->where('users.role', 'rider')
            ->select(
                'user_profiles.user_id',
                'user_profiles.vehicle_type',
                'user_profiles.vehicle_make',
                'user_profiles.vehicle_model',
                'user_profiles.vehicle_plate_number',
                'user_profiles.vehicle_year',
                'user_profiles.license_number',
                'user_profiles.license_expiry',
                'user_profiles.or_cr_number',
                'user_profiles.drivers_license_front',
                'user_profiles.drivers_license_back',
                'user_profiles.or_cr_image',
                'user_profiles.nbi_clearance',
                'user_profiles.drug_test_result'
            )
            ->get();

        foreach ($profiles as $profile) {
            $user = DB::table('users')->where('id', $profile->user_id)->first();
            DB::table('rider_details')->insert([
                'user_id' => $profile->user_id,
                'vehicle_type' => $profile->vehicle_type,
                'vehicle_make' => $profile->vehicle_make,
                'vehicle_model' => $profile->vehicle_model,
                'vehicle_plate_number' => $profile->vehicle_plate_number,
                'vehicle_year' => $profile->vehicle_year,
                'license_number' => $profile->license_number,
                'license_expiry' => $profile->license_expiry,
                'or_cr_number' => $profile->or_cr_number,
                'drivers_license_front' => $profile->drivers_license_front,
                'drivers_license_back' => $profile->drivers_license_back,
                'or_cr_image' => $profile->or_cr_image,
                'nbi_clearance' => $profile->nbi_clearance,
                'drug_test_result' => $profile->drug_test_result,
                'rider_status' => $user->rider_status ?? 'offline',
                'rider_status_updated_at' => $user->rider_status_updated_at,
                'current_service' => $user->current_service ?? 'food',
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }

        // Drop rider columns from user_profiles
        Schema::table('user_profiles', function (Blueprint $table) {
            $table->dropColumn([
                'vehicle_type', 'vehicle_make', 'vehicle_model',
                'vehicle_plate_number', 'vehicle_year',
                'license_number', 'license_expiry', 'or_cr_number',
                'drivers_license_front', 'drivers_license_back',
                'or_cr_image', 'nbi_clearance', 'drug_test_result',
            ]);
        });

        // Drop rider columns from users
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn(['rider_status', 'rider_status_updated_at', 'current_service']);
        });
    }

    public function down(): void
    {
        // Restore rider columns to users
        Schema::table('users', function (Blueprint $table) {
            $table->string('rider_status')->default('offline')->after('email_verified_at');
            $table->timestamp('rider_status_updated_at')->nullable()->after('rider_status');
            $table->string('current_service')->default('food')->after('rider_status_updated_at');
        });

        // Restore rider columns to user_profiles
        Schema::table('user_profiles', function (Blueprint $table) {
            $table->string('vehicle_type')->nullable()->after('house_no_street');
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

        // Migrate data back
        $riderDetails = DB::table('rider_details')->get();
        foreach ($riderDetails as $rd) {
            DB::table('users')->where('id', $rd->user_id)->update([
                'rider_status' => $rd->rider_status,
                'rider_status_updated_at' => $rd->rider_status_updated_at,
                'current_service' => $rd->current_service,
            ]);
            DB::table('user_profiles')->where('user_id', $rd->user_id)->update([
                'vehicle_type' => $rd->vehicle_type,
                'vehicle_make' => $rd->vehicle_make,
                'vehicle_model' => $rd->vehicle_model,
                'vehicle_plate_number' => $rd->vehicle_plate_number,
                'vehicle_year' => $rd->vehicle_year,
                'license_number' => $rd->license_number,
                'license_expiry' => $rd->license_expiry,
                'or_cr_number' => $rd->or_cr_number,
                'drivers_license_front' => $rd->drivers_license_front,
                'drivers_license_back' => $rd->drivers_license_back,
                'or_cr_image' => $rd->or_cr_image,
                'nbi_clearance' => $rd->nbi_clearance,
                'drug_test_result' => $rd->drug_test_result,
            ]);
        }

        Schema::dropIfExists('rider_details');
    }
};
