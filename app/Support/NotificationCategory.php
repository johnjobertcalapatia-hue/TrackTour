<?php

namespace App\Support;

/**
 * Notification tabs. A notification's category comes from its type, so older
 * notifications (created before the data column) are categorised too.
 * Types not listed here only appear under "All".
 */
final class NotificationCategory
{
    public const CATEGORIES = ['orders', 'messages', 'reviews', 'system'];

    public const TYPES = [
        'orders' => [
            'order_created', 'order_status_changed', 'booking_created', 'booking_status_changed',
            'delivery_assigned', 'delivery_status_changed', 'ride_status_changed',
        ],
        'messages' => ['message_received'],
        'reviews' => ['review_received'],
        'system' => ['system_maintenance', 'business_approved', 'business_rejected', 'welcome'],
    ];

    public static function forType(?string $type): string
    {
        foreach (self::TYPES as $category => $types) {
            if (in_array($type, $types, true)) {
                return $category;
            }
        }

        return 'other';
    }

    /** @return list<string> */
    public static function types(string $category): array
    {
        return self::TYPES[$category] ?? [];
    }
}
