<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Secure transaction architecture, Stage 3 (food delivery).
 *
 * menu_availability_chains  one row per business: the head of its availability
 *                           history, locked to serialise concurrent writes
 * menu_availability_events  append-only, SHA-256 chained per business: every
 *                           Available / Unavailable change, who, when, why
 * delivery_pickup_stops     arrival_evidence / pickup_evidence (JSON, written
 *                           once): device fix and server-saved fix, each with
 *                           its own accuracy, fix age and distance
 * rider_locations           accuracy_m of the saved fix
 *
 * offerings.stock is NOT dropped: it is deprecated and unused (no inventory
 * quantities); a later migration drops it once nothing depends on it.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('menu_availability_chains', function (Blueprint $table) {
            $table->unsignedBigInteger('business_id')->primary();
            $table->unsignedInteger('last_sequence')->default(0);
            $table->char('head_hash', 64);
            $table->timestamp('updated_at')->nullable();
        });

        Schema::create('menu_availability_events', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('business_id');           // no FK: history must survive the business row
            $table->unsignedInteger('sequence');
            $table->unsignedBigInteger('offering_id');
            $table->unsignedBigInteger('offering_variation_id')->nullable();
            $table->string('item_name');
            $table->boolean('previous_available')->nullable();   // null = newly created item
            $table->boolean('new_available');
            $table->unsignedBigInteger('actor_id')->nullable();
            $table->string('actor_role', 64);
            $table->string('source', 64);                         // e.g. owner_menu.toggle, owner_offerings.bulk, unrouted
            $table->string('reason', 255)->nullable();
            $table->unsignedBigInteger('recorded_at_ms');
            $table->char('previous_hash', 64);
            $table->char('current_hash', 64)->unique();
            $table->timestamp('created_at')->nullable();
            $table->unique(['business_id', 'sequence']);
            $table->index(['offering_id', 'id']);
        });

        Schema::table('delivery_pickup_stops', function (Blueprint $table) {
            $table->json('arrival_evidence')->nullable()->after('arrived_at');
            $table->json('pickup_evidence')->nullable()->after('pickup_confirmed_at');
        });

        Schema::table('rider_locations', function (Blueprint $table) {
            $table->decimal('accuracy_m', 8, 2)->nullable()->after('longitude');
        });

        $driver = DB::getDriverName();
        foreach (['UPDATE', 'DELETE'] as $op) {
            $name = 'menu_availability_events_no_'.strtolower($op);
            if ($driver === 'sqlite') {
                DB::unprepared("CREATE TRIGGER {$name} BEFORE {$op} ON menu_availability_events BEGIN SELECT RAISE(ABORT, 'menu_availability_events is append-only'); END;");
            } elseif (in_array($driver, ['mysql', 'mariadb'], true)) {
                DB::unprepared("CREATE TRIGGER {$name} BEFORE {$op} ON menu_availability_events FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'menu_availability_events is append-only'");
            }
        }
    }

    public function down(): void
    {
        DB::unprepared('DROP TRIGGER IF EXISTS menu_availability_events_no_update');
        DB::unprepared('DROP TRIGGER IF EXISTS menu_availability_events_no_delete');
        Schema::table('rider_locations', fn (Blueprint $table) => $table->dropColumn('accuracy_m'));
        Schema::table('delivery_pickup_stops', fn (Blueprint $table) => $table->dropColumn(['arrival_evidence', 'pickup_evidence']));
        Schema::dropIfExists('menu_availability_events');
        Schema::dropIfExists('menu_availability_chains');
    }
};
