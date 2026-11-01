<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Rider daily COD cash reconciliation: parent record + event ledger.
     *
     * Historical context (Railway production, 2026-10-31): the original version of
     * this migration always executed two plain Schema::create() calls. MySQL DDL
     * auto-commits, so both CREATE TABLE statements persisted, but the first
     * ALTER TABLE afterwards aborted because Laravel derived the implicit name
     *
     *     rider_daily_reconciliation_events_rider_daily_reconciliation_id_foreign
     *
     * (71 characters) and MySQL rejects identifiers longer than 64 characters
     * (error 1059). As a result `rider_daily_reconciliation_events` was left
     * with columns and a primary key only — no foreign keys, no unique
     * idempotency key, no history index — and this migration was never recorded
     * in `migrations`. Every subsequent boot then re-ran it and failed with
     * error 1050 ("table already exists"), producing a crash loop.
     *
     * `up()` is therefore idempotent and repair-capable:
     *
     *  - each table is created only when it does not exist;
     *  - an existing table is never assumed complete: every expected column,
     *    unique key, index, and foreign key is verified through the schema
     *    builder, and only genuinely missing pieces are added back;
     *  - nothing is ever dropped, truncated, or recreated, and an existing
     *    table whose shape is not recognized aborts the migration untouched;
     *  - all derived identifiers stay within MySQL's 64-character limit, and
     *    the create path and the repair path converge on an identical schema.
     */

    private const MIGRATION = '2026_10_30_000003_create_rider_daily_reconciliations';

    private const RECONCILIATIONS = 'rider_daily_reconciliations';

    private const EVENTS = 'rider_daily_reconciliation_events';

    /**
     * Explicit name for the events→reconciliations foreign key. The implicit
     * name ({table}_{column}_foreign) is 71 characters, over MySQL's limit.
     */
    private const EVENTS_FK_RECONCILIATION = 'rider_daily_recon_event_recon_fk'; // 32 chars

    private const EVENTS_FK_ACTOR = 'rider_daily_reconciliation_events_actor_id_foreign'; // 52 chars

    private const EVENTS_UNIQUE_IDEMPOTENCY = 'rider_daily_reconciliation_events_idempotency_key_unique'; // 56 chars

    private const EVENTS_HISTORY_INDEX = 'rider_daily_recon_events_history_idx'; // 36 chars

    private const RECONCILIATIONS_IDEMPOTENCY_UNIQUE = 'rider_daily_reconciliations_idempotency_key_unique'; // 50 chars

    private const RECONCILIATIONS_REVISION_UNIQUE = 'rider_daily_reconciliation_revision_unique'; // 44 chars

    private const RECONCILIATIONS_SCOPE_INDEX = 'rider_daily_reconciliation_scope_idx'; // 39 chars

    private const RECONCILIATIONS_COLUMNS = [
        'id',
        'rider_id',
        'municipality_id',
        'working_date',
        'revision',
        'status',
        'idempotency_key',
        'expected_cod_remittance',
        'expected_office_cash_return',
        'expected_rider_payable',
        'submitted_cod_remittance',
        'submitted_office_cash_return',
        'remittance_reference',
        'rider_note',
        'receipt_snapshot',
        'submitted_at',
        'verified_cod_received',
        'verified_office_cash_return',
        'verified_rider_reimbursement',
        'verification_note',
        'verified_by',
        'verified_at',
        'closed_by',
        'closed_at',
        'created_at',
        'updated_at',
    ];

    private const EVENTS_COLUMNS = [
        'id',
        'rider_daily_reconciliation_id',
        'actor_id',
        'action',
        'from_status',
        'to_status',
        'idempotency_key',
        'details',
        'created_at',
    ];

    public function up(): void
    {
        $this->ensureRiderDailyReconciliations();
        $this->ensureRiderDailyReconciliationEvents();
    }

    public function down(): void
    {
        Schema::dropIfExists('rider_daily_reconciliation_events');
        Schema::dropIfExists('rider_daily_reconciliations');
    }

    /**
     * Create (or verify + repair) the parent reconciliation table.
     */
    private function ensureRiderDailyReconciliations(): void
    {
        if (! Schema::hasTable(self::RECONCILIATIONS)) {
            Schema::create(self::RECONCILIATIONS, function (Blueprint $table) {
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

                $table->unique(['rider_id', 'working_date', 'revision'], self::RECONCILIATIONS_REVISION_UNIQUE);
                $table->index(['municipality_id', 'working_date', 'status'], self::RECONCILIATIONS_SCOPE_INDEX);
            });
        }

        // Verification runs on both paths — a freshly created table is checked the
        // same way as a pre-existing one, so a driver that silently skips a
        // statement can never pass unnoticed.
        $this->assertColumns(self::RECONCILIATIONS, self::RECONCILIATIONS_COLUMNS);
        $this->ensureIndexes(self::RECONCILIATIONS, [
            ['name' => self::RECONCILIATIONS_IDEMPOTENCY_UNIQUE, 'columns' => ['idempotency_key'], 'unique' => true],
            ['name' => self::RECONCILIATIONS_REVISION_UNIQUE, 'columns' => ['rider_id', 'working_date', 'revision'], 'unique' => true],
            ['name' => self::RECONCILIATIONS_SCOPE_INDEX, 'columns' => ['municipality_id', 'working_date', 'status'], 'unique' => false],
        ]);
        $this->ensureForeignKeys(self::RECONCILIATIONS, [
            [
                'columns' => ['rider_id'],
                'on' => 'users',
                'references' => ['id'],
                'add' => function (Blueprint $table): void {
                    $table->foreign('rider_id')->references('id')->on('users')->restrictOnDelete();
                },
            ],
            [
                'columns' => ['municipality_id'],
                'on' => 'municipalities',
                'references' => ['id'],
                'add' => function (Blueprint $table): void {
                    $table->foreign('municipality_id')->references('id')->on('municipalities')->restrictOnDelete();
                },
            ],
            [
                'columns' => ['verified_by'],
                'on' => 'users',
                'references' => ['id'],
                'add' => function (Blueprint $table): void {
                    $table->foreign('verified_by')->references('id')->on('users')->nullOnDelete();
                },
            ],
            [
                'columns' => ['closed_by'],
                'on' => 'users',
                'references' => ['id'],
                'add' => function (Blueprint $table): void {
                    $table->foreign('closed_by')->references('id')->on('users')->nullOnDelete();
                },
            ],
        ]);
    }

    /**
     * Create (or verify + repair) the reconciliation event ledger table.
     *
     * This is the table the 2026-10-31 production run left bare: CREATE TABLE
     * committed, then the 71-character foreign-key name failed with error 1059
     * before the unique key, history index, and foreign keys could be added.
     */
    private function ensureRiderDailyReconciliationEvents(): void
    {
        if (! Schema::hasTable(self::EVENTS)) {
            Schema::create(self::EVENTS, function (Blueprint $table) {
                $table->id();
                // Foreign-key columns are declared here but bound below: MySQL
                // applies unique keys and indexes ahead of the foreign keys, so
                // the composite history index satisfies InnoDB's index
                // requirement for the foreign key instead of triggering a
                // duplicate auto-created index. This ordering mirrors what the
                // repair path produces.
                $table->foreignId('rider_daily_reconciliation_id');
                $table->foreignId('actor_id');
                $table->string('action', 32);
                $table->string('from_status', 24)->nullable();
                $table->string('to_status', 24);
                $table->string('idempotency_key', 64)->nullable();
                $table->json('details')->nullable();
                $table->timestamp('created_at');

                $table->unique('idempotency_key', self::EVENTS_UNIQUE_IDEMPOTENCY);
                $table->index(
                    ['rider_daily_reconciliation_id', 'created_at'],
                    self::EVENTS_HISTORY_INDEX
                );

                $table->foreign('rider_daily_reconciliation_id', self::EVENTS_FK_RECONCILIATION)
                    ->references('id')
                    ->on('rider_daily_reconciliations')
                    ->restrictOnDelete();
                $table->foreign('actor_id', self::EVENTS_FK_ACTOR)
                    ->references('id')
                    ->on('users')
                    ->restrictOnDelete();
            });
        }

        $this->assertColumns(self::EVENTS, self::EVENTS_COLUMNS);
        // Indexes first: on the repair path the composite history index must
        // exist before MySQL will accept the foreign key on the same column.
        $this->ensureIndexes(self::EVENTS, [
            ['name' => self::EVENTS_UNIQUE_IDEMPOTENCY, 'columns' => ['idempotency_key'], 'unique' => true],
            ['name' => self::EVENTS_HISTORY_INDEX, 'columns' => ['rider_daily_reconciliation_id', 'created_at'], 'unique' => false],
        ]);
        $this->ensureForeignKeys(self::EVENTS, [
            [
                'columns' => ['rider_daily_reconciliation_id'],
                'on' => 'rider_daily_reconciliations',
                'references' => ['id'],
                'add' => function (Blueprint $table): void {
                    $table->foreign('rider_daily_reconciliation_id', self::EVENTS_FK_RECONCILIATION)
                        ->references('id')
                        ->on('rider_daily_reconciliations')
                        ->restrictOnDelete();
                },
            ],
            [
                'columns' => ['actor_id'],
                'on' => 'users',
                'references' => ['id'],
                'add' => function (Blueprint $table): void {
                    $table->foreign('actor_id', self::EVENTS_FK_ACTOR)
                        ->references('id')
                        ->on('users')
                        ->restrictOnDelete();
                },
            ],
        ]);
    }

    /**
     * Verify that an existing table carries every expected column.
     *
     * A table that exists but does not match the expected shape aborts the
     * migration untouched: it is never assumed complete and never dropped.
     *
     * @param  list<string>  $expected
     */
    private function assertColumns(string $table, array $expected): void
    {
        $actual = array_column(Schema::getColumns($table), 'name');
        $missing = array_values(array_diff($expected, $actual));

        if ($missing !== []) {
            throw new RuntimeException(sprintf(
                'Migration [%s] found table [%s] missing expected column(s): %s. '
                .'Refusing to modify a table whose shape is not recognized; inspect it before proceeding.',
                self::MIGRATION,
                $table,
                implode(', ', $missing)
            ));
        }
    }

    /**
     * Verify every required unique key / index and add back only what is
     * missing, then verify again so a silently skipped statement cannot pass.
     *
     * @param  list<array{name: string, columns: list<string>, unique: bool}>  $required
     */
    private function ensureIndexes(string $table, array $required): void
    {
        foreach ($required as $index) {
            if ($this->indexExists($table, $index)) {
                continue;
            }

            Schema::table($table, function (Blueprint $blueprint) use ($index): void {
                if ($index['unique']) {
                    $blueprint->unique($index['columns'], $index['name']);
                } else {
                    $blueprint->index($index['columns'], $index['name']);
                }
            });
        }

        foreach ($required as $index) {
            if (! $this->indexExists($table, $index)) {
                throw new RuntimeException(sprintf(
                    'Migration [%s] could not verify %s [%s] on [%s] after repair.',
                    self::MIGRATION,
                    $index['unique'] ? 'unique key' : 'index',
                    $index['name'],
                    $table
                ));
            }
        }
    }

    /**
     * Verify every required foreign key and add back only what is missing,
     * then verify again so a silently skipped statement cannot pass.
     *
     * @param  list<array{columns: list<string>, on: string, references: list<string>, add: \Closure}>  $required
     */
    private function ensureForeignKeys(string $table, array $required): void
    {
        $canAlter = $this->driverSupportsForeignKeyAlterations();

        foreach ($required as $foreignKey) {
            if ($this->foreignKeyExists($table, $foreignKey)) {
                continue;
            }

            if (! $canAlter) {
                // SQLite cannot add a foreign key to an existing table (the
                // framework's SQLiteGrammar::compileForeign is a no-op for
                // ALTER). SQLite is only used by the in-memory test suite,
                // where the fresh-create path declares every foreign key at
                // CREATE TABLE time; the repair path is exercised on MySQL.
                continue;
            }

            Schema::table($table, function (Blueprint $blueprint) use ($foreignKey): void {
                ($foreignKey['add'])($blueprint);
            });
        }

        if (! $canAlter) {
            return;
        }

        foreach ($required as $foreignKey) {
            if (! $this->foreignKeyExists($table, $foreignKey)) {
                throw new RuntimeException(sprintf(
                    'Migration [%s] could not verify foreign key on [%s].%s -> [%s].%s after repair.',
                    self::MIGRATION,
                    $table,
                    '('.implode(', ', $foreignKey['columns']).')',
                    $foreignKey['on'],
                    '('.implode(', ', $foreignKey['references']).')'
                ));
            }
        }
    }

    /**
     * Whether the current driver supports ALTER TABLE ... ADD FOREIGN KEY.
     */
    private function driverSupportsForeignKeyAlterations(): bool
    {
        return Schema::getConnection()->getDriverName() !== 'sqlite';
    }

    /**
     * Index presence is checked by name first, then by an equivalent
     * definition (same columns, same uniqueness, non-primary) so an
     * equivalent index recorded under a legacy name is never duplicated.
     *
     * @param  array{name: string, columns: list<string>, unique: bool}  $index
     */
    private function indexExists(string $table, array $index): bool
    {
        foreach (Schema::getIndexes($table) as $existing) {
            if ($existing['name'] === $index['name']) {
                return true;
            }

            if (! $existing['primary']
                && $existing['unique'] === $index['unique']
                && $existing['columns'] === $index['columns']) {
                return true;
            }
        }

        return false;
    }

    /**
     * Foreign-key presence is verified structurally (referencing columns,
     * referenced table, referenced columns) rather than by name, because the
     * name legitimately differs between environments only by history — the
     * structure is the invariant that matters.
     *
     * @param  array{columns: list<string>, on: string, references: list<string>}  $foreignKey
     */
    private function foreignKeyExists(string $table, array $foreignKey): bool
    {
        foreach (Schema::getForeignKeys($table) as $existing) {
            if ($existing['columns'] === $foreignKey['columns']
                && $existing['foreign_table'] === $foreignKey['on']
                && $existing['foreign_columns'] === $foreignKey['references']) {
                return true;
            }
        }

        return false;
    }
};
