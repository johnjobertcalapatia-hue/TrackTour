<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * System incident history: every failure the platform sees (failed logins,
 * rejected uploads, failed payments and refunds, dispatch failures, server
 * errors, failed jobs, diagnostics problems), kept as a record with how and
 * by whom it was fixed.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('system_incidents', function (Blueprint $table) {
            $table->id();
            $table->string('category', 32);                 // auth | access | upload | payment | refund | dispatch | jobs | server | diagnostics
            $table->string('code', 64);                     // e.g. login_failed, upload_rejected, payment_failed
            $table->string('severity', 16);                 // info | warning | error | critical
            $table->string('status', 16)->default('open');  // open | recorded | resolved | dismissed
            $table->string('title');
            $table->text('message')->nullable();
            $table->json('context')->nullable();            // sanitised: never passwords, tokens or file contents
            $table->foreignId('user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('ip_address', 45)->nullable();
            $table->string('method', 10)->nullable();
            $table->string('path')->nullable();
            $table->nullableMorphs('subject');
            $table->char('fingerprint', 40);                // groups "the same problem" for counts and bulk fixes
            // Explicit default: without one MySQL/MariaDB silently adds ON UPDATE
            // CURRENT_TIMESTAMP, which would overwrite "when it happened" on every fix.
            $table->timestamp('occurred_at')->useCurrent();
            $table->timestamp('resolved_at')->nullable();
            $table->foreignId('resolved_by')->nullable()->constrained('users')->nullOnDelete();
            $table->text('resolution')->nullable();
            $table->timestamps();

            $table->index(['occurred_at']);
            $table->index(['category', 'occurred_at']);
            $table->index(['status', 'occurred_at']);
            $table->index(['fingerprint', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('system_incidents');
    }
};
