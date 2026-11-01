<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('rider_daily_cash_movement_correction_cycles', function (Blueprint $table) {
            $table->id();
            $table->foreignId('movement_id')
                ->constrained('rider_daily_cash_movements')
                ->restrictOnDelete();
            $table->foreignId('correction_id')
                // Explicit name: the implicit {table}_{column}_foreign form is
                // 65 characters — one over MySQL's 64-character identifier
                // limit (error 1059).
                ->constrained('rider_daily_reconciliation_corrections', 'id', 'rider_daily_recon_cycle_corr_fk')
                ->restrictOnDelete();
            $table->timestamps();

            $table->unique(['movement_id', 'correction_id'], 'rider_cash_movement_correction_unique');
            $table->index('correction_id', 'rider_cash_correction_movement_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('rider_daily_cash_movement_correction_cycles');
    }
};
