<?php

namespace Tests\Unit;

use PHPUnit\Framework\TestCase;

/**
 * Regression guard for the 2026-10-31 Railway production incident.
 *
 * MySQL rejects any identifier (table, index, unique key, foreign key) longer
 * than 64 characters with error 1059. Because MySQL DDL auto-commits and
 * Laravel emits CREATE TABLE followed by separate ALTER TABLE statements, an
 * over-long implicit foreign-key name aborted migration
 * `2026_10_30_000003` after its tables were created but before any
 * constraint, unique key, or index was added — and before the migration was
 * recorded. The bare table then made every subsequent boot fail with error
 * 1050 ("table already exists"), crash-looping the service.
 *
 * This test statically scans every migration for identifier names Laravel
 * would generate implicitly ({table}_{column}_foreign / _unique / _index)
 * plus all explicitly declared names, and asserts every one fits in 64
 * characters. It is pure static analysis: no database, no boot.
 */
class MigrationIdentifierLengthTest extends TestCase
{
    private const MYSQL_IDENTIFIER_LIMIT = 64;

    public function test_no_migration_identifier_exceeds_mysql_64_character_limit(): void
    {
        $files = $this->migrationFiles();
        $this->assertGreaterThan(
            200,
            count($files),
            'The scanner must see the full migration set — glob regression?'
        );

        $violations = [];
        $derived = 0;

        foreach ($files as $file) {
            foreach ($this->derivedIdentifiers(file_get_contents($file)) as $name) {
                $derived++;

                if (strlen($name) > self::MYSQL_IDENTIFIER_LIMIT) {
                    $violations[] = sprintf(
                        '%s -> %s (%d chars)',
                        basename($file),
                        $name,
                        strlen($name)
                    );
                }
            }
        }

        $this->assertGreaterThan(
            100,
            $derived,
            'The scanner derived suspiciously few identifiers — parser regression?'
        );

        $this->assertSame(
            [],
            $violations,
            "MySQL rejects identifiers longer than 64 characters (error 1059). An over-long "
            ."name aborts a migration mid-run (DDL auto-commits, leaving partial schema):\n"
            .implode("\n", $violations)
        );
    }

    public function test_scanner_detects_the_historical_over_long_foreign_key(): void
    {
        // The exact statement shape that crashed Railway production on
        // 2026-10-31: implicit naming derives a 71-character constraint name.
        $original = <<<'PHP'
        Schema::create('rider_daily_reconciliation_events', function (Blueprint $table) {
            $table->id();
            $table->foreignId('rider_daily_reconciliation_id')
                ->constrained('rider_daily_reconciliations')
                ->restrictOnDelete();
        });
        PHP;

        $names = $this->derivedIdentifiers($original);

        $this->assertContains(
            'rider_daily_reconciliation_events_rider_daily_reconciliation_id_foreign',
            $names,
            'The scanner failed to derive the historical 71-character name — it would not '
            .'have caught the incident and must not be trusted.'
        );
        $this->assertGreaterThan(
            self::MYSQL_IDENTIFIER_LIMIT,
            strlen('rider_daily_reconciliation_events_rider_daily_reconciliation_id_foreign'),
            'Sanity: the historical name really is over the MySQL limit.'
        );
    }

    /**
     * @return list<string>
     */
    private function migrationFiles(): array
    {
        $files = glob(dirname(__DIR__, 2).'/database/migrations/*.php') ?: [];
        sort($files);

        return $files;
    }

    /**
     * Derive every identifier Laravel would generate for the schema statements
     * inside a migration source file.
     *
     * @return list<string>
     */
    private function derivedIdentifiers(string $source): array
    {
        $constants = $this->stringConstants($source);
        $names = [];

        foreach ($this->schemaBlocks($source) as [$table, $body]) {
            foreach (preg_split('/;/', $body) ?: [] as $statement) {
                foreach ($this->identifiersFromStatement($table, trim($statement), $constants) as $name) {
                    $names[] = $name;
                }
            }
        }

        return $names;
    }

