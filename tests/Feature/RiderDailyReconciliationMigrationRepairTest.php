<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use RuntimeException;
use Tests\TestCase;

/**
 * Regression coverage for the 2026-10-31 partial-migration state.
 *
 * Migration `2026_10_30_000003` crashed on production after both CREATE TABLE
 * statements committed but before `rider_daily_reconciliation_events` received
 * its unique key, history index, or foreign keys (MySQL error 1059 on a
 * 71-character implicit constraint name). The migration was never recorded,
 * so every later boot re-ran it and died with error 1050.
 *
 * These tests prove the repaired migration is:
 *  - idempotent (safe to execute repeatedly against a complete schema);
 *  - capable of repairing the bare table without dropping anything;
 *  - strict about unrecognized table shapes (refuses instead of assuming).
 *
 * Foreign-key repair on an existing table is MySQL-only by nature (SQLite's
 * grammar cannot ALTER-add foreign keys) and is covered end-to-end by
 * MigrationRepairMySqlIntegrationTest on a disposable MySQL database.
 */
class RiderDailyReconciliationMigrationRepairTest extends TestCase
{
    use RefreshDatabase;

    private const EVENTS = 'rider_daily_reconciliation_events';

    private const RECONCILIATIONS = 'rider_daily_reconciliations';

    private const HISTORY_INDEX = 'rider_daily_recon_events_history_idx';

    private const IDEMPOTENCY_UNIQUE = 'rider_daily_reconciliation_events_idempotency_key_unique';

    public function test_up_is_idempotent_when_the_schema_is_already_complete(): void
    {
        $migration = $this->migration();

        // The suite's own migration run created both tables through the fresh path.
        $this->assertTrue(Schema::hasTable(self::RECONCILIATIONS));
        $this->assertTrue(Schema::hasTable(self::EVENTS));

        // Repeated executions must verify the schema and change nothing.
        $migration->up();
        $migration->up();

        $this->assertColumnsPresent(self::EVENTS, [
            'id',
            'rider_daily_reconciliation_id',
            'actor_id',
            'action',
            'from_status',
            'to_status',
            'idempotency_key',
            'details',
            'created_at',
        ]);
        $this->assertColumnsPresent(self::RECONCILIATIONS, [
            'id',
            'rider_id',
            'municipality_id',
            'working_date',
            'revision',
            'status',
            'idempotency_key',
            'receipt_snapshot',
            'created_at',
            'updated_at',
        ]);

        $this->assertTrue(
            $this->hasIdempotencyUnique(self::EVENTS),
            'Unique idempotency key must survive repeated up() executions.'
        );
        $this->assertTrue(
            $this->hasHistoryIndex(self::EVENTS),
            'History index must survive repeated up() executions.'
        );

        // The fresh-create path defines every foreign key on every driver,
        // including SQLite (declared inline at CREATE TABLE time).
        $this->assertCount(
            2,
            Schema::getForeignKeys(self::EVENTS),
            'Fresh-created events table must carry both foreign keys.'
        );
        $this->assertNotEmpty(
            Schema::getForeignKeys(self::RECONCILIATIONS),
            'Fresh-created reconciliations table must carry its foreign keys.'
        );
    }

