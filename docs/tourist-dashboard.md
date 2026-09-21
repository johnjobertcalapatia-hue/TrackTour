# TrackTour Tourist User Dashboard System Specification


## Overview


The TrackTour Tourist User Dashboard is a tourism platform designed to help tourists discover destinations, book accommodations, order local foods, hire transportation services, and navigate using an interactive geographic mapping system.


The system provides tourists with a complete digital travel experience by connecting them with:


- Tourist attractions
- Resorts and hotels
- Food hubs and restaurants
- Local riders and transportation providers
- Local businesses
- Tourism services


The platform uses geolocation and mapping technologies to provide location-based recommendations and navigation.


---


# 1. Tourist User Account Module


## Purpose


Allows tourists to create and manage their personal accounts.


## Features


### Tourist Registration


Required Information:


- Full Name
- Email Address
- Mobile Number
- Password
- Profile Picture
- Date of Birth
- Gender
- Address
- Emergency Contact


---


## Tourist Profile Management


Tourists can manage:


- Personal information
- Profile photo
- Contact details
- Saved destinations
- Favorite businesses
- Booking history
- Order history
- Reviews


---


# 2. Tourist Dashboard Home Module


## Purpose


Provides a personalized tourism dashboard after login.


## Dashboard Components


### Welcome Section


Displays:


- Tourist name
- Current location
- Weather information (optional)
- Recommended destinations


Example:


```


Welcome, John!


Your Current Location:
📍 Bansud, Oriental Mindoro


Discover nearby:
🏝 Tourist Spots
🏨 Resorts
🍜 Food Hubs
🏍 Riders


```


---


# 3. Location-Based Discovery Module


## Purpose


Allows tourists to discover nearby tourism services.


## Features


Uses:


- GPS Location
- Browser Geolocation API
- Leaflet Map API


---


## Nearby Search Categories


Tourists can search:


### Tourist Attractions


- Beaches
- Waterfalls
- Mountains
- Historical places
- Cultural sites


### Accommodation


- Resorts
- Hotels
- Inns
- Homestays


### Food Services


- Restaurants
- Food hubs
- Local delicacies


### Transportation


- Riders
- Local guides
- Vehicles


---


# 4. Tourist Spot Explorer Module


## Purpose


Allows tourists to browse and explore destinations.


---


## Tourist Spot Listing


Each destination displays:


```


Tourist Spot Card


Image


Name:
Amomong Falls


Rating:
⭐ 4.8


Distance:
2.5 km away


Location:
Bansud, Oriental Mindoro


Buttons:


[View Details]
[View Map]
[Save]


```


---


# Tourist Spot Details


Information:


- Destination name
- Description
- History
- Gallery
- Operating hours
- Entrance fees
- Activities
- Visitor reviews
- Location


---


## Tourist Spot Map


Features:


- Location marker
- Distance calculation
- Route navigation
- Nearby establishments


---


# 5. Resort and Hotel Booking Module


## Purpose


Allows tourists to search and reserve accommodations.


---


# Accommodation Search


Filters:


- Location
- Price range
- Rating
- Amenities
- Availability date


---


# Resort / Hotel Profile


Information:


## Basic Information


- Business name
- Description
- Contact details
- Location


## Gallery


Displays:


- Resort images
- Rooms
- Facilities
- Activities


## Amenities


Examples:


- Swimming pool
- WiFi
- Restaurant
- Parking
- Beach access


---


# Room Booking Module


## Room Information


Displays:


```


Room Type:


Deluxe Room


Price:


₱2500/night


Capacity:


2 persons


Available:


5 rooms


Amenities:


✔ Air Condition
✔ Television
✔ Private Bathroom


```


---


# Booking Process


```


Select Resort
|
↓
Select Room
|
↓
Choose Date
|
↓
Enter Guest Information
|
↓
Payment
|
↓
Booking Confirmation


```


---


# Booking Status


Possible statuses:


- Pending
- Approved
- Checked-in
- Completed
- Cancelled


---


# 6. Food Hub Module


## Purpose


Allows tourists to discover and order local foods.


---


# Food Hub Discovery


Displays:


- Restaurant name
- Distance
- Rating
- Food category
- Operating hours


Example:


```


Mang Juan Food Hub


⭐ 4.7 Rating


Distance:
1.2 km


Open:
8AM - 10PM


```


---


# Menu Browsing


Food items include:


- Food image
- Food name
- Description
- Price
- Availability


Example:


```


Chicken Rice Meal


₱120


Available


[Add To Cart]


```


---


# Food Ordering Process


