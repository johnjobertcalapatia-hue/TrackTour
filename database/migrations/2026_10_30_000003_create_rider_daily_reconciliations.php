<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('rider_daily_reconciliations', function (Blueprint $table) {
            $table->id();
            $table->foreignId('rider_id')->constrained('users')->restrictOnDelete();
            $table->foreignId('municipality_id')->constrained('municipalities')->restrictOnDelete();
            $table->date('working_date');
            $table->unsignedInteger('revision');
            $table->string('status', 24)->default('submitted');
            $table->string('idempotency_key', 64)->unique();
            $table->decimal('expected_cod_remittance', 12, 2);
            $table->decimal('expected_office_cash_return', 12, 2);
            $table->decimal('expected_rider_payable', 12, 2);
            $table->decimal('submitted_cod_remittance', 12, 2);
            $table->decimal('submitted_office_cash_return', 12, 2);
            $table->string('remittance_reference', 100);
            $table->text('rider_note')->nullable();
            $table->json('receipt_snapshot');
            $table->timestamp('submitted_at');
            $table->decimal('verified_cod_received', 12, 2)->nullable();
            $table->decimal('verified_office_cash_return', 12, 2)->nullable();
            $table->decimal('verified_rider_reimbursement', 12, 2)->nullable();
            $table->text('verification_note')->nullable();
            $table->foreignId('verified_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('verified_at')->nullable();
            $table->foreignId('closed_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('closed_at')->nullable();
            $table->timestamps();

            $table->unique(['rider_id', 'working_date', 'revision'], 'rider_daily_reconciliation_revision_unique');
            $table->index(['municipality_id', 'working_date', 'status'], 'rider_daily_reconciliation_scope_idx');
        });

        Schema::create('rider_daily_reconciliation_events', function (Blueprint $table) {
            $table->id();
            $table->foreignId('rider_daily_reconciliation_id')
                ->constrained('rider_daily_reconciliations')
                ->restrictOnDelete();
            $table->foreignId('actor_id')->constrained('users')->restrictOnDelete();
            $table->string('action', 32);
            $table->string('from_status', 24)->nullable();
            $table->string('to_status', 24);
            $table->string('idempotency_key', 64)->nullable()->unique();
            $table->json('details')->nullable();
            $table->timestamp('created_at');

            $table->index(['rider_daily_reconciliation_id', 'created_at'], 'rider_daily_recon_events_history_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('rider_daily_reconciliation_events');
        Schema::dropIfExists('rider_daily_reconciliations');
    }
};