    /**
     * Extract each Schema::create()/Schema::createIfNotExists()/Schema::table()
     * closure body with brace matching, returning [table, body].
     *
     * @return list<array{0: string, 1: string}>
     */
    private function schemaBlocks(string $source): array
    {
        $blocks = [];

        if (! preg_match_all(
            '/Schema::(?:create|createIfNotExists|table)\(\s*[\'"]([^\'"]+)[\'"]/',
            $source,
            $matches,
            PREG_OFFSET_CAPTURE
        )) {
            return $blocks;
        }

        foreach ($matches[1] as [$table, $offset]) {
            $open = strpos($source, '{', $offset);

            if ($open === false) {
                continue;
            }

            $depth = 0;
            $length = strlen($source);

            for ($i = $open; $i < $length; $i++) {
                if ($source[$i] === '{') {
                    $depth++;
                } elseif ($source[$i] === '}') {
                    $depth--;

                    if ($depth === 0) {
                        $blocks[] = [$table, substr($source, $open + 1, $i - $open - 1)];
                        break;
                    }
                }
            }
        }

        return $blocks;
    }

    /**
     * Map of `const NAME = 'value';` declarations for self::NAME resolution.
     *
     * @return array<string, string>
     */
    private function stringConstants(string $source): array
    {
        $constants = [];

        if (preg_match_all('/const\s+(\w+)\s*=\s*([\'"])(.*?)\2\s*;/', $source, $matches, PREG_SET_ORDER)) {
            foreach ($matches as $match) {
                $constants[$match[1]] = $match[3];
            }
        }

        return $constants;
    }

    /**
     * @return list<string>
     */
    private function identifiersFromStatement(string $table, string $statement, array $constants): array
    {
        $names = [];

        if ($statement === '') {
            return $names;
        }

        // foreignId('col')->...->constrained('ref', 'id', 'name') or
        // foreignId('col')->...->references('id', 'name')
        if (preg_match('/foreignId\(\s*[\'"]([^\'"]+)[\'"]\s*\)/', $statement, $columnMatch)) {
            $column = $columnMatch[1];

            if (preg_match('/->\s*constrained\s*\(([^)]*)\)/', $statement, $argsMatch)) {
                $names[] = $this->foreignKeyName($table, $column, $argsMatch[1], 3, $constants);
            } elseif (preg_match('/->\s*references\s*\(([^)]*)\)/', $statement, $argsMatch)) {
                $names[] = $this->foreignKeyName($table, $column, $argsMatch[1], 2, $constants);
            }
        }

        // ->foreign('col' | ['a', 'b']) with optional explicit name
        if (preg_match(
            '/->\s*foreign\s*\(\s*(\[[^\]]*\]|[\'"][^\'"]*[\'"])\s*(?:,\s*([^,\)]+?)\s*)?\)/',
            $statement,
            $foreignMatch
        )) {
            $explicit = $this->resolveValue($foreignMatch[2] ?? '', $constants);

            if ($explicit !== null) {
                $names[] = $explicit;
            } else {
                $columns = $this->quotedStrings($foreignMatch[1]);
                $names[] = strtolower($table.'_'.implode('_', $columns).'_foreign');
            }
        }

        // ->unique([...], 'name') / ->index('col', 'name') etc. with explicit name
        if (preg_match_all(
            '/->\s*(unique|index|fulltext|spatial)\s*\(\s*(?:\[[^\]]*\]|[\'"][^\'"]+[\'"])\s*,\s*([^,\)]+?)\s*\)/',
            $statement,
            $keyMatches,
            PREG_SET_ORDER
        )) {
            foreach ($keyMatches as $keyMatch) {
                $explicit = $this->resolveValue($keyMatch[2], $constants);

                if ($explicit !== null) {
                    $names[] = $explicit;
                }
            }
        }

        // ->unique(['a', 'b']) / ->index('col') without explicit name
        if (preg_match(
            '/->\s*(unique|index|fulltext|spatial)\s*\(\s*(\[[^\]]*\]|[\'"][^\'"]+[\'"])\s*\)/',
            $statement,
            $implicitMatch
        )) {
            $columns = $this->quotedStrings($implicitMatch[2]);
            $names[] = strtolower($table.'_'.implode('_', $columns).'_'.$implicitMatch[1]);
        }

        // Bare ->unique() on a column builder: {table}_{column}_unique
        if (preg_match('/->\s*unique\s*\(\s*\)/', $statement)) {
            $column = $this->firstQuotedString($statement);

            if ($column !== null) {
                $names[] = strtolower($table.'_'.$column.'_unique');
            }
        }

        // ->dropUnique('name') / ->dropIndex('name') / ->dropForeign('name')
        if (preg_match(
            '/->\s*drop(Unique|Index|Foreign|Fulltext|Spatial)\s*\(\s*([\'"][^\'"]+[\'"])\s*\)/',
            $statement,
            $dropMatch
        )) {
            $explicit = $this->resolveValue($dropMatch[2], $constants);

            if ($explicit !== null) {
                $names[] = $explicit;
            }
        }

        // ->dropForeign(['col']) / ->dropUnique(['a', 'b']) by columns
        if (preg_match(
            '/->\s*drop(Unique|Index|Foreign|Fulltext|Spatial)\s*\(\s*(\[[^\]]*\])\s*\)/',
            $statement,
            $dropColumnsMatch
        )) {
            $columns = $this->quotedStrings($dropColumnsMatch[2]);
            $names[] = strtolower(
                $table.'_'.implode('_', $columns).'_'.strtolower($dropColumnsMatch[1])
            );
        }

        return $names;
    }

