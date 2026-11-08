# Design System: Tourism Management Portal

This document defines the core visual language for the application. All new features should adhere to these specifications to ensure a consistent experience.

## 1. Color Palette (The "Emerald & Amber" Theme)

This palette is designed to evoke trust (Emerald) and warmth/hospitality (Amber).

| Usage | Role | Tailwind Class | Hex Code |
| --- | --- | --- | --- |
| **Primary** | Actions, Success, Live Status | `emerald-600` | `#059669` |
| **Secondary** | Pending, Attention, Warnings | `amber-500` | `#F59E0B` |
| **Surface** | Panels and cards | Milky white | `#F8FAF6` |
| **Background** | Page Base | `gray-50` | `#F9FAFB` |
| **Typography** | Body Text | `gray-800` | `#1F2937` |
| **Tourist UI accents** | Saturated emerald and mint surfaces | Scoped to `.tourist-ui` |

## 2. Component Guidelines

### Card Style (`.app-card`)

Every widget on the dashboard must share the same structural integrity:

* **Background:** `bg-white`
* **Border:** soft green-gray border
* **Radius:** `rounded-2xl`
* **Shadow:** restrained layered clay shadows with a subtle inset highlight

## 5. Claymorphism

Shared user-facing panels and controls use a restrained claymorphism treatment:

* Panels use milky-white surfaces and soft raised shadows,
  rounded corners, and a subtle inset highlight.
* Buttons retain their semantic colors and use raised shadows by default,
  softer shadows on hover, and inset shadows while pressed.
* Tourist-facing status accents and pale green surfaces use a more saturated
  emerald treatment without changing other role palettes.
* Apply shared treatments through `.glass-card`, `.glass-panel`,
  `.tourism-card`, `.clay-card`, and `.clay-menu-item` in
  `frontend/src/index.css`. Use `.clay-card` for raised panels and `.clay-menu-item`
  for interactive menu choices and compact cards; retain semantic state colors.

## 6. Tourist UI Palette & Contrast (WCAG 2.2 AA)

Tourist pages render inside `TouristLayout` (`.tourist-ui clay-ui`), which is a
**light theme only**. Do not use dark panels (`bg-gray-900`, `text-gray-100`)
on tourist pages; the only dark surfaces allowed are overlays on photos
(image gradients, rating pills) and the green hero banners.

| Role | Class to write | Renders as | On surface `#F8FAF6` | On mint `#E3F4E9` |
| --- | --- | --- | --- | --- |
| Primary text / headings | `text-[#17201B]` | `#17201B` | 15.9:1 | 14.6:1 |
| Brand text / links | `text-[#087F3F]` | `#047332` | 5.7:1 | 5.3:1 |
| Secondary text | `text-[#68736D]` | `#56615B` | 6.1:1 | 5.6:1 |
| Muted / meta text | `text-[#9CA3AF]`, `text-gray-400` | `#636E69` | 5.0:1 | 4.6:1 |
| Card surface | `bg-white` | `#F8FAF6` | | |
| Mint accent surface | `bg-[#E9F7EF]` | `#E3F4E9` | | |
| Primary button | `bg-[#087F3F] text-white` | | 5.1:1 | |

Rules:

* Body text must meet **4.5:1** and large text and icons **3:1**. Check new
  color pairs before adding them. Disabled controls are exempt.
* Tourist overrides live in `frontend/src/index.css` under `.tourist-ui`.
  Theme colors (`emerald-*`, `green-*`, `gray-400`) are re-pointed with CSS
  variables so `hover:`/`focus:`/`disabled:` and `/opacity` variants still work.
* Arbitrary-hex overrides must use `[class~="…"]` (exact class token), never
  `[class*="…"]`. Otherwise `hover:text-[#087F3F]` or `text-[#087F3F]/30` would
  be forced to a solid color.
* Element-level defaults (`body`, `h1–h6`, `button`, `header`) live in
  `@layer base`. Unlayered element rules override every Tailwind utility (e.g.
  a `text-white` heading over a photo would render dark).
