<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Stage 6 — cashout validation against the permanent earnings ledger.
 * Every validation of a cashout (at request, approval, payment, or on
 * demand) is stored here, append-only: PASS / FLAG / BLOCK with its checks,
 * the GCash destination fingerprint it saw, and — for an approved FLAG — the
 * staff member's documented investigation decision.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('rider_payout_validations', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('rider_payout_id')->index();
            $table->string('context', 16);                  // request | approve | pay | manual
            $table->string('result', 8);                    // pass | flag | block
            $table->json('checks');
            $table->char('destination_fingerprint', 64);
            $table->text('decision_note')->nullable();
            $table->unsignedBigInteger('checked_by')->nullable();
            $table->timestamp('created_at')->nullable();
        });

        $driver = DB::getDriverName();
        foreach (['UPDATE', 'DELETE'] as $op) {
            $name = 'rider_payout_validations_no_'.strtolower($op);
            if ($driver === 'sqlite') {
                DB::unprepared("CREATE TRIGGER {$name} BEFORE {$op} ON rider_payout_validations BEGIN SELECT RAISE(ABORT, 'rider_payout_validations is append-only'); END;");
            } elseif (in_array($driver, ['mysql', 'mariadb'], true)) {
                DB::unprepared("CREATE TRIGGER {$name} BEFORE {$op} ON rider_payout_validations FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'rider_payout_validations is append-only'");
            }
        }
    }

    public function down(): void
    {
        DB::unprepared('DROP TRIGGER IF EXISTS rider_payout_validations_no_update');
        DB::unprepared('DROP TRIGGER IF EXISTS rider_payout_validations_no_delete');
        Schema::dropIfExists('rider_payout_validations');
    }
};
