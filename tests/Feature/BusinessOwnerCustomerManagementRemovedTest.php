<?php

namespace Tests\Feature;

use Tests\TestCase;

class BusinessOwnerCustomerManagementRemovedTest extends TestCase
{
    public function test_business_owner_customer_management_endpoints_are_removed(): void
    {
        $this->getJson('/api/business-owner/customers')->assertNotFound();
        $this->getJson('/api/business-owner/customers/summary')->assertNotFound();
        $this->getJson('/api/business-owner/customers/1')->assertNotFound();
    }
}
