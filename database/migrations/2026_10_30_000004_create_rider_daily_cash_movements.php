<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('rider_daily_cash_movements', function (Blueprint $table) {
            $table->id();
            $table->foreignId('rider_id')->constrained('users')->restrictOnDelete();
            $table->foreignId('municipality_id')->constrained('municipalities')->restrictOnDelete();
            $table->date('business_date');
            $table->foreignId('rider_daily_reconciliation_id')
                ->nullable()
                ->constrained('rider_daily_reconciliations')
                ->restrictOnDelete();
            $table->unsignedInteger('revision')->nullable();
            $table->string('movement_type', 40);
            $table->string('affects_type', 40)->nullable();
            $table->decimal('amount', 12, 2);
            $table->foreignId('recorded_by')->constrained('users')->restrictOnDelete();
            $table->timestamp('transaction_at');
            $table->string('reference', 100)->nullable();
            $table->text('evidence_details')->nullable();
            $table->string('idempotency_key', 64)->unique();
            $table->foreignId('reverses_movement_id')
                ->nullable()
                ->unique()
                ->constrained('rider_daily_cash_movements')
                ->restrictOnDelete();
            $table->foreignId('adjusts_movement_id')
                ->nullable()
                ->constrained('rider_daily_cash_movements')
                ->restrictOnDelete();
            $table->timestamps();

            $table->index(
                ['rider_id', 'business_date', 'movement_type'],
                'rider_daily_cash_movement_balance_idx'
            );
            $table->index(
                ['rider_daily_reconciliation_id', 'revision'],
                'rider_daily_cash_movement_reconciliation_idx'
            );
            $table->unique(
                ['rider_id', 'business_date', 'movement_type', 'reference'],
                'rider_daily_cash_movement_reference_unique'
            );
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('rider_daily_cash_movements');
    }
};
