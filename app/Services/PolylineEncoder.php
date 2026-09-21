<?php

namespace App\Services;

class PolylineEncoder
{
    private int $precision;

    public function __construct(int $precision = 5)
    {
        $this->precision = $precision;
    }

    public function encode(array $points): string
    {
        if (empty($points)) {
            return '';
        }

        $encoded = '';
        $prevLat = 0;
        $prevLng = 0;

        $factor = 10 ** $this->precision;

        foreach ($points as $point) {
            $lat = (int) round($point[0] * $factor);
            $lng = (int) round($point[1] * $factor);

            $encoded .= $this->encodeSigned($lat - $prevLat);
            $encoded .= $this->encodeSigned($lng - $prevLng);

            $prevLat = $lat;
            $prevLng = $lng;
        }

        return $encoded;
    }

    public function decode(string $encoded): array
    {
        if ($encoded === '') {
            return [];
        }

        $points = [];
        $index = 0;
        $len = strlen($encoded);
        $lat = 0;
        $lng = 0;
        $factor = 10 ** $this->precision;

        while ($index < $len) {
            $b = 0;
            $shift = 0;
            $result = 0;

            do {
                $b = ord($encoded[$index++]) - 63;
                $result |= ($b & 0x1F) << $shift;
                $shift += 5;
            } while ($b >= 0x20);

            $dLat = ($result & 1) ? ~($result >> 1) : ($result >> 1);
            $lat += $dLat;

            $shift = 0;
            $result = 0;

            do {
                $b = ord($encoded[$index++]) - 63;
                $result |= ($b & 0x1F) << $shift;
                $shift += 5;
            } while ($b >= 0x20);

            $dLng = ($result & 1) ? ~($result >> 1) : ($result >> 1);
            $lng += $dLng;

            $points[] = [$lat / $factor, $lng / $factor];
        }

        return $points;
    }

    private function encodeSigned(int $value): string
    {
        $value = $value << 1;
        if ($value < 0) {
            $value = ~$value;
        }

        $chunks = [];
        while ($value >= 0x20) {
            $chunks[] = (0x20 | ($value & 0x1F)) + 63;
            $value >>= 5;
        }
        $chunks[] = $value + 63;

        return implode('', array_map('chr', $chunks));
    }
}
