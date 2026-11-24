<?php

namespace App\Exceptions;

use RuntimeException;

/** The verification code could not be emailed (mail provider refused or unreachable). */
class OtpDeliveryException extends RuntimeException {}
