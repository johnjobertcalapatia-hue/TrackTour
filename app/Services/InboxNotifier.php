<?php

namespace App\Services;

use App\Models\Notification;

/**
 * Creates notifications that point at a record (data), folding repeats into
 * one unread notification: a second chat message in the same conversation, or
 * a second dish review on the same order, updates the unread notification
 * instead of adding another. Once read, the next one is new again.
 */
class InboxNotifier
{
    /**
     * @param  array<string, int|string|null>  $data
     * @param  list<string>  $foldOn  data keys that identify "the same thing"
     */
    public function notify(int $userId, string $type, string $title, string $message, array $data, array $foldOn = []): Notification
    {
        if ($foldOn !== []) {
            $query = Notification::where('user_id', $userId)->where('type', $type)->whereNull('read_at');
            foreach ($foldOn as $key) {
                $query->where("data->{$key}", $data[$key] ?? null);
            }
            $existing = $query->latest('id')->first();

            if ($existing) {
                $existing->forceFill([
                    'title' => $title,
                    'message' => $message,
                    'data' => array_merge($existing->data ?? [], $data),
                    'created_at' => now(),
                    'updated_at' => now(),
                ])->save();

                return $existing;
            }
        }

        return Notification::create([
            'user_id' => $userId,
            'type' => $type,
            'title' => $title,
            'message' => $message,
            'data' => $data,
        ]);
    }
}
