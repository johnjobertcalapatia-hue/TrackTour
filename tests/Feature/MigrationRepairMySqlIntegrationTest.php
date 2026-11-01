<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use PDO;
use RuntimeException;
use Tests\TestCase;
use Throwable;

/**
 * MySQL-specific integration coverage on a disposable database.
 *
 * The SQLite test suite cannot exercise two things this incident proved
 * critical:
 *
 *  1. MySQL's 64-character identifier limit (error 1059) — SQLite has no such
 *     limit, which is exactly why CI never caught the original defect;
 *  2. ALTER TABLE ... ADD FOREIGN KEY — SQLite's grammar cannot add foreign
 *     keys to an existing table.
 *
 * This test therefore spins up a throwaway database
 * (`tracktour_migration_repair_probe`) on the locally configured MySQL/MariaDB
 * server, runs the complete migration set against it (verifying every
 * identifier fix on a real MySQL grammar), recreates the exact production
 * partial state on `rider_daily_reconciliation_events`, proves the idempotent
 * migration repairs it without losing rows, and drops the database afterwards.
 *
 * It skips (never fails) when no MySQL server is reachable, the PDO MySQL
 * driver is missing, or the account cannot create databases — "where
 * available" semantics. It never touches the development database, and it
 * never touches Railway production.
 */
class MigrationRepairMySqlIntegrationTest extends TestCase
{
    use RefreshDatabase;

    private const PROBE_DATABASE = 'tracktour_migration_repair_probe';

    private const EVENTS = 'rider_daily_reconciliation_events';

    private const RECONCILIATIONS = 'rider_daily_reconciliations';

    private const HISTORY_INDEX = 'rider_daily_recon_events_history_idx';

    private const IDEMPOTENCY_UNIQUE = 'rider_daily_reconciliation_events_idempotency_key_unique';

    private const EVENT_ROW_KEY = 'mysql-probe-row-must-survive';

    private ?PDO $server = null;

    private bool $probeCreated = false;

    private string $originalConnection = '';

    protected function setUp(): void
    {
        parent::setUp();

        $this->originalConnection = DB::getDefaultConnection();
    }

    protected function tearDown(): void
    {
        // Always hand the default connection back before the framework tears
        // down the test transaction on the SQLite connection.
        if ($this->originalConnection !== '') {
            DB::setDefaultConnection($this->originalConnection);
        }

        if ($this->probeCreated) {
            try {
                DB::purge('repair_probe');
            } catch (Throwable) {
                // Connection may never have been established.
            }
        }

        if ($this->server instanceof PDO && $this->probeCreated) {
            try {
                $this->server->exec('DROP DATABASE IF EXISTS `'.self::PROBE_DATABASE.'`');
            } catch (Throwable) {
                // Best effort: the probe database is disposable.
            }
        }

        $this->server = null;
        $this->probeCreated = false;

        parent::tearDown();
    }