* Gold `#F4B400` is for star/favorite icons only, never for text (1.9:1).

### Tourist shell & restaurant page (2026-11-05)

* **Sidebar** (`TouristSidebar`, 248px, full height): brand, user card, nav
  (Home, Explore, Food & Dining, Stays, My Activities, Saved, Profile), the
  "Discover Bansud" promo card (`/assets/tourism/discover-bansud.png`), Log Out
  (Sign In for guests). Active item = solid green gradient pill, white text.
* **Mobile/tablet bottom bar** (`TouristLayout`, below `lg`): the same seven
  items as the sidebar, from `tourist-nav.ts` (single source of truth, shared
  active-route logic). Short labels on phones (Food, Activities), full labels
  from `sm`. Accessible names are always the full label. Map is reached via
  Explore → Map view.
* **Top bar** (`TouristHeader`): no search bar (removed 2026-11-06). Round
  Cart, Saved and Notifications buttons sit on the right, with red count
  badges. The logo shows only on mobile. Tourists search from the Home hero
  search box, which goes to `/tourist/search`.
* **Restaurant page** (`TouristFoodShow`, `/tourist/food/:id`): photo hero
  with logo tile, rating, location, category/delivery/open-until chips and a
  Save button; overlapping tab bar (Menu, About, Photos, Reviews, Location);
  menu cards (Popular badge = `bestseller`, outline "Add" button); right column
  with Restaurant Info + Restaurant Rating breakdown.
* **Food item page** (`TouristFoodItemDetail`, `/tourist/food/item/:id`): gallery
  (Popular badge, counter, arrows, thumbnails), summary (category, name,
  restaurant rating, price, unit, open status, prep time), sticky Add to Cart
  card (quantity, size tiles, total, Add to Cart / Buy Now; on mobile a bar above
  the bottom nav: Restaurant | Chat | Add to Cart on the left half, Buy Now on the
  right half),
  restaurant reviews with breakdown, restaurant strip. Each fact appears once (no
  separate About/facts block); on mobile the order card follows the summary. Ingredients,
  allergens, spice level, add-ons and per-dish ratings are **not** shown because
  the database has no such fields. Ratings are labelled "restaurant rating".
  `Review::approvedSummaryFor()` feeds both this page and the restaurant page.
* **Location tab** (`RestaurantRouteMap`): in-app route from the tourist's
  current GPS position to the restaurant via the shared `useOsrmRoute` hook
  (OSRM cycling profile, so times are approximate). It shows distance and time,
  a dashed straight line while loading or offline, and Update / Clear. It does not
  send tourists to Google Maps.
* Rating numbers come from `GET /tourist/explore/{id}`: `avgRating`,
  `reviewsCount` and `ratingBreakdown` are all computed over **all approved**
  reviews. Never show per-dish ratings or service modes (dine-in/takeout)
  that the API does not provide.
