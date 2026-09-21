# Firebase Security Rules — TrackTour

## Overview
These rules enforce role-based access control per Section 15 of the architecture guide. All rules assume Firebase Auth custom claims are set by Laravel on login:

```php
// Laravel sets these custom claims on Firebase token
$customClaims = [
    'role' => $user->role,           // 'guide' | 'tourist' | 'business_owner' | 'tourism_office' | 'super_admin'
    'business_id' => $user->business_id ?? null,
];
```

---

## Data Structure & Rules

### `live_locations/{guideId}` — Real-time GPS
| Role | Read | Write |
|------|------|-------|
| Guide (owner) | ✅ | ✅ |
| Tourist (assigned) | ✅ via `assignments/{guideId}/{touristId}` | ❌ |
| Business (assigned) | ✅ via `business_guides/{businessId}/{guideId}` | ❌ |
| Tourism Office | ❌ | ❌ |
| Super Admin | ✅ | ✅ |

**Validation:** Requires `lat`, `lng`, `ts` as numbers.

---

### `active_trips/{tripId}` — Trip metadata
| Role | Read | Write |
|------|------|-------|
| Guide (assigned) | ✅ | ✅ (create) |
| Tourist (assigned) | ✅ | ❌ |
| Business (assigned) | ✅ via `business_trips/{businessId}/{tripId}` | ❌ |
| Tourism Office | ✅ | ❌ |
| Super Admin | ✅ | ✅ |

**Validation:** Requires `guide`, `tourist`, `status`.

---

### `rider_requests/{riderId}/{deliveryId}` — Dispatch requests
| Role | Read | Write |
|------|------|-------|
| Rider (owner) | ✅ | ❌ |
| Super Admin | ✅ | ✅ |

---

### `booking_requests/{deliveryId}` — Booking negotiations
| Role | Read | Write |
|------|------|-------|
| Tourist (owner) | ✅ | ❌ |
| Rider (assigned) | ✅ | ✅ (accept/decline) |
| Super Admin | ✅ | ✅ |

---

### `business_guides/{businessId}` — Guide↔Business mapping
| Role | Read | Write |
|------|------|-------|
| Business Owner | ✅ (own) | ❌ |
| Super Admin | ✅ | ✅ |

---

### `business_trips/{businessId}` — Trip↔Business mapping
| Role | Read | Write |
|------|------|-------|
| Business Owner | ✅ (own) | ❌ |
| Super Admin | ✅ | ✅ |

---

### `assignments/{guideId}` — Tourist↔Guide assignments
| Role | Read | Write |
|------|------|-------|
| Guide | ✅ (own) | ❌ |
| Tourist | ✅ (own) | ❌ |
| Tourism Office | ✅ | ❌ |
| Super Admin | ✅ | ✅ |

---

### `tourist_trips/{touristId}` — Tourist's active trips
| Role | Read | Write |
|------|------|-------|
| Tourist | ✅ (own) | ❌ |
| Super Admin | ✅ | ✅ |

---

## Deployment

```bash
firebase deploy --only database
```

Or via Firebase Console → Realtime Database → Rules → Paste JSON → Publish.

---

## Testing Rules

Use Firebase Console → Simulator:

```json
// Guide writing own location
{
  "path": "/live_locations/guide_123",
  "method": "write",
  "auth": { "uid": "guide_123", "token": { "role": "guide" } },
  "data": { "lat": 12.123, "lng": 121.456, "ts": 1720000000 }
}
```

```json
// Tourist reading assigned guide
{
  "path": "/live_locations/guide_123",
  "method": "read",
  "auth": { "uid": "tourist_456", "token": { "role": "tourist" } },
  "data": { "lat": 12.123, "lng": 121.456, "ts": 1720000000 }
}
```

```json
// Business reading assigned guide
{
  "path": "/live_locations/guide_123",
  "method": "read",
  "auth": { "uid": "biz_789", "token": { "role": "business_owner", "business_id": "biz_001" } },
  "data": { "lat": 12.123, "lng": 121.456, "ts": 1720000000 }
}
```

---

## Custom Claims Setup (Laravel)

```php
// app/Services/FirebaseAuthService.php
public function setCustomClaims(User $user): void
{
    $claims = [
        'role' => $user->role,
    ];
    
    if ($user->role === 'business_owner' && $user->businesses()->exists()) {
        $claims['business_id'] = $user->businesses->first()->id;
    }
    
    FirebaseAuth::getAuth()->setCustomUserClaims($user->firebase_uid, $claims);
}
```

Call on login, role change, or business assignment.

---

## Firestore vs Realtime Database

These rules are for **Realtime Database** (`database.rules.json`). If using Firestore, rules syntax differs (`rules_version = '2'; service cloud.firestore { match /databases/{database}/documents { ... } }`).

TrackTour uses Realtime Database for live GPS — these rules apply there.