    /**
     * Derive a foreign-key name: use the explicit name argument when present
     * (3rd argument of constrained(), 2nd of references()), otherwise Laravel's
     * implicit {table}_{column}_foreign.
     *
     * @param  array<string, string>  $constants
     */
    private function foreignKeyName(
        string $table,
        string $column,
        string $arguments,
        int $namePosition,
        array $constants
    ): string {
        $parts = $this->splitArguments($arguments);
        $explicit = $parts[$namePosition - 1] ?? null;

        if ($explicit !== null) {
            $resolved = $this->resolveValue($explicit, $constants);

            if ($resolved !== null) {
                return $resolved;
            }
        }

        return strtolower($table.'_'.$column.'_foreign');
    }

    /**
     * Split a flat argument list, trimming whitespace. Blueprint arguments in
     * this codebase are simple literals (no nested parentheses).
     *
     * @return list<string>
     */
    private function splitArguments(string $arguments): array
    {
        if (trim($arguments) === '') {
            return [];
        }

        return array_map('trim', explode(',', $arguments));
    }

    /**
     * Resolve an argument that is either a quoted literal or a self::CONST /
     * static::CONST reference. Returns null when the argument is an expression
     * the scanner cannot resolve statically.
     *
     * @param  array<string, string>  $constants
     */
    private function resolveValue(string $argument, array $constants): ?string
    {
        $argument = trim($argument);

        if ($argument === '') {
            return null;
        }

        if (preg_match('/^[\'"]([^\'"]+)[\'"]$/', $argument, $match)) {
            return $match[1];
        }

        if (preg_match('/^(?:self|static)::(\w+)$/', $argument, $match)) {
            return $constants[$match[1]] ?? null;
        }

        return null;
    }

    /**
     * @return list<string>
     */
    private function quotedStrings(string $subject): array
    {
        preg_match_all('/[\'"]([^\'"]+)[\'"]/', $subject, $matches);

        return $matches[1];
    }

    private function firstQuotedString(string $subject): ?string
    {
        return preg_match('/[\'"]([^\'"]+)[\'"]/', $subject, $match) ? $match[1] : null;
    }
}
