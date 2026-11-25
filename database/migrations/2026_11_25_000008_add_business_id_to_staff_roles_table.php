<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Staff Management §6 (docs/staff-management-plan.md): custom roles per
 * business. A role with a business_id belongs to that business only; built-in
 * roles (templates) keep business_id NULL. Names are unique per business
 * instead of globally (two businesses may each have a "Cashier"). Built-in
 * names stay unique because the app refuses a custom role that reuses one.
 * Additive: no existing row changes.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('staff_roles', function (Blueprint $table) {
            $table->foreignId('business_id')->nullable()->after('id')->constrained()->cascadeOnDelete();
            $table->foreignId('created_by')->nullable()->after('description')->constrained('users')->nullOnDelete();
        });

        Schema::table('staff_roles', function (Blueprint $table) {
            $table->dropUnique('staff_roles_name_unique');
            $table->unique(['business_id', 'name']);
        });
    }

    public function down(): void
    {
        // Custom roles cannot survive the global unique name: only roll back
        // when none exist (their grants and assignments would otherwise go).
        if (\Illuminate\Support\Facades\DB::table('staff_roles')->whereNotNull('business_id')->exists()) {
            throw new RuntimeException('Custom staff roles exist; remove them before rolling back.');
        }

        Schema::table('staff_roles', function (Blueprint $table) {
            $table->dropUnique(['business_id', 'name']);
            $table->unique('name');
        });

        Schema::table('staff_roles', function (Blueprint $table) {
            $table->dropConstrainedForeignId('created_by');
            $table->dropConstrainedForeignId('business_id');
        });
    }
};
