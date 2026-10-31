<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('rider_daily_reconciliation_corrections', function (Blueprint $table) {
            $table->id();
            $table->foreignId('rider_daily_reconciliation_id')
                ->constrained('rider_daily_reconciliations')
                ->restrictOnDelete();
            $table->unsignedInteger('cycle_number');
            $table->string('status', 24)->default('pending_review');
            $table->json('balance_snapshot')->nullable();
            $table->foreignId('created_by')->constrained('users')->restrictOnDelete();
            $table->foreignId('reviewed_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('reviewed_at')->nullable();
            $table->string('review_decision', 24)->nullable();
            $table->text('review_note')->nullable();
            $table->foreignId('closed_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('closed_at')->nullable();
            $table->timestamps();

            $table->unique(
                ['rider_daily_reconciliation_id', 'cycle_number'],
                'rider_daily_reconciliation_correction_cycle_unique'
            );
            $table->index(
                ['rider_daily_reconciliation_id', 'status'],
                'rider_daily_reconciliation_correction_status_idx'
            );
        });

        Schema::table('rider_daily_cash_movements', function (Blueprint $table) {
            $table->string('reference_type', 32)->nullable();
            $table->string('reference_namespace', 100)->nullable();
            $table->string('reference_source', 100)->nullable();
            $table->string('reference_issuer', 100)->nullable();
            $table->string('reference_series', 100)->nullable();
            $table->string('normalized_reference', 100)->nullable();
            $table->char('reference_fingerprint', 64)->nullable()->unique();
            $table->foreignId('correction_cycle_id')
                ->nullable()
                ->constrained('rider_daily_reconciliation_corrections')
                ->restrictOnDelete();
        });

        Schema::table('rider_daily_cash_movements', function (Blueprint $table) {
            $table->dropUnique('rider_daily_cash_movement_reference_unique');
        });
    }

    public function down(): void
    {
        Schema::table('rider_daily_cash_movements', function (Blueprint $table) {
            $table->dropUnique('rider_daily_cash_movements_reference_fingerprint_unique');
            $table->dropForeign(['correction_cycle_id']);
            $table->dropColumn([
                'reference_type',
                'reference_namespace',
                'reference_source',
                'reference_issuer',
                'reference_series',
                'normalized_reference',
                'reference_fingerprint',
                'correction_cycle_id',
            ]);
        });

        Schema::dropIfExists('rider_daily_reconciliation_corrections');

        Schema::table('rider_daily_cash_movements', function (Blueprint $table) {
            $table->unique(
                ['rider_id', 'business_date', 'movement_type', 'reference'],
                'rider_daily_cash_movement_reference_unique'
            );
        });
    }
};