    public function test_full_migration_set_then_partial_state_repair_on_disposable_mysql_database(): void
    {
        $this->connectToServer();
        $this->createProbeDatabase();

        config(['database.connections.repair_probe' => array_merge(
            config('database.connections.mysql'),
            ['database' => self::PROBE_DATABASE]
        )]);
        DB::setDefaultConnection('repair_probe');

        // ---------------------------------------------------------------
        // 1) Fresh path: the complete migration set must run cleanly on a
        //    real MySQL-family grammar. This proves every identifier-length
        //    fix (4 migrations) on the engine that enforces the 64-char limit.
        // ---------------------------------------------------------------
        $exitCode = Artisan::call('migrate', ['--force' => true, '--no-interaction' => true]);
        $this->assertSame(0, $exitCode, "php artisan migrate failed:\n".Artisan::output());

        $migrationFileCount = count(glob(database_path('migrations/*.php')) ?: []);
        $recorded = DB::table('migrations')->count();
        $this->assertSame(
            $migrationFileCount,
            $recorded,
            'Every migration file must be recorded in the disposable database.'
        );

        $this->assertTrue(Schema::hasTable(self::RECONCILIATIONS));
        $this->assertTrue(Schema::hasTable(self::EVENTS));
        $this->assertCount(2, Schema::getForeignKeys(self::EVENTS));
        $this->assertTrue($this->hasIdempotencyUnique(self::EVENTS));
        $this->assertTrue($this->hasHistoryIndex(self::EVENTS));

        // ---------------------------------------------------------------
        // 2) Insert a valid data chain that must survive the repair.
        // ---------------------------------------------------------------
        $municipalityId = $this->insertMinimalRow('municipalities', [
            'name' => 'Probe Municipality',
            'district' => 'PROBE',
            'province' => 'ORIENTAL MINDORO',
        ]);
        $riderId = $this->insertMinimalRow('users', [
            'email' => 'probe-'.uniqid().'@example.test',
            'password' => 'probe-password-hash',
        ]);
        $reconciliationId = $this->insertMinimalRow(self::RECONCILIATIONS, [
            'rider_id' => $riderId,
            'municipality_id' => $municipalityId,
            // MariaDB reports DATA_TYPE=longtext for JSON columns and hides the
            // json_valid(...) CHECK outside COLUMN_TYPE — supply valid JSON.
            'receipt_snapshot' => '{}',
        ]);
        $eventId = $this->insertMinimalRow(self::EVENTS, [
            'rider_daily_reconciliation_id' => $reconciliationId,
            'actor_id' => $riderId,
            'action' => 'submitted',
            'to_status' => 'submitted',
            'idempotency_key' => self::EVENT_ROW_KEY,
        ]);

        $this->assertSame(1, DB::table(self::RECONCILIATIONS)->count());
        $this->assertSame(1, DB::table(self::EVENTS)->count());

        // ---------------------------------------------------------------
        // 3) Recreate the exact production partial state: drop every
        //    constraint on the disposable probe copy only — never on a shared
        //    database — leaving columns + PRIMARY, exactly like the 2026-10-31
        //    error-1059 abort did.
        // ---------------------------------------------------------------
        $schema = self::PROBE_DATABASE;
        $foreignKeys = $this->server->prepare(
            'SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE '
            ."WHERE TABLE_SCHEMA = ? AND TABLE_NAME = '".self::EVENTS."' "
            .'AND REFERENCED_TABLE_NAME IS NOT NULL'
        );
        $foreignKeys->execute([$schema]);
        $foreignKeyNames = $foreignKeys->fetchAll(PDO::FETCH_COLUMN);
        $this->assertCount(2, $foreignKeyNames, 'Fresh schema must expose exactly 2 foreign keys.');

        foreach ($foreignKeyNames as $name) {
            $this->server->exec(
                'ALTER TABLE `'.self::PROBE_DATABASE.'`.`'.self::EVENTS.'` '
                .'DROP FOREIGN KEY `'.str_replace('`', '``', $name).'`'
            );
        }

        $indexes = $this->server->prepare(
            'SELECT DISTINCT INDEX_NAME FROM information_schema.STATISTICS '
            ."WHERE TABLE_SCHEMA = ? AND TABLE_NAME = '".self::EVENTS."' AND INDEX_NAME <> 'PRIMARY'"
        );
        $indexes->execute([$schema]);
        $indexNames = $indexes->fetchAll(PDO::FETCH_COLUMN);
        $this->assertNotEmpty($indexNames, 'Fresh schema must expose non-primary indexes to strip.');

        foreach ($indexNames as $name) {
            $this->server->exec(
                'ALTER TABLE `'.self::PROBE_DATABASE.'`.`'.self::EVENTS.'` '
                .'DROP INDEX `'.str_replace('`', '``', $name).'`'
            );
        }

        // The state now matches the production forensics: columns + PRIMARY only.
        $bareIndexes = Schema::getIndexes(self::EVENTS);
        $this->assertCount(1, $bareIndexes, 'Bare table must have only its primary key.');
        $this->assertTrue($bareIndexes[0]['primary']);
        $this->assertSame([], Schema::getForeignKeys(self::EVENTS), 'Bare table must have no foreign keys.');
        $this->assertSame(
            1,
            DB::table(self::EVENTS)->where('idempotency_key', self::EVENT_ROW_KEY)->count(),
            'Data must exist before the repair runs.'
        );

        // ---------------------------------------------------------------
        // 4) Repair through the migration's normal, idempotent up() path —
        //    no manual history insert, no drops, no table recreation.
        // ---------------------------------------------------------------
        $migration = require database_path('migrations/2026_10_30_000003_create_rider_daily_reconciliations.php');
        $migration->up();

        // ---------------------------------------------------------------
        // 5) Verify every production discrepancy was reversed.
        // ---------------------------------------------------------------
        $repairedForeignKeys = [];
        foreach (Schema::getForeignKeys(self::EVENTS) as $foreignKey) {
            $repairedForeignKeys[] = [$foreignKey['columns'], $foreignKey['foreign_table'], $foreignKey['foreign_columns']];
        }
        sort($repairedForeignKeys);

        $expectedForeignKeys = [
            [['actor_id'], 'users', ['id']],
            [['rider_daily_reconciliation_id'], 'rider_daily_reconciliations', ['id']],
        ];
        sort($expectedForeignKeys);

        $this->assertSame(
            $expectedForeignKeys,
            $repairedForeignKeys,
            'Repair must restore both foreign keys with exact structure.'
        );

        $this->assertTrue(
            $this->hasIdempotencyUnique(self::EVENTS),
            'Repair must restore the unique idempotency key.'
        );
        $this->assertTrue(
            $this->hasHistoryIndex(self::EVENTS),
            'Repair must restore the history index.'
        );

        // Data preservation.
        $this->assertSame(1, DB::table(self::RECONCILIATIONS)->count(), 'Parent rows must survive.');
        $this->assertSame(
            1,
            DB::table(self::EVENTS)->where('id', $eventId)->count(),
            'Event rows must survive the repair.'
        );

        // Parent table was never modified by the events repair.
        $this->assertGreaterThanOrEqual(4, count(Schema::getForeignKeys(self::RECONCILIATIONS)));

        // Every constraint identifier in both tables fits MySQL's 64-char limit.
        $constraintNames = DB::select(
            'SELECT CONSTRAINT_NAME AS name FROM information_schema.TABLE_CONSTRAINTS '
            .'WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?, ?)',
            [self::RECONCILIATIONS, self::EVENTS]
        );
        $this->assertNotEmpty($constraintNames);
        foreach ($constraintNames as $constraint) {
            $this->assertLessThanOrEqual(
                64,
                strlen($constraint->name),
                "Constraint [{$constraint->name}] exceeds MySQL's 64-character limit."
            );
        }
        foreach (Schema::getIndexes(self::EVENTS) as $index) {
            $this->assertLessThanOrEqual(64, strlen($index['name']));
        }

        // ---------------------------------------------------------------
        // 6) Repeated execution must be a verified no-op that changes nothing.
        // ---------------------------------------------------------------
        $indexCountAfterRepair = count(Schema::getIndexes(self::EVENTS));
        $foreignKeyCountAfterRepair = count(Schema::getForeignKeys(self::EVENTS));

        $migration->up();

        $this->assertSame(
            $indexCountAfterRepair,
            count(Schema::getIndexes(self::EVENTS)),
            'Repeated up() must not create duplicate indexes.'
        );
        $this->assertSame(
            $foreignKeyCountAfterRepair,
            count(Schema::getForeignKeys(self::EVENTS)),
            'Repeated up() must not create duplicate foreign keys.'
        );
        $this->assertSame(
            1,
            DB::table(self::EVENTS)->where('idempotency_key', self::EVENT_ROW_KEY)->count(),
            'Repeated up() must not touch data.'
        );
    }

