<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropForeign(['municipality_id']);
        });

        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn([
                'municipality_id',
                'first_name',
                'middle_name',
                'last_name',
                'suffix',
                'date_of_birth',
                'sex',
                'nationality',
                'mobile_number',
                'barangay',
                'house_no_street',
                'zip_code',
                'government_id_type',
                'government_id_number',
                'valid_id_front',
                'valid_id_back',
                'selfie_holding_id',
                'tin',
                'business_name',
                'business_category',
                'business_description',
                'business_contact_number',
                'business_email',
                'business_address',
            ]);
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->foreignId('municipality_id')->nullable()->after('role')->constrained()->nullOnDelete();
            $table->string('first_name')->nullable()->after('name');
            $table->string('middle_name')->nullable()->after('first_name');
            $table->string('last_name')->nullable()->after('middle_name');
            $table->string('suffix')->nullable()->after('last_name');
            $table->date('date_of_birth')->nullable()->after('suffix');
            $table->string('sex')->nullable()->after('date_of_birth');
            $table->string('nationality')->nullable()->after('sex');
            $table->string('mobile_number')->nullable()->after('nationality');
            $table->string('barangay')->nullable()->after('municipality_id');
            $table->string('house_no_street')->nullable()->after('barangay');
            $table->string('zip_code')->nullable()->after('house_no_street');
            $table->string('government_id_type')->nullable()->after('zip_code');
            $table->string('government_id_number')->nullable()->after('government_id_type');
            $table->string('valid_id_front')->nullable()->after('government_id_number');
            $table->string('valid_id_back')->nullable()->after('valid_id_front');
            $table->string('selfie_holding_id')->nullable()->after('valid_id_back');
            $table->string('tin')->nullable()->after('selfie_holding_id');
            $table->string('business_name')->nullable()->after('tin');
            $table->string('business_category')->nullable()->after('business_name');
            $table->text('business_description')->nullable()->after('business_category');
            $table->string('business_contact_number')->nullable()->after('business_description');
            $table->string('business_email')->nullable()->after('business_contact_number');
            $table->string('business_address')->nullable()->after('business_email');
        });
    }
};
