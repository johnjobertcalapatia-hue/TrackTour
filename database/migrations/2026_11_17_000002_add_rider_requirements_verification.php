<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Rider onboarding phase 1 → phase 2 gate: the Tourism Office verifies and
 * validates the submitted requirements before training is scheduled.
 *
 * Applicants who submitted under the earlier flow (submission was the
 * acceptance and training was scheduled immediately) are backfilled as
 * verified so their existing appointments stay valid.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('rider_details', function (Blueprint $table) {
            $table->timestamp('requirements_verified_at')->nullable()->after('application_submitted_at');
            $table->foreignId('requirements_verified_by')->nullable()->after('requirements_verified_at')->constrained('users')->nullOnDelete();
            $table->string('requirements_remarks', 500)->nullable()->after('requirements_verified_by');
        });

        DB::table('rider_details')
            ->whereNotNull('application_submitted_at')
            ->whereNull('requirements_verified_at')
            ->update(['requirements_verified_at' => DB::raw('application_submitted_at')]);
    }

    public function down(): void
    {
        Schema::table('rider_details', function (Blueprint $table) {
            $table->dropConstrainedForeignId('requirements_verified_by');
            $table->dropColumn(['requirements_verified_at', 'requirements_remarks']);
        });
    }
};
