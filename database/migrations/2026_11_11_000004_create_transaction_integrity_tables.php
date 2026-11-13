<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Secure transaction architecture, Stage 2 (docs/secure-transaction-audit.md).
 *
 * transaction_blueprints        one per food-delivery / ride order (references orders.id)
 * transaction_events            append-only, SHA-256 hash-chained event history
 * transaction_integrity_checks  every verification result (pass / flag / block)
 * transaction_checkpoints       HMAC-signed snapshots of every chain head
 * transaction_checkpoint_entries the heads a checkpoint covers
 *
 * The event and checkpoint tables are protected by database triggers that
 * refuse UPDATE and DELETE, so ordinary application code cannot rewrite them.
 */
return new class extends Migration
{
    private const PROTECTED = ['transaction_events', 'transaction_checkpoints', 'transaction_checkpoint_entries'];

    public function up(): void
    {
        Schema::create('transaction_blueprints', function (Blueprint $table) {
            $table->id();
            $table->uuid('blueprint_uid')->unique();
            $table->string('transaction_type', 32);              // food_delivery | ride_hailing
            $table->foreignId('order_id')->unique()->constrained('orders')->restrictOnDelete();
            $table->foreignId('customer_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('rider_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('integrity_status', 16)->default('pending'); // pending | verified | flagged | invalid
            $table->unsignedInteger('event_count')->default(0);
            $table->char('current_hash', 64)->nullable();
            $table->boolean('legacy')->default(false);          // created after the order already existed
            $table->unsignedSmallInteger('schema_version')->default(1);
            $table->timestamp('finalized_at')->nullable();
            $table->timestamp('last_verified_at')->nullable();
            $table->timestamps();
            $table->index(['rider_id', 'integrity_status']);
        });

        Schema::create('transaction_events', function (Blueprint $table) {
            $table->id();
            $table->foreignId('blueprint_id')->constrained('transaction_blueprints')->restrictOnDelete();
            $table->unsignedInteger('sequence');
            $table->string('event_type', 64);
            // No FK: deleting a user must never rewrite (UPDATE) the append-only history.
            $table->unsignedBigInteger('actor_id')->nullable()->index();
            $table->string('actor_role', 64);
            $table->string('source_type', 64)->nullable();
            $table->unsignedBigInteger('source_id')->nullable();
            $table->json('payload');
            $table->unsignedBigInteger('recorded_at_ms');        // server clock, the hashed timestamp
            $table->char('previous_hash', 64);
            $table->char('current_hash', 64)->unique();
            $table->unsignedSmallInteger('schema_version')->default(1);
            $table->timestamp('created_at')->nullable();
            $table->unique(['blueprint_id', 'sequence']);
            $table->index(['source_type', 'source_id']);
        });

        Schema::create('transaction_integrity_checks', function (Blueprint $table) {
            $table->id();
            $table->foreignId('blueprint_id')->constrained('transaction_blueprints')->cascadeOnDelete();
            $table->string('result', 8);                         // pass | flag | block
            $table->json('checks');
            $table->string('context', 32)->default('manual');    // manual | scheduled | cashout
            $table->unsignedBigInteger('context_id')->nullable();
            $table->foreignId('checked_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('created_at')->nullable();
            $table->index(['blueprint_id', 'created_at']);
        });

        Schema::create('transaction_checkpoints', function (Blueprint $table) {
            $table->id();
            $table->unsignedInteger('sequence')->unique();
            $table->unsignedInteger('entries_count');
            $table->char('previous_root', 64);
            $table->char('root_hash', 64);
            $table->char('signature', 64);                       // HMAC-SHA256, key outside the database
            $table->unsignedBigInteger('created_at_ms');
            $table->string('export_path')->nullable();
            $table->timestamp('created_at')->nullable();
        });

        Schema::create('transaction_checkpoint_entries', function (Blueprint $table) {
            $table->id();
            $table->foreignId('checkpoint_id')->constrained('transaction_checkpoints')->restrictOnDelete();
            $table->foreignId('blueprint_id')->constrained('transaction_blueprints')->restrictOnDelete();
            $table->unsignedInteger('event_count');
            $table->char('head_hash', 64);
            $table->unique(['checkpoint_id', 'blueprint_id']);
            $table->index(['blueprint_id', 'checkpoint_id']);
        });

        $this->protect();
    }

    public function down(): void
    {
        $this->unprotect();
        Schema::dropIfExists('transaction_checkpoint_entries');
        Schema::dropIfExists('transaction_checkpoints');
        Schema::dropIfExists('transaction_integrity_checks');
        Schema::dropIfExists('transaction_events');
        Schema::dropIfExists('transaction_blueprints');
    }

    private function protect(): void
    {
        $driver = DB::getDriverName();
        foreach (self::PROTECTED as $table) {
            foreach (['UPDATE', 'DELETE'] as $op) {
                $name = "{$table}_no_".strtolower($op);
                if ($driver === 'sqlite') {
                    DB::unprepared("CREATE TRIGGER {$name} BEFORE {$op} ON {$table} BEGIN SELECT RAISE(ABORT, '{$table} is append-only'); END;");
                } elseif (in_array($driver, ['mysql', 'mariadb'], true)) {
                    DB::unprepared("CREATE TRIGGER {$name} BEFORE {$op} ON {$table} FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '{$table} is append-only'");
                }
            }
        }
    }

    private function unprotect(): void
    {
        foreach (self::PROTECTED as $table) {
            foreach (['update', 'delete'] as $op) {
                DB::unprepared("DROP TRIGGER IF EXISTS {$table}_no_{$op}");
            }
        }
    }
};