    private function connectToServer(): void
    {
        if (! extension_loaded('pdo_mysql')) {
            $this->markTestSkipped('pdo_mysql extension is not loaded — MySQL integration coverage unavailable.');
        }

        $config = config('database.connections.mysql');
        $host = $config['host'] ?? '127.0.0.1';
        $port = $config['port'] ?? '3306';
        $username = $config['username'] ?? 'root';
        $password = $config['password'] ?? '';

        try {
            $this->server = new PDO(
                "mysql:host={$host};port={$port};charset=utf8mb4",
                $username,
                $password,
                [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_TIMEOUT => 5]
            );
        } catch (Throwable $exception) {
            $this->markTestSkipped("MySQL server not reachable at {$host}:{$port} — {$exception->getMessage()}");
        }
    }

    private function createProbeDatabase(): void
    {
        try {
            $this->server->exec('DROP DATABASE IF EXISTS `'.self::PROBE_DATABASE.'`');
            $this->server->exec(
                'CREATE DATABASE `'.self::PROBE_DATABASE.'` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
            );
        } catch (Throwable $exception) {
            $this->markTestSkipped('Cannot create a disposable database: '.$exception->getMessage());
        }

        $this->probeCreated = true;
    }

    /**
     * Insert a row containing every NOT NULL column that has no default,
     * filling each with a type-appropriate literal unless overridden.
     *
     * @param  array<string, mixed>  $overrides
     */
    private function insertMinimalRow(string $table, array $overrides = []): int
    {
        $statement = $this->server->prepare(
            'SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TYPE FROM information_schema.COLUMNS '
            .'WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND IS_NULLABLE = \'NO\' '
            ."AND COLUMN_DEFAULT IS NULL AND EXTRA NOT LIKE '%auto_increment%' "
            .'ORDER BY ORDINAL_POSITION'
        );
        $statement->execute([self::PROBE_DATABASE, $table]);

        // Overrides apply to every column (required or nullable) so tests can
        // pin nullable values such as idempotency keys; required columns that
        // are not overridden receive a type-appropriate filler.
        $values = $overrides;

        foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $column) {
            $name = $column['COLUMN_NAME'];

            if (array_key_exists($name, $values)) {
                continue;
            }

            $values[$name] = $this->fillerValue($column);
        }