    public function test_up_repairs_a_bare_events_table_without_dropping_anything(): void
    {
        $migration = $this->migration();

        // Recreate the exact production partial state: CREATE TABLE committed
        // with columns + PRIMARY only, every constraint missing. This drop is
        // scoped to the disposable in-memory test database.
        DB::statement('DROP TABLE '.self::EVENTS);
        DB::statement(
            'CREATE TABLE rider_daily_reconciliation_events ('
            .'id integer primary key autoincrement, '
            .'rider_daily_reconciliation_id integer not null, '
            .'actor_id integer not null, '
            .'action varchar(32) not null, '
            .'from_status varchar(24) null, '
            .'to_status varchar(24) not null, '
            .'idempotency_key varchar(64) null, '
            .'details text null, '
            .'created_at timestamp null)'
        );

        // Data written before the repair must survive it untouched.
        DB::table(self::EVENTS)->insert([
            'rider_daily_reconciliation_id' => 4242,
            'actor_id' => 5252,
            'action' => 'submitted',
            'to_status' => 'submitted',
            'idempotency_key' => 'bare-row-must-survive-repair',
            'created_at' => '2026-10-31 03:32:55',
        ]);

        $migration->up();

        // The parent table was never dropped or recreated.
        $this->assertTrue(Schema::hasTable(self::RECONCILIATIONS));

        // Every column verified present after repair.
        $this->assertColumnsPresent(self::EVENTS, [
            'id',
            'rider_daily_reconciliation_id',
            'actor_id',
            'action',
            'from_status',
            'to_status',
            'idempotency_key',
            'details',
            'created_at',
        ]);

        // Unique key and history index were added back.
        $this->assertTrue(
            $this->hasIdempotencyUnique(self::EVENTS),
            'Repair must restore the unique idempotency key.'
        );
        $this->assertTrue(
            $this->hasHistoryIndex(self::EVENTS),
            'Repair must restore the history index.'
        );

        // The pre-repair row survived.
        $this->assertSame(
            1,
            DB::table(self::EVENTS)
                ->where('idempotency_key', 'bare-row-must-survive-repair')
                ->count(),
            'Repair must never lose existing rows.'
        );

        // Documented driver limitation, asserted so it stays visible: SQLite
        // cannot ALTER-add foreign keys (SQLiteGrammar::compileForeign is a
        // no-op outside CREATE TABLE), so on SQLite the repaired table keeps
        // having no foreign keys — MySQL integration coverage asserts the FK
        // repair where the driver supports it.
        if (Schema::getConnection()->getDriverName() === 'sqlite') {
            $this->assertSame(
                [],
                Schema::getForeignKeys(self::EVENTS),
                'SQLite cannot repair foreign keys on an existing table (documented limitation).'
            );
        } else {
            $this->assertCount(2, Schema::getForeignKeys(self::EVENTS));
        }
    }

    public function test_up_refuses_to_touch_a_table_that_does_not_match_the_expected_shape(): void
    {
        $migration = $this->migration();

        // Same table name, wrong shape — the scenario the migration must never
        // "repair" by dropping or recreating. Test-scoped disposable schema.
        DB::statement('DROP TABLE '.self::EVENTS);
        DB::statement(
            'CREATE TABLE rider_daily_reconciliation_events ('
            .'id integer primary key, '
            .'wrong_column text)'
        );

        try {
            $migration->up();
            $this->fail('Expected the migration to refuse an unrecognized table shape.');
        } catch (RuntimeException $exception) {
            $this->assertStringContainsString(self::EVENTS, $exception->getMessage());
            $this->assertStringContainsString('missing expected column', $exception->getMessage());
            // The message names columns the recognized shape requires but the
            // found table lacks (extras alone never trigger a refusal — later
            // migrations may legitimately widen a table).
            $this->assertStringContainsString('to_status', $exception->getMessage());
        }

        // The table was left exactly as found: nothing dropped, nothing added.
        $this->assertSame(
            ['id', 'wrong_column'],
            Schema::getColumnListing(self::EVENTS),
            'An unrecognized table must be left completely untouched.'
        );

        // Restore the test schema so the remainder of the process sees a
        // consistent state even if transactional DDL rollback is unavailable.
        DB::statement('DROP TABLE '.self::EVENTS);
        $migration->up();
        $this->assertTrue(Schema::hasTable(self::EVENTS));
        $this->assertTrue($this->hasHistoryIndex(self::EVENTS));
    }

    private function migration(): \Illuminate\Database\Migrations\Migration
    {
        return require database_path('migrations/2026_10_30_000003_create_rider_daily_reconciliations.php');
    }

    /**
     * @param  list<string>  $expected
     */
    private function assertColumnsPresent(string $table, array $expected): void
    {
        $actual = Schema::getColumnListing($table);

        foreach ($expected as $column) {
            $this->assertContains($column, $actual, "Column [{$column}] missing on [{$table}].");
        }
    }

    private function hasIdempotencyUnique(string $table): bool
    {
        foreach (Schema::getIndexes($table) as $index) {
            if ($index['primary'] || ! $index['unique']) {
                continue;
            }

            if ($index['name'] === self::IDEMPOTENCY_UNIQUE || $index['columns'] === ['idempotency_key']) {
                return true;
            }
        }

        return false;
    }

    private function hasHistoryIndex(string $table): bool
    {
        foreach (Schema::getIndexes($table) as $index) {
            if ($index['primary']) {
                continue;
            }

            if ($index['name'] === self::HISTORY_INDEX
                || $index['columns'] === ['rider_daily_reconciliation_id', 'created_at']) {
                return ! $index['unique'];
            }
        }

        return false;
    }
}
