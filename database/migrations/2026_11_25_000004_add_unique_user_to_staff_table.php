<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;

/**
 * Staff Management Stage 1: a staff account belongs to exactly one business
 * (UNIQUE staff.user_id; soft-deleted rows included, so a removed staff
 * member's account is never re-linked to another business).
 *
 * Existing data is never changed: if a user is already linked to several
 * businesses the index is not added, a warning is logged, and the application
 * check (BusinessOwnerStaffController creates staff only for new accounts)
 * still applies. Resolve the duplicates and re-run to add the index.
 */
return new class extends Migration
{
    public function up(): void
    {
        $duplicates = DB::table('staff')->select('user_id')->groupBy('user_id')->havingRaw('COUNT(*) > 1')->pluck('user_id');
        if ($duplicates->isNotEmpty()) {
            Log::warning('staff.user_id UNIQUE not added: users linked to several businesses', ['user_ids' => $duplicates->all()]);

            return;
        }

        Schema::table('staff', function (Blueprint $table) {
            $table->unique('user_id', 'staff_user_id_unique');
        });
    }

    public function down(): void
    {
        if (collect(Schema::getIndexes('staff'))->contains(fn ($index) => $index['name'] === 'staff_user_id_unique')) {
            Schema::table('staff', function (Blueprint $table) {
                $table->dropUnique('staff_user_id_unique');
            });
        }
    }
};