        if ($values === []) {
            $this->fail("No required columns found for [{$table}] — probe assumption broken.");
        }

        return (int) DB::table($table)->insertGetId($values);
    }

    /**
     * @param  array{COLUMN_NAME: string, DATA_TYPE: string, COLUMN_TYPE: string}  $column
     */
    private function fillerValue(array $column): mixed
    {
        $type = strtolower($column['DATA_TYPE']);

        if (str_contains($type, 'int')) {
            return 1;
        }

        if (in_array($type, ['decimal', 'numeric', 'float', 'double', 'real'], true)) {
            return 0;
        }

        if ($type === 'date') {
            return '2026-10-31';
        }

        if (in_array($type, ['datetime', 'timestamp'], true)) {
            return '2026-10-31 03:20:00';
        }

        if ($type === 'time') {
            return '03:20:00';
        }

        if (str_contains($type, 'json') || str_contains(strtolower($column['COLUMN_TYPE']), 'json_valid')) {
            // MySQL reports DATA_TYPE=json; MariaDB stores JSON columns as
            // LONGTEXT with a json_valid(...) CHECK constraint.
            return '{}';
        }

        if ($type === 'enum') {
            if (preg_match("/^enum\('([^']*)'/", $column['COLUMN_TYPE'], $match) === 1) {
                return $match[1];
            }

            throw new RuntimeException(
                "Cannot derive a filler value for enum column [{$column['COLUMN_NAME']}]."
            );
        }

        return 'probe-value';
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
            if ($index['primary'] || $index['unique']) {
                continue;
            }

            if ($index['name'] === self::HISTORY_INDEX
                || $index['columns'] === ['rider_daily_reconciliation_id', 'created_at']) {
                return true;
            }
        }

        return false;
    }
}
