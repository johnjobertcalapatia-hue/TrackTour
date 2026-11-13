<?php

namespace App\Services\Integrity;

/**
 * Deterministic serialisation for hashing: object keys sorted at every level,
 * list order kept, floats written as fixed strings (no locale / precision
 * drift between PHP, MySQL and SQLite round-trips), no escaped slashes.
 */
final class CanonicalJson
{
    public static function encode(array $value): string
    {
        return json_encode(self::normalize($value), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    }

    public static function normalize(mixed $value): mixed
    {
        if (is_array($value)) {
            $isList = array_is_list($value);
            $out = [];
            foreach ($value as $k => $v) {
                $out[$k] = self::normalize($v);
            }
            if (! $isList) {
                ksort($out, SORT_STRING);
            }

            return $out;
        }
        if (is_float($value)) {
            $s = rtrim(rtrim(sprintf('%.6F', $value), '0'), '.');

            return $s === '-0' ? '0' : $s;
        }
        if ($value instanceof \BackedEnum) {
            return $value->value;
        }
        if ($value instanceof \DateTimeInterface) {
            return $value->format('Y-m-d\TH:i:s.uP');
        }

        return $value;
    }
}
