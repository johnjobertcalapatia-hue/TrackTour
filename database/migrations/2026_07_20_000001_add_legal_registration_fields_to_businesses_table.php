<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('businesses', function (Blueprint $table) {
            $table->string('legal_entity_type')->nullable()->after('status')->comment('Sole Proprietorship, Partnership, Corporation, OPC');
            $table->string('tin')->nullable()->after('legal_entity_type');
            $table->string('dti_sec_reg_number')->nullable()->after('tin');
            $table->unsignedSmallInteger('year_established')->nullable()->after('dti_sec_reg_number');
            $table->string('owner_full_name')->nullable()->after('year_established');
            $table->text('owner_address')->nullable()->after('owner_full_name');
            $table->decimal('initial_capital', 15, 2)->nullable()->after('owner_address');
            $table->decimal('gross_floor_area', 10, 2)->nullable()->after('initial_capital')->comment('square meters');
            $table->unsignedInteger('number_of_employees')->nullable()->after('gross_floor_area');
            $table->string('occupancy_status')->nullable()->after('number_of_employees')->comment('Owned, Rented');
            $table->string('building_number')->nullable()->after('occupancy_status');
        });
    }

    public function down(): void
    {
        Schema::table('businesses', function (Blueprint $table) {
            $table->dropColumn([
                'legal_entity_type',
                'tin',
                'dti_sec_reg_number',
                'year_established',
                'owner_full_name',
                'owner_address',
                'initial_capital',
                'gross_floor_area',
                'number_of_employees',
                'occupancy_status',
                'building_number',
            ]);
        });
    }
};
