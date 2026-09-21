<?php

namespace Tests;

use App\Models\User;
use Illuminate\Contracts\Auth\Authenticatable as UserContract;
use Illuminate\Foundation\Testing\TestCase as BaseTestCase;

abstract class TestCase extends BaseTestCase
{
    /**
     * Authenticate a user for API requests.
     *
     * The API routes are guarded by TokenOnlyAuth, which authenticates only via
     * a real Bearer token. The default actingAs() sets the guard user but sends
     * no token, so mint a Sanctum token and attach it to subsequent requests.
     */
    public function be(UserContract $user, $guard = null)
    {
        parent::be($user, $guard);

        if ($user instanceof User) {
            $this->withToken($user->createToken('test-suite')->plainTextToken);
        }

        return $this;
    }
}
