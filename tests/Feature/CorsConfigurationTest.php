<?php

namespace Tests\Feature;

use Tests\TestCase;

class CorsConfigurationTest extends TestCase
{
    public function test_deployed_frontends_are_allowed_to_preflight_public_api_routes(): void
    {
        $origins = [
            'https://tracktour-frontend.vercel.app',
            'https://nurturing-creation-production-ecea.up.railway.app',
        ];
        $uris = [
            '/api/landing/cards',
            '/api/landing-content',
            '/api/map/businesses',
            '/api/municipalities',
        ];

        foreach ($origins as $origin) {
            foreach ($uris as $uri) {
                $response = $this->withHeaders([
                    'Origin' => $origin,
                    'Access-Control-Request-Method' => 'GET',
                ])->options($uri);

                $response->assertNoContent();
                $response->assertHeader('Access-Control-Allow-Origin', $origin);
            }
        }
    }

    public function test_unapproved_origin_is_not_granted_cors_access(): void
    {
        $response = $this->withHeaders([
            'Origin' => 'https://unapproved.example',
            'Access-Control-Request-Method' => 'GET',
        ])->options('/api/landing/cards');

        $response->assertNoContent();
        $this->assertFalse($response->headers->has('Access-Control-Allow-Origin'));
    }
}
