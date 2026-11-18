<?php

namespace App\Exceptions;

use RuntimeException;

/**
 * A moderation action (approve / reject / suspend) that cannot be applied in
 * the record's current state. Controllers render it as a 422.
 */
class ModerationException extends RuntimeException {}