```


Browse Menu
|
↓
Add Food To Cart
|
↓
Checkout
|
↓
Choose Delivery/Pickup
|
↓
Confirm Order


```


---


# Food Order Tracking


Status:


- Pending
- Accepted
- Preparing
- Ready
- Out for Delivery
- Completed


---


# 7. Rider Booking Module


## Purpose


Allows tourists to book local transportation.


---


# Rider Discovery


Displays:


- Rider name
- Vehicle type
- Distance
- Rating
- Availability


Example:


```


Available Rider


Name:
Juan Dela Cruz


Vehicle:
Motorcycle


Distance:
500 meters


Rating:
⭐4.9


[Book Ride]


```


---


# Rider Booking Process


```


Set Pickup Location
|
↓
Set Destination
|
↓
Calculate Fare
|
↓
Choose Rider
|
↓
Confirm Booking


```


---


# 8. GeoMapping Module


## Purpose


Provides interactive tourism maps.


Technology:


- Leaflet.js
- OpenStreetMap
- Geolocation API


---


# Map Features


## Marker Categories


```


🏝 Tourist Spots


🏨 Resorts


🏢 Hotels


🍜 Food Hubs


🏍 Riders


```


---


# Tourist Map Layers


Users can toggle:


- Tourist Attractions
- Accommodation
- Restaurants
- Transportation
- Events


---


# Navigation Features


The map provides:


- Current location
- Destination location
- Distance
- Estimated travel time
- Route direction


---


# 9. Booking Management Module


## Purpose


Allows tourists to manage all reservations.


---


# My Bookings Dashboard


Displays:


## Hotel Booking


```


Blue Ocean Resort


Date:
July 15-18


Status:
Confirmed


```


---


## Ride Booking


```


Motorcycle Ride


Pickup:
Tourist Location


Destination:
Resort


Status:
Completed


```


---


## Food Orders


```


Food Order


Restaurant:
Mang Juan Food Hub


Status:
Preparing


```


---


# 10. Favorite and Wishlist Module


Tourists can save:


- Tourist spots
- Resorts
- Hotels
- Restaurants
- Foods


Features:


- Add favorite
- Remove favorite
- View saved places


---


# 11. Review and Rating Module


## Purpose


Allows tourists to provide feedback.


---


# Review Categories


Tourists can review:


- Tourist spots
- Resorts
- Hotels
- Food hubs
- Riders


---


# Review Information


Includes:


- Star rating
- Comments
- Uploaded photos
- Date visited


---


# 12. Notification Module


## Purpose


Provides real-time updates.


---


# Notification Examples


```


Booking Approved


Your reservation at
Blue Ocean Resort is confirmed.


```
```


Rider Assigned


Juan is arriving soon.


```
```


Order Update


Your food order is ready.


```


---


# 13. AI Recommendation Module (Optional)


## Purpose


Provides personalized travel suggestions.


---


## Recommendation Factors


Based on:


- Previous bookings
- Favorite places
- Budget
- Location
- Interests


---


Example:


```


Recommended For You:


🏝 Beach Destinations


🍜 Local Foods


🏨 Affordable Resorts


```


---


# Database Structure


## Users


```


users
|
└── tourist_profiles


```


---


## Tourism Data


```


tourist_spots


spot_images


spot_reviews


locations
(latitude, longitude)


```


---


## Business Data


```


businesses


business_locations


resorts


hotels


food_hubs


```


---


## Booking Data


```


bookings


room_bookings


ride_bookings


food_orders


```


---


## Mapping Data


```


locations


latitude


longitude


map_markers


```


---


# Recommended Technology Stack


## Frontend


- React.js
- Next.js
- Tailwind CSS
- Leaflet.js


---


## Backend


Options:


- Laravel PHP
- Node.js Express
- Django


---


## Database


- MySQL
- PostgreSQL + PostGIS (advanced mapping)


---


## External APIs


### Mapping


- Leaflet.js
- OpenStreetMap


### Location


- Browser Geolocation API


### Payment


- GCash
- PayMongo


---


# Future Enhancements


## Digital Tourist Guide


AI-powered travel assistant.


## AR Tourism


Augmented Reality information overlays.


## Offline Tourism Mode


Offline maps and saved destinations.


## Tourist Community


Social sharing and travel posts.


---


# TrackTour Tourist Dashboard Goal


To provide a complete tourism ecosystem where visitors can:


✅ Discover destinations  
✅ View maps  
✅ Book accommodations  
✅ Order local foods  
✅ Hire transportation  
✅ Explore local businesses  
✅ Share experiences  


TrackTour connects tourists with local tourism services through a single digital platform.