* **Home** (`TouristHome`): full-bleed photo hero carousel (real Bansud spots in
  `/assets/tourism/`), "Explore Bansud" headline, search, category chips, wavy
  bottom edge; then Featured Destinations, Popular Food & Restaurants (+ "Plan
  Your Bansud Getaway" card), Recommended Stays, Recently Viewed, For You and
  Events. Cards show a rating only when the API has one ("New on TrackTour"
  otherwise). Distance chips only appear when the tourist shares location.
  Cart writes go through `shared/services/food-cart.ts`.
* **Stays & Deals** (`TouristStays`, `GET /tourist/stays`): a Deals & Promotions
  row (active promos of accommodations and tourist attractions only), search + sort,
  real accommodation-type chips, stay cards with a "Book online" badge where
  `accepts_reservation` is on, and Show more. `/tourist/booking` stays the
  *bookable-only* list for the booking flow. No date pickers until availability
  exists.
* **Flexible layout rules** (320px phones → ultrawide):
  * Card grids use `.home-grid` / `.food-menu-grid` (index.css): auto-fill
    columns, each ≥ `--card-min` (200–230px), never more than 4 per row.
    Don't hard-code `grid-cols-N` breakpoints for card lists.
  * Heroes use `min-h-*` + flex flow (never a fixed `h-*` with absolutely
    positioned text) so wrapped text grows the banner instead of clipping.
  * Headings use `clamp()` sizes; content is capped at `max-w-[1600px]`.
  * Side columns (restaurant info) sit beside content only from `xl`; below
    that they stack (two-up from `md`).
  * Main padding is `px-4 pt-4` → `sm:px-6 sm:pt-6`; full-bleed sections cancel
    it with `-mx-4 -mt-4 sm:-mx-6 sm:-mt-6`.
  * Header height is `--tourist-header-h` (64px, 84px from `sm`). Use it for
    sticky offsets and full-height pages instead of hard-coded pixels.
* **Page transition:** `TouristLayout` wraps each route in a keyed
  `.tourist-page-enter` div (280ms fade + 10px rise). It uses
  `animation-fill-mode: backwards` so no transform remains afterwards. A
  lingering transform would re-anchor `position: fixed` children (cart bar,
  sheets, modals). It is disabled under `prefers-reduced-motion`.
* **No glow on tourist pages:** inside `.tourist-ui` the clay white-edge glow and
  coloured shadows are disabled. Buttons/links are flat (pressed = slight
  darken); cards use one subtle neutral shadow with a gentle neutral lift on
  hover. Other roles keep the clay look.
* Pill buttons keep `rounded-full` inside `.clay-ui` through the
  `.tourist-ui button[class~="rounded-full"]` rule in `index.css`.
* **Location-aware place name:** the sidebar "Discover <place>" card and the
  Home hero ("Welcome to <place>!", "Explore <place>", the beauty of
  <province>) use `useCurrentMunicipality()`
  (`shared/hooks/use-current-municipality.ts`). The hook calls browser
  geolocation, then the public endpoint
  `GET /api/municipalities/locate?lat&lng`. That endpoint returns the nearest
  municipality centre within 25 km, or `null`; it is throttled to 30 requests
  per minute. The result is cached in sessionStorage for 10 minutes. A denied
  location, a location outside covered municipalities, or an error falls back
  to **Bansud**. When the place is located, the sidebar card links to that
  municipality's page.
* **Home sections follow the municipality:** Featured Destinations, Popular
  Food, Recommended Stays and Upcoming Events are requested with the tourist's
  municipality. The filters are `/tourist/destinations?municipality=`,
  `/tourist/food`, `/tourist/stays` and `/tourist/events?municipality_id=`; each
  is optional, and omitting it keeps every municipality. A section loads
  through `fetchScoped`. If the town has nothing listed, the section falls
  back to all municipalities and its subtitle names the province ("Relax and
  unwind in Oriental Mindoro"), so it never claims the items are local. The
  "Plan Your <place> Getaway" card also follows the municipality.
* **Municipality photos:** the sidebar "Discover" card, the Home hero carousel
  and the "Plan Your Getaway" card all use `useMunicipalityPhotos(id)`. The hook
  calls `GET /api/municipalities/{id}/photos`, which returns up to 8 photos in
  this order:
  1. the municipality `cover_photo`;
  2. attraction photos, from active destinations and approved spot
     businesses;
  3. cover photos of other approved businesses.

  The sidebar uses photo 1, the getaway card photo 2 (or photo 1), and the hero
  shows all of them, with carousel controls only when there are two or more.
  If the municipality has **no photos**, each spot shows `PhotoPlaceholder`
  (an empty dashed container, "No photo yet") for that municipality's tourism
  office to fill. Another town's photo is never used in its place. The default
  Bansud artwork appears only when the tourist's location is unknown.

### Status Badges

* **Approved:** `bg-emerald-50 text-emerald-700 border border-emerald-200`
* **Pending:** `bg-amber-50 text-amber-700 border border-amber-200`

## 3. Visual Hierarchy

* **Header:** Use `text-3xl` for page titles.
* **Stat Grids:** Always place the most critical KPIs at the top using the `grid-cols-1 md:grid-cols-4` responsive pattern.
* **Actions:** Group quick-access buttons in a dedicated `Quick Actions` card to keep the main view clean.

## 4. Implementation Snippet

To implement this consistently, add the following to your `tailwind.config.js`:

```javascript
theme: {
  extend: {
    colors: {
      brand: {
        primary: '#059669', // Emerald
        accent: '#F59E0B',  // Amber
      }
    }
  }
}
```

### Explore map: tourist location & markers (2026-11-05)

* **Default view:** every time the Explore map opens, it centres on the
  tourist's first location fix (zoom 15). The old once-per-session
  `tracktour_map_autofocused` flag was removed. Centring is skipped when a
  business or route is already in focus, such as a "Get directions" hand-off.
* **Location marker:** the tourist's position is followed with
  `watchPosition` and cleared on unmount, and drawn as one marker with
  `zIndexOffset` 10000, so it is always above the business pins. It is
  non-interactive, and the route overlay no longer draws a second origin pin.
  Signed-in tourists see `profilePinIcon` (profile photo, or initials, in the
  green round image pin, no white ring); guests see `userPinIcon`.
* **"Show my location"** button sits below the map-type tile, in the
  top-right controls column, and re-centres on the tourist.
* **Restaurant markers** match the landing-page map: `businessLogoIcon`, the
  round image pin, using the logo or else the cover photo. Attractions keep the
  beach pin; other businesses keep the labelled pin.
* **Get directions vs Navigate:** "Get directions" (hover card or panel) only
  draws the route line, framed north-up. The hover card's round green
  **Navigate** button (arrow icon) draws the route *and* starts the navigation
  view. Both call `handleDirections(b, { navigate })`. The compass button can
  switch between the two views at any time.
* **Navigation view (Waze / Google Maps style):** started by Navigate, or by
  the compass toggle once a route is shown.
  * **Straight line up from the centre (Google Maps style).**
    `useNavigationBearing` turns the map to the direction of the road right
    under the tourist (`bearingAlongRoute`: 20 m along the remaining route,
    interpolated on the line). While navigating within 40 m of the route, the
    marker and camera use the tourist's position snapped onto the line
    (`markerLocation`). The centred marker therefore sits on the route, and the
    line leaves it straight up the screen toward the destination. Off the
    route, the raw GPS position is shown while it re-plans. GPS course, then
    the device compass, are fallbacks used only without a route. iOS compass
    permission is requested on the Navigate tap.
  * `NavigationCamera`: on Navigate it zooms in to zoom 18, or keeps a
    closer zoom, and keeps the tourist's pinch zoom afterwards.
    * **Marker position:** `navMarkerScreenOffset` puts the marker's tip
      30 px above the top of the mobile bottom navigation bar, directly over
      its "Stays" button. Positions are measured from the live layout and
      re-measured on resize. Without the bar (desktop), the tip sits 30 px
      above the bottom of the map. Before the layout is measured, the marker
      is centred.
    * **Rotation:** the camera turns that screen offset back into the
      unrotated map (by +bearing), so the marker stays at that spot while
      the map turns.
    * Dragging is off, and zoom gestures zoom about the centre.
  * The `.map-rotator` wrapper becomes a square the size of the map's
    diagonal and rotates by -bearing. No Leaflet plugin is used, so other
    maps are unaffected.
  * **Names follow the compass:** every pin's artwork (pin and name label) is
    wrapped by `rotatable()` in `pin-icon.ts` in one `.marker-rot` element
    that turns about the pin tip (the icon anchor). While navigating, CSS
    turns that wrapper by the map bearing, so a restaurant's name turns with
    its pin and stays upright and readable instead of drifting away from it.
  * **Navigation card (small, horizontal, travel-only):** while navigating,
    the full route card (travel modes, fares, "Book a Rider", "Close route")
    is replaced by a compact card at the top-left of the map
    (`aria-label="Navigation"`). Time, Distance and Speed sit side by side in
    one row with dividers, the exit button is on the right, and
    "To <place> · by <mode>" is underneath. On phones it leaves room for the
    controls column; from `sm` it is 320 px wide.
    * Time: remaining distance at the chosen mode's speed.
    * Distance: what's left of the road distance (metres under 1 km).
    * Speed: live GPS speed in km/h, or "—" if the device doesn't report it.

    No fare is computed. "Exit navigation" returns to the whole-route view
    and its full card, as the compass button does.
  * **The route follows the tourist** (`routeProgress` in
    `features/tourist/utils/route-progress.ts`). The tourist is snapped onto
    the line and only the part still ahead is drawn, so the line starts at
    their marker and is consumed as they move. The route card shows the
    distance left: OSRM's road distance scaled by the share of the route still
    ahead. More than 40 m off the line triggers a re-plan from the current
    position (at most once every 10 s, and stale answers are ignored), so the
    route grows or shrinks with the way they actually go. In the overview, the
    camera still frames the whole route.
  * The compass button toggles to the north-up whole-route view (dragging back
    on) and back. Closing the route ends navigation. Hover previews are off
    while navigating.
* **List / Map view switch:** `ExploreViewToggle` (tourist components) is one
  green pill used on both Explore views, at the right end of the top row. On
  the list it reads "Map view" and opens the map on the current tab's
  category. On the map it reads "List view" and returns to that tab. Same
  look, same place, so clicking it simply flips the view.

### Menu item photos & videos: owner Edit Menu Item → tourist carousel (2026-11-05)

* Business owners can add up to **7 more photos or short videos** per menu
  item besides the main Food Image (8 in total), on Edit Menu Item under
  "More photos & videos". Several files can be picked at once, any can be
  removed, and changes are saved with **Save Changes**.
  * Photos: JPG, PNG or WebP, up to 5 MB.
  * Videos: MP4, MOV or WebM, up to 20 MB.
* API: PUT /api/business-owner/menu/{id} (BusinessOwnerMenuManageController)
  accepts gallery_images[] (new uploads) and remove_gallery[] (paths to delete;
  only this item's own files are ever deleted). The same applies to
  POST /menu for new items. Responses include gallery: [{ path, url, type }],
  where type is image or video.
* Storage: paths are kept in offerings.images, and deleting the item deletes
  its files.
* Tourists see the main image followed by these in the food item's swipeable
  carousel (FoodImageCarousel). Videos autoplay muted on a loop when their
  slide is showing (not under prefers-reduced-motion), with controls to
  unmute; video
  thumbnails show a play badge, and a video pauses when the tourist moves to
  another slide.
* Note: PHP post_max_size / upload_max_filesize (40 MB on this XAMPP) caps a
  single save, so several large videos may need to be added over more than one
  save.

### My Orders: tabs, item by item (2026-11-06)

* `/tourist/orders` has tabs: **All · To Pay · Preparing · In Transit ·
  To Receive · To Review**, with counts. The tab is kept in `?tab=`.
* Data comes from `GET /api/tourist/orders?tab=` (TouristOrderListController,
  read-only). Each checkout is **one section**: one order number, every dish
  listed individually (image, name, restaurant, note, quantity, line price),
  subtotal, **one delivery fee**, tip and total. A group checkout's dishes from
  several restaurants stay in the same section.
* Tabs are derived from the authoritative order and delivery status:
  * To Pay: unfinished online payment (pending_payment / unpaid GCash), plus
    COD orders whose cash is still due. A COD order also stays in its progress
    tab and leaves To Pay once delivered.
  * Preparing: placed and paid (or COD). Waiting for a rider, accepted,
    preparing or ready.
  * In Transit: picked_up / in_transit. "Track rider on map" opens the live
    rider map on `/tourist/orders/:id/progress`.
  * To Receive: the delivery is arrived_destination. "Order received" calls
    the canonical confirm-delivery endpoint.
  * To Review: delivered or completed and not rated. The form posts the
    canonical `POST /tourist/food/order/{id}/rate` with the food rating,
    review text and the rider's stars (`delivery_rating`).
  * All: everything, including reviewed and cancelled orders.
* **To Review, dish by dish (2026-11-06).** Each dish shows its photo, name,
  details, quantity and price, plus three actions:
  * **Buy again**: the same quantity goes into the cart at today's price, then
    the cart and checkout page opens.
  * **Add to cart**: one at today's price.
  * **Write review**, or "★N · Edit review" once reviewed.

  Buttons are disabled when the dish is no longer on the menu. Tapping the
  dish opens **Order details** (`/tourist/orders/:id/details`): order ID,
  delivery date, recipient name and phone, delivery address, items, and
  subtotal, delivery fee, tip and **total payment**. There, tapping a dish
  opens its food item page.
* **Write review** (`/tourist/orders/:orderId/items/:itemId/review`): star
  rating, feedback (up to 1000 characters), up to 5 photos of the food
  received (JPG, PNG or WebP, 5 MB each), and the rider's stars (once per
  order).
  * It posts `POST /tourist/food/order/{order}/items/{item}/review`
    (OrderItemReviewController), which stores the review in
    `order_item_reviews` (UNIQUE order_item_id: one review per dish;
    sending again updates it and replaces its photos).
  * It also refreshes the order's business review and `orders.rating` /
    `delivery_rating`, so restaurant and rider ratings keep working.
  * An order leaves To Review when every dish is reviewed. Orders rated the
    earlier, whole-order way count as reviewed.
  * The dish's food rating on cards uses its own approved dish reviews, and
    whole-order ratings only for orders without dish reviews.
  * Migration `2026_11_06_000001_create_order_item_reviews_table` was
    applied to the dev database: `SHOW CREATE TABLE` checked, and a live
    probe confirmed a duplicate review for the same dish fails with error
    1062.

### My Activities (2026-11-06)

* The **My Activities** nav item (sidebar and bottom bar) opens
  `/tourist/activities` (`TouristActivities`). It also stays highlighted on
  /tourist/orders, trips, history and bookings.
* Tabs, kept in `?view=`:
  * **Explored** (default): restaurants, attractions, foods and resorts the
    tourist opened, newest first, with filters (All / Restaurants /
    Attractions / Foods / Resorts), "Viewed N ago", and Clear history.
  * **Orders**: the My Orders page embedded (its own `?tab=` sits alongside
    `?view=orders`).
  * **Travels**: "Places you've been". These are municipality cards with a
    photo, province, tags (N food deliveries / stays / rides / "You were
    here") and the last visit; each opens the municipality page. Trips &
    bookings are listed below.
    * Server, from real records (`GET /api/tourist/travels`,
      TouristTravelsController): delivered or completed food orders (delivery
      address → nearest municipality), confirmed, checked-in or completed
      bookings whose check-in date has passed, and completed rides (drop-off).
    * Device: municipalities where the app detected the tourist's location
      (`recordMunicipalityVisit`, localStorage).
    * `MunicipalityLocator` (nearest centre ≤ 25 km) is shared with
      `/municipalities/locate`.
  * **Favourites**: the saved places (`TouristFavorites` embedded).
* Browsing history (`shared/services/browsing-history.ts`) is stored on the
  device (localStorage) and keeps the latest 60 entries; Home's "Recently
  Viewed" shows the latest 8.
  * Recorded from: restaurant pages, explore place pages (attractions and
    stays), destination pages (attractions) and food item pages (dishes,
    `kind: 'food'`).
  * A dish and a place with the same id are kept as separate entries.
