import { lazy, Suspense, useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { get } from '@/shared/services/api'
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { AppProviders } from '@/app/providers'
import ProtectedRoute from '@/shared/components/ProtectedRoute'
import DashboardLayout from '@/shared/layouts/DashboardLayout'
import TouristLayout from '@/shared/layouts/TouristLayout'
import BusinessSwitcher from '@/features/business-owner/components/BusinessSwitcher'
import { useBusinessOwnerStore } from '@/features/business-owner/services/business-owner-store'
import {
  LayoutDashboard, MapPin, Users, Building2, Tag, Map, Bike,
  UserCheck, Shield, FileBarChart, ScrollText, Bell, Settings, HardDrive,
  Lock, Navigation, Compass, UtensilsCrossed, CalendarCheck, Car,
  Calendar, Heart, Star, Clock, MessageSquare, User, ClipboardList,
  Package, BookOpen, Percent, BarChart3, Activity, ShoppingCart, UserPlus,
  CircleAlert, Megaphone, FileText, Scan, Wallet, CreditCard,
  ChefHat, CalendarDays, BedDouble, Image, Home,
  ClipboardCheck, DollarSign, UsersRound, Archive, Eye, Settings2
} from 'lucide-react'

// Auth pages (not lazy — small, needed immediately)
import LoginPage from '@/features/auth/pages/LoginPage'
import RegisterPage from '@/features/auth/pages/RegisterPage'
import RiderRegisterPage from '@/features/auth/pages/RiderRegisterPage'
import RoleSelectionPage from '@/features/auth/pages/RoleSelectionPage'

// Non-dashboard public pages
import LandingPage from '@/pages/LandingPage'
import LandingExplorePage from '@/pages/LandingExplorePage'
import LandingRestaurantPage from '@/pages/LandingRestaurantPage'
import LandingAllCategoriesPage from '@/pages/LandingAllCategoriesPage'
import LandingMunicipalityPage from '@/pages/LandingMunicipalityPage'
import UnauthorizedPage from '@/pages/UnauthorizedPage'

// Lazy-loaded feature pages
const lazy_ = (factory: () => Promise<{ default: React.ComponentType }>) => {
  const Component = lazy(factory)
  return Component
}

// --- Auth (lazy) ---
const ForgotPasswordPage = lazy_(() => import('@/features/auth/pages/ForgotPasswordPage'))
const ResetPasswordPage = lazy_(() => import('@/features/auth/pages/ResetPasswordPage'))
const VerifyEmailPage = lazy_(() => import('@/features/auth/pages/VerifyEmailPage'))
const ConfirmPasswordPage = lazy_(() => import('@/features/auth/pages/ConfirmPasswordPage'))
const PaymentCallbackPage = lazy_(() => import('@/features/tourist/pages/PaymentCallbackPage'))

// --- Admin ---
const AdminDashboard = lazy_(() => import('@/features/admin/pages/AdminDashboard'))
const AdminUsers = lazy_(() => import('@/features/admin/pages/AdminUsers'))
const AdminUsersCreate = lazy_(() => import('@/features/admin/pages/AdminUsersCreate'))
const AdminUsersEdit = lazy_(() => import('@/features/admin/pages/AdminUsersEdit'))
const AdminBusinesses = lazy_(() => import('@/features/admin/pages/AdminBusinesses'))
const AdminBusinessShow = lazy_(() => import('@/features/admin/pages/AdminBusinessShow'))
const AdminBusinessCategories = lazy_(() => import('@/features/admin/pages/AdminBusinessCategories'))
const AdminMunicipalities = lazy_(() => import('@/features/admin/pages/AdminMunicipalities'))
const AdminTourists = lazy_(() => import('@/features/admin/pages/AdminTourists'))
const AdminRoles = lazy_(() => import('@/features/admin/pages/AdminRoles'))
const AdminRiders = lazy_(() => import('@/features/admin/pages/AdminRiders'))
const AdminRiderShow = lazy_(() => import('@/features/admin/pages/AdminRiderShow'))
const AdminReports = lazy_(() => import('@/features/admin/pages/AdminReports'))
const AdminAuditLogs = lazy_(() => import('@/features/admin/pages/AdminAuditLogs'))
const AdminNotifications = lazy_(() => import('@/features/admin/pages/AdminNotifications'))
const AdminSystemConfig = lazy_(() => import('@/features/admin/pages/AdminSystemConfig'))
const AdminSystemBackup = lazy_(() => import('@/features/admin/pages/AdminSystemBackup'))
const AdminSystemSecurity = lazy_(() => import('@/features/admin/pages/AdminSystemSecurity'))
const AdminSystemOcrSettings = lazy_(() => import('@/features/admin/pages/AdminSystemOcrSettings'))
const AdminLiveMap = lazy_(() => import('@/features/admin/pages/AdminLiveMap'))
const AdminLiveDeliveries = lazy_(() => import('@/features/admin/pages/AdminLiveDeliveries'))
const AdminLiveSOS = lazy_(() => import('@/features/admin/pages/AdminLiveSOS'))
const AdminLiveTours = lazy_(() => import('@/features/admin/pages/AdminLiveTours'))

// --- Tourist ---
const TouristDashboard = lazy_(() => import('@/features/tourist/pages/TouristDashboard'))
const TouristExplore = lazy_(() => import('@/features/tourist/pages/TouristExplore'))
const TouristExploreShow = lazy_(() => import('@/features/tourist/pages/TouristExploreShow'))
const TouristExploreMap = lazy_(() => import('@/features/tourist/pages/TouristExploreMap'))
const TouristDirectory = lazy_(() => import('@/features/tourist/pages/TouristDirectory'))
const TouristMunicipality = lazy_(() => import('@/features/tourist/pages/TouristMunicipality'))
const TouristFood = lazy_(() => import('@/features/tourist/pages/TouristFood'))
const TouristFoodShow = lazy_(() => import('@/features/tourist/pages/TouristFoodShow'))
const TouristFoodCart = lazy_(() => import('@/features/tourist/pages/TouristFoodCart'))
const TouristGroupOrder = lazy_(() => import('@/features/tourist/pages/TouristGroupOrder'))
const TouristOrderStatus = lazy_(() => import('@/features/tourist/pages/TouristOrderStatus'))
const TouristOrders = lazy_(() => import('@/features/tourist/pages/TouristOrders'))
const TouristBooking = lazy_(() => import('@/features/tourist/pages/TouristBooking'))
const TouristBookingShow = lazy_(() => import('@/features/tourist/pages/TouristBookingShow'))
const TouristTransport = lazy_(() => import('@/features/tourist/pages/TouristTransport'))
const TouristTransportTracking = lazy_(() => import('@/features/tourist/pages/TouristTransportTracking'))
const TouristEvents = lazy_(() => import('@/features/tourist/pages/TouristEvents'))
const TouristEventsShow = lazy_(() => import('@/features/tourist/pages/TouristEventsShow'))
const TouristMessages = lazy_(() => import('@/features/tourist/pages/TouristMessages'))
const TouristFavorites = lazy_(() => import('@/features/tourist/pages/TouristFavorites'))
const TouristReviews = lazy_(() => import('@/features/tourist/pages/TouristReviews'))
const TouristHistory = lazy_(() => import('@/features/tourist/pages/TouristHistory'))
const TouristNotifications = lazy_(() => import('@/features/tourist/pages/TouristNotifications'))
const TouristProfile = lazy_(() => import('@/features/tourist/pages/TouristProfile'))
const TouristDestinations = lazy_(() => import('@/features/tourist/pages/TouristDestinations'))
const TouristDestinationShow = lazy_(() => import('@/features/tourist/pages/TouristDestinationShow'))
const TouristHome = lazy_(() => import('@/features/tourist/pages/TouristHome'))
const TouristSearch = lazy_(() => import('@/features/tourist/pages/TouristSearch'))
const TouristStays = lazy_(() => import('@/features/tourist/pages/TouristStays'))
const MyTrips = lazy_(() => import('@/features/tourist/pages/MyTrips'))

// --- Business Owner ---
const BusinessOwnerDashboard = lazy_(() => import('@/features/business-owner/pages/BusinessOwnerDashboard'))
const BusinessOwnerMyBusinesses = lazy_(() => import('@/features/business-owner/pages/BusinessOwnerMyBusinesses'))
const BusinessOwnerBusinessCreate = lazy_(() => import('@/features/business-owner/pages/BusinessOwnerBusinessCreate'))
const TouristAttractionRegistration = lazy_(() => import('@/features/business-owner/pages/TouristAttractionRegistration'))
const TouristAttractionEdit = lazy_(() => import('@/features/business-owner/pages/TouristAttractionEdit'))
const TouristAttractionGallery = lazy_(() => import('@/features/business-owner/pages/TouristAttractionGallery'))
const BusinessOwnerBusinessEdit = lazy_(() => import('@/features/business-owner/pages/BusinessOwnerBusinessEdit'))
const BusinessOwnerOfferings = lazy_(() => import('@/features/business-owner/pages/BusinessOwnerOfferings'))
const BusinessOwnerOfferingCreate = lazy_(() => import('@/features/business-owner/pages/BusinessOwnerOfferingCreate'))
const BusinessOwnerOfferingEdit = lazy_(() => import('@/features/business-owner/pages/BusinessOwnerOfferingEdit'))
const BusinessOwnerOfferingCategories = lazy_(() => import('@/features/business-owner/pages/BusinessOwnerOfferingCategories'))
const BusinessOwnerMenu = lazy_(() => import('@/features/business-owner/pages/BusinessOwnerMenu'))
const BusinessOwnerMenuCreate = lazy_(() => import('@/features/business-owner/pages/BusinessOwnerMenuCreate'))
const BusinessOwnerMenuEdit = lazy_(() => import('@/features/business-owner/pages/BusinessOwnerMenuEdit'))
const BusinessOwnerFoodCreate = lazy_(() => import('@/features/business-owner/pages/BusinessOwnerFoodCreate'))
const BusinessOwnerOrders = lazy_(() => import('@/features/business-owner/pages/BusinessOwnerOrders'))
const BusinessOwnerOrderShow = lazy_(() => import('@/features/business-owner/pages/BusinessOwnerOrderShow'))
const BusinessOwnerOrderDelivery = lazy_(() => import('@/features/business-owner/pages/BusinessOwnerOrderDelivery'))
const BusinessOwnerBookings = lazy_(() => import('@/features/business-owner/pages/BusinessOwnerBookings'))
const BusinessOwnerBookingShow = lazy_(() => import('@/features/business-owner/pages/BusinessOwnerBookingShow'))
const BusinessOwnerBookingCalendar = lazy_(() => import('@/features/business-owner/pages/BusinessOwnerBookingCalendar'))
const BusinessOwnerPromotions = lazy_(() => import('@/features/business-owner/pages/BusinessOwnerPromotions'))
const BusinessOwnerPromotionCreate = lazy_(() => import('@/features/business-owner/pages/BusinessOwnerPromotionCreate'))
const BusinessOwnerPromotionEdit = lazy_(() => import('@/features/business-owner/pages/BusinessOwnerPromotionEdit'))
const BusinessOwnerPromotionFeatured = lazy_(() => import('@/features/business-owner/pages/BusinessOwnerPromotionFeatured'))
const BusinessOwnerStaff = lazy_(() => import('@/features/business-owner/pages/BusinessOwnerStaff'))
const BusinessOwnerStaffCreate = lazy_(() => import('@/features/business-owner/pages/BusinessOwnerStaffCreate'))
const BusinessOwnerStaffEdit = lazy_(() => import('@/features/business-owner/pages/BusinessOwnerStaffEdit'))
const BusinessOwnerStaffShow = lazy_(() => import('@/features/business-owner/pages/BusinessOwnerStaffShow'))
const BusinessOwnerProfile = lazy_(() => import('@/features/business-owner/pages/BusinessOwnerProfile'))
const BusinessOwnerProfileEdit = lazy_(() => import('@/features/business-owner/pages/BusinessOwnerProfileEdit'))
const BusinessOwnerAccountSettings = lazy_(() => import('@/features/business-owner/pages/BusinessOwnerAccountSettings'))
const BusinessOwnerAccountStatus = lazy_(() => import('@/features/business-owner/pages/BusinessOwnerAccountStatus'))
const BusinessOwnerNotifications = lazy_(() => import('@/features/business-owner/pages/BusinessOwnerNotifications'))
const BusinessOwnerActivityLogs = lazy_(() => import('@/features/business-owner/pages/BusinessOwnerActivityLogs'))
const BusinessOwnerReports = lazy_(() => import('@/features/business-owner/pages/BusinessOwnerReports'))
const BusinessOwnerTables = lazy_(() => import('@/features/business-owner/pages/BusinessOwnerTables'))
const BusinessOwnerPOS = lazy_(() => import('@/features/business-owner/pages/BusinessOwnerPOS'))
const BusinessOwnerKitchen = lazy_(() => import('@/features/business-owner/pages/BusinessOwnerKitchen'))
const BusinessOwnerAttendance = lazy_(() => import('@/features/business-owner/pages/BusinessOwnerAttendance'))
const BusinessOwnerScheduling = lazy_(() => import('@/features/business-owner/pages/BusinessOwnerScheduling'))
const BusinessOwnerPayroll = lazy_(() => import('@/features/business-owner/pages/BusinessOwnerPayroll'))
const BusinessOwnerCustomers = lazy_(() => import('@/features/business-owner/pages/BusinessOwnerCustomers'))
const BusinessOwnerRoles = lazy_(() => import('@/features/business-owner/pages/BusinessOwnerRoles'))
const BusinessOwnerSettings = lazy_(() => import('@/features/business-owner/pages/BusinessOwnerSettings'))
const BusinessOwnerArchiveVault = lazy_(() => import('@/features/business-owner/pages/BusinessOwnerArchiveVault'))
const BusinessOwnerGallery = lazy_(() => import('@/features/business-owner/pages/BusinessOwnerGallery'))
const BusinessOwnerExpenses = lazy_(() => import('@/features/business-owner/pages/BusinessOwnerExpenses'))
const BusinessOwnerDispatch = lazy_(() => import('@/features/business-owner/pages/BusinessOwnerDispatch'))
const BusinessOwnerOperationalReports = lazy_(() => import('@/features/business-owner/pages/BusinessOwnerOperationalReports'))
// Converted business pages
const BusinessOwnerBusinessDocuments = lazy_(() => import('@/features/business-owner/pages/BusinessOwnerBusinessDocuments'))
const BusinessOwnerBusinessGallery = lazy_(() => import('@/features/business-owner/pages/BusinessOwnerBusinessGallery'))
const BusinessOwnerBusinessVerification = lazy_(() => import('@/features/business-owner/pages/BusinessOwnerBusinessVerification'))
const BusinessOwnerBusinessStep1 = lazy_(() => import('@/features/business-owner/pages/BusinessOwnerBusinessStep1'))
const BusinessOwnerBusinessStep2 = lazy_(() => import('@/features/business-owner/pages/BusinessOwnerBusinessStep2'))
const BusinessOwnerBusinessStep3 = lazy_(() => import('@/features/business-owner/pages/BusinessOwnerBusinessStep3'))
const BusinessOwnerBusinessStep4 = lazy_(() => import('@/features/business-owner/pages/BusinessOwnerBusinessStep4'))
const BusinessOwnerBusinessStep5 = lazy_(() => import('@/features/business-owner/pages/BusinessOwnerBusinessStep5'))
const BusinessOwnerBusinessStep6 = lazy_(() => import('@/features/business-owner/pages/BusinessOwnerBusinessStep6'))
const BusinessOwnerBusinessStep7 = lazy_(() => import('@/features/business-owner/pages/BusinessOwnerBusinessStep7'))
const BusinessOwnerBusinessStep8 = lazy_(() => import('@/features/business-owner/pages/BusinessOwnerBusinessStep8'))
const BusinessOwnerBusinessStep9 = lazy_(() => import('@/features/business-owner/pages/BusinessOwnerBusinessStep9'))
const BusinessOwnerBusinessStep10 = lazy_(() => import('@/features/business-owner/pages/BusinessOwnerBusinessStep10'))
const BusinessOwnerBusinessStep11 = lazy_(() => import('@/features/business-owner/pages/BusinessOwnerBusinessStep11'))

// --- Staff ---
const StaffDashboard = lazy_(() => import('@/features/staff/pages/StaffDashboard'))
const StaffOrders = lazy_(() => import('@/features/staff/pages/StaffOrders'))
const StaffBookings = lazy_(() => import('@/features/staff/pages/StaffBookings'))
const StaffFoodIndex = lazy_(() => import('@/features/staff/pages/StaffFoodIndex'))
const StaffFoodCreate = lazy_(() => import('@/features/staff/pages/StaffFoodCreate'))
const StaffMenuEdit = lazy_(() => import('@/features/staff/pages/StaffMenuEdit'))

// --- Rider ---
const RiderProfile = lazy_(() => import('@/features/rider/pages/RiderProfile'))
const RiderMessages = lazy_(() => import('@/features/rider/pages/RiderMessages'))
const RiderEarnings = lazy_(() => import('@/features/rider/pages/RiderEarnings'))
const RiderEarningShow = lazy_(() => import('@/features/rider/pages/RiderEarningShow'))
const RiderDeliveriesPending = lazy_(() => import('@/features/rider/pages/RiderDeliveriesPending'))
const RiderDeliveriesActive = lazy_(() => import('@/features/rider/pages/RiderDeliveriesActive'))
const RiderDeliveriesCompleted = lazy_(() => import('@/features/rider/pages/RiderDeliveriesCompleted'))
const RiderHistory = lazy_(() => import('@/features/rider/pages/RiderHistory'))
const RiderMap = lazy_(() => import('@/features/rider/pages/RiderMap'))
import RiderDispatchNotification from '@/features/rider/components/RiderDispatchNotification'
import GlobalRiderAlert from '@/features/rider/components/GlobalRiderAlert'
import { RiderActiveTripProvider } from '@/features/rider/context/RiderActiveTripContext'

// --- Tourism Office ---
const TourismOfficeDashboard = lazy_(() => import('@/features/tourism-office/pages/TourismOfficeDashboard'))
const TourismOfficeReports = lazy_(() => import('@/features/tourism-office/pages/TourismOfficeReports'))
const TourismOfficeBusinessOwners = lazy_(() => import('@/features/tourism-office/pages/TourismOfficeBusinessOwners'))
const TourismOfficeBusinessOwnerShow = lazy_(() => import('@/features/tourism-office/pages/TourismOfficeBusinessOwnerShow'))
const TourismOfficeDestinations = lazy_(() => import('@/features/tourism-office/pages/TourismOfficeDestinations'))
const TourismOfficeEvents = lazy_(() => import('@/features/tourism-office/pages/TourismOfficeEvents'))
const TourismOfficeAnnouncements = lazy_(() => import('@/features/tourism-office/pages/TourismOfficeAnnouncements'))
const TourismOfficeCategoryDocuments = lazy_(() => import('@/features/tourism-office/pages/TourismOfficeCategoryDocuments'))
const TourismOfficeLandingContent = lazy_(() => import('@/features/tourism-office/pages/TourismOfficeLandingContent'))

function PageLoader() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500" />
    </div>
  )
}

function SuspenseWrapper({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<PageLoader />}>{children}</Suspense>
}

// Navigation section definitions
const adminSections = [
  { items: [{ to: '/admin/dashboard', label: 'Dashboard', icon: <LayoutDashboard className="w-5 h-5" /> }] },
  { label: 'Live Operations', items: [
    { to: '/admin/live/map', label: 'Live Map', icon: <Map className="w-5 h-5" /> },
    { to: '/admin/live/deliveries', label: 'Deliveries', icon: <Package className="w-5 h-5" /> },
    { to: '/admin/live/sos', label: 'SOS Alerts', icon: <CircleAlert className="w-5 h-5" /> },
    { to: '/admin/live/tours', label: 'Live Tours', icon: <Navigation className="w-5 h-5" /> },
  ]},
  { label: 'Management', items: [
    { to: '/admin/users', label: 'Users', icon: <Users className="w-5 h-5" /> },
    { to: '/admin/businesses', label: 'Businesses', icon: <Building2 className="w-5 h-5" /> },
    { to: '/admin/business-categories', label: 'Categories', icon: <Tag className="w-5 h-5" /> },
    { to: '/admin/municipalities', label: 'Municipalities', icon: <MapPin className="w-5 h-5" /> },
    { to: '/admin/riders', label: 'Riders', icon: <Bike className="w-5 h-5" /> },
    { to: '/admin/tourists', label: 'Tourists', icon: <UserCheck className="w-5 h-5" /> },
    { to: '/admin/roles', label: 'Roles', icon: <Shield className="w-5 h-5" /> },
  ]},
  { label: 'System', items: [
    { to: '/admin/reports', label: 'Reports', icon: <FileBarChart className="w-5 h-5" /> },
    { to: '/admin/audit-logs', label: 'Audit Logs', icon: <ScrollText className="w-5 h-5" /> },
    { to: '/admin/notifications', label: 'Notifications', icon: <Bell className="w-5 h-5" /> },
    { to: '/admin/system/config', label: 'Configuration', icon: <Settings className="w-5 h-5" /> },
    { to: '/admin/system/ocr-settings', label: 'OCR Settings', icon: <Scan className="w-5 h-5" /> },
    { to: '/admin/system/backup', label: 'Backup', icon: <HardDrive className="w-5 h-5" /> },
    { to: '/admin/system/security', label: 'Security', icon: <Lock className="w-5 h-5" /> },
  ]},
]

const touristSections = [
  { items: [{ to: '/tourist/dashboard', label: 'Dashboard', icon: <LayoutDashboard className="w-5 h-5" /> }] },
  { items: [
    { to: '/tourist/explore', label: 'Explore', icon: <Compass className="w-5 h-5" /> },
    { to: '/tourist/directory', label: 'Directory', icon: <Building2 className="w-5 h-5" /> },
    { to: '/tourist/food', label: 'Food', icon: <UtensilsCrossed className="w-5 h-5" /> },
    { to: '/tourist/booking', label: 'Bookings', icon: <CalendarCheck className="w-5 h-5" /> },
    { to: '/tourist/transport', label: 'Transport', icon: <Car className="w-5 h-5" /> },
    { to: '/tourist/events', label: 'Events', icon: <Calendar className="w-5 h-5" /> },
  ]},
  { label: 'My Activity', items: [
    { to: '/tourist/favorites', label: 'Favorites', icon: <Heart className="w-5 h-5" /> },
    { to: '/tourist/reviews', label: 'Reviews', icon: <Star className="w-5 h-5" /> },
    { to: '/tourist/orders', label: 'Orders', icon: <ClipboardList className="w-5 h-5" /> },
    { to: '/tourist/history', label: 'History', icon: <Clock className="w-5 h-5" /> },
    { to: '/tourist/notifications', label: 'Notifications', icon: <Bell className="w-5 h-5" /> },
    { to: '/tourist/messages', label: 'Messages', icon: <MessageSquare className="w-5 h-5" /> },
  ]},
  { items: [{ to: '/tourist/profile', label: 'My Profile', icon: <User className="w-5 h-5" /> }] },
]

interface CategoryNavItem {
  to: string
  label: string
  icon: React.ReactNode
  module?: string | string[]
}

interface CategorySubSection {
  label?: string
  items: CategoryNavItem[]
}

// Common navigation grouped into clear functional sections
const businessOwnerCommonSections: CategorySubSection[] = [
  {
    label: 'Main',
    items: [
      { to: '/business-owner/dashboard', label: 'Dashboard', icon: <LayoutDashboard className="w-5 h-5" /> },
      { to: '/business-owner/businesses', label: 'My Businesses', icon: <Building2 className="w-5 h-5" /> },
      { to: '/business-owner/reports', label: 'Reports & Analytics', icon: <BarChart3 className="w-5 h-5" /> },
    ],
  },
  {
    label: 'Business',
    items: [
      { to: '/business-owner/profile', label: 'Business Profile', icon: <User className="w-5 h-5" /> },
      { to: '/business-owner/gallery', label: 'Business Gallery', icon: <Image className="w-5 h-5" /> },
      { to: '/business-owner/archive', label: 'Archive Vault', icon: <Archive className="w-5 h-5" /> },
    ],
  },
  {
    label: 'Operations',
    items: [
      { to: '/business-owner/orders', label: 'Orders', icon: <ShoppingCart className="w-5 h-5" />, module: 'food_ordering' },
      { to: '/business-owner/customers', label: 'Customers', icon: <UsersRound className="w-5 h-5" />, module: 'customer_management' },
      { to: '/business-owner/promotions', label: 'Promotions', icon: <Percent className="w-5 h-5" />, module: 'promotions' },
    ],
  },
  {
    label: 'Menu',
    items: [
      { to: '/business-owner/menu', label: 'Menu Items', icon: <UtensilsCrossed className="w-5 h-5" />, module: 'menu_management' },
      { to: '/business-owner/offerings/categories', label: 'Menu Categories', icon: <Tag className="w-5 h-5" />, module: 'food_categories' },
    ],
  },
  {
    label: 'Staff & Access',
    items: [
      { to: '/business-owner/staff', label: 'Staff Management', icon: <UserPlus className="w-5 h-5" />, module: 'staff_management' },
      { to: '/business-owner/roles', label: 'User Roles & Permissions', icon: <Shield className="w-5 h-5" /> },
    ],
  },
  {
    label: 'Finance',
    items: [
      { to: '/business-owner/settings?tab=payments', label: 'Payments', icon: <Wallet className="w-5 h-5" /> },
      { to: '/business-owner/expenses', label: 'Vendor & Expenses', icon: <CreditCard className="w-5 h-5" /> },
    ],
  },
  {
    label: 'Settings',
    items: [
      { to: '/business-owner/settings?tab=general', label: 'General', icon: <Settings className="w-5 h-5" /> },
      { to: '/business-owner/settings?tab=location', label: 'Location', icon: <MapPin className="w-5 h-5" /> },
      { to: '/business-owner/settings?tab=hours', label: 'Operating Hours', icon: <Clock className="w-5 h-5" /> },
      { to: '/business-owner/settings?tab=visibility', label: 'Visibility', icon: <Eye className="w-5 h-5" /> },
      { to: '/business-owner/settings?tab=documents', label: 'Documents', icon: <FileText className="w-5 h-5" /> },
    ],
  },
  {
    label: 'System',
    items: [
      { to: '/business-owner/activity-logs', label: 'Activity Logs', icon: <Activity className="w-5 h-5" /> },
      { to: '/business-owner/notifications', label: 'Notifications', icon: <Bell className="w-5 h-5" /> },
    ],
  },
]

// Routes already offered by the common navigation (dedupe business-specific sections)
const commonCategoryRoutes = new Set([
  '/business-owner/dashboard',
  '/business-owner/businesses',
  '/business-owner/reports',
  '/business-owner/profile',
  '/business-owner/gallery',
  '/business-owner/archive',
  '/business-owner/orders',
  '/business-owner/bookings',
  '/business-owner/customers',
  '/business-owner/promotions',
  '/business-owner/menu',
  '/business-owner/offerings/categories',
  '/business-owner/tables',
  '/business-owner/staff',
  '/business-owner/roles',
  '/business-owner/expenses',
  '/business-owner/settings',
  '/business-owner/activity-logs',
  '/business-owner/notifications',
])

function isCommonRoute(to: string): boolean {
  return commonCategoryRoutes.has(to.split('?')[0] ?? '')
}

// Per-category sub-sections grouped by usage (Business, Sales, Workforce, Reports)
const categorySubSections: Record<string, CategorySubSection[]> = {
  Restaurant: [
    { label: 'Business', items: [
      { to: '/business-owner/menu', label: 'Menu', icon: <BookOpen className="w-5 h-5" />, module: 'menu_management' },
      { to: '/business-owner/offerings/categories', label: 'Menu Categories', icon: <Tag className="w-5 h-5" />, module: 'food_categories' },
      { to: '/business-owner/staff', label: 'Staff', icon: <UserPlus className="w-5 h-5" />, module: 'staff_management' },
    ]},
    { label: 'Sales', items: [
      { to: '/business-owner/pos', label: 'POS & Sales', icon: <CreditCard className="w-5 h-5" />, module: 'pos_sales' },
      { to: '/business-owner/orders', label: 'Orders', icon: <ShoppingCart className="w-5 h-5" />, module: 'food_ordering' },
      { to: '/business-owner/kitchen', label: 'Kitchen Display System', icon: <ChefHat className="w-5 h-5" />, module: 'kitchen_orders' },
      { to: '/business-owner/dispatch', label: 'Dispatch Hub', icon: <Bike className="w-5 h-5" />, module: 'delivery_management' },
      { to: '/business-owner/customers', label: 'Customers', icon: <UsersRound className="w-5 h-5" />, module: 'customer_management' },
      { to: '/business-owner/promotions', label: 'Promotions', icon: <Percent className="w-5 h-5" />, module: 'promotions' },
    ]},
    { label: 'Workforce', items: [
      { to: '/business-owner/attendance', label: 'Attendance', icon: <ClipboardCheck className="w-5 h-5" />, module: 'attendance' },
      { to: '/business-owner/scheduling', label: 'Employee Scheduling', icon: <CalendarDays className="w-5 h-5" />, module: 'employee_scheduling' },
      { to: '/business-owner/payroll', label: 'Payroll', icon: <DollarSign className="w-5 h-5" />, module: 'payroll' },
    ]},
    { label: 'Reports', items: [
      { to: '/business-owner/operational-reports', label: 'Operational Reports', icon: <FileBarChart className="w-5 h-5" />, module: 'operational_reports' },
    ]},
  ],
  Hotel: [
    { label: 'Accommodation', items: [
      { to: '/business-owner/offerings', label: 'Room Management', icon: <BedDouble className="w-5 h-5" />, module: 'room_management' },
      { to: '/business-owner/offerings/categories', label: 'Room Categories', icon: <Tag className="w-5 h-5" />, module: 'room_management' },
    ]},
    { label: 'Operations', items: [
      { to: '/business-owner/bookings', label: 'Reservations', icon: <CalendarCheck className="w-5 h-5" />, module: ['table_reservations', 'reservation_management'] },
      { to: '/business-owner/bookings', label: 'Check-in / Check-out', icon: <ClipboardList className="w-5 h-5" />, module: 'check_in_out' },
    ]},
    { label: 'Sales', items: [
      { to: '/business-owner/promotions', label: 'Promotions', icon: <Percent className="w-5 h-5" />, module: 'promotions' },
    ]},
  ],
}

function itemMatchesModule(item: CategoryNavItem, moduleCodes: string[]): boolean {
  if (!item.module) return true
  const codes = Array.isArray(item.module) ? item.module : [item.module]
  return codes.some((c) => moduleCodes.includes(c))
}

function BusinessOwnerLayout() {
  const businesses = useBusinessOwnerStore((s) => s.businesses)
  const selectedBusinessId = useBusinessOwnerStore((s) => s.selectedBusinessId)
  const setBusinesses = useBusinessOwnerStore((s) => s.setBusinesses)
  const setSelectedBusinessId = useBusinessOwnerStore((s) => s.setSelectedBusinessId)

  // Fallback: if store is empty, fetch businesses and auto-select
  const { data: switcherData } = useQuery({
    queryKey: ['bo-businesses-switcher'],
    queryFn: () => get<{ businesses: { id: number; name: string; category: string; status: string; logo: string | null; module_codes?: string[] }[]; selected_business_id: number | null }>('/business-owner/businesses/switcher'),
    enabled: businesses.length === 0,
  })

  useEffect(() => {
    if (switcherData?.businesses) {
      setBusinesses(switcherData.businesses)
      if (switcherData.businesses.length === 1 && !selectedBusinessId) {
        setSelectedBusinessId(switcherData.businesses[0].id)
      }
    }
  }, [switcherData, setBusinesses, setSelectedBusinessId, selectedBusinessId])

  const filteredSections = useMemo(() => {
    const sections: { label?: string; items: CategoryNavItem[] }[] = []

    const biz = selectedBusinessId ? businesses.find((b) => b.id === selectedBusinessId) : undefined
    const moduleCodes = biz?.module_codes ?? businesses.flatMap((b) => b.module_codes ?? [])

    // 1) Common navigation grouped into functional sections (always on top)
    for (const section of businessOwnerCommonSections) {
      const items = section.items.filter((item) => itemMatchesModule(item, moduleCodes))
      if (items.length > 0) sections.push({ label: section.label, items })
    }

    // 2) Business-specific sections (per category), placed below the common nav
    const pushCategorySections = (category: string, codes: string[]) => {
      const subSections = categorySubSections[category]
      if (!subSections) return
      for (const sub of subSections) {
        const items = sub.items
          .filter((item) => !isCommonRoute(item.to))
          .filter((item) => itemMatchesModule(item, codes))
        if (items.length === 0) continue
        sections.push({ label: sub.label ? `${category} — ${sub.label}` : category, items })
      }
    }

    if (biz && biz.module_codes) {
      pushCategorySections(biz.category, biz.module_codes)
    } else {
      const seen = new Set<string>()
      for (const b of businesses) {
        if (!b.module_codes || seen.has(b.category)) continue
        seen.add(b.category)
        pushCategorySections(b.category, b.module_codes)
      }
    }

    return sections
  }, [businesses, selectedBusinessId])

  return (
    <DashboardLayout
      sections={filteredSections}
      roleLabel="Business Owner"
      theme="tourism"
      sidebarTopSlot={<BusinessSwitcher />}
    />
  )
}

const staffSections = [
  { items: [{ to: '/staff/dashboard', label: 'Dashboard', icon: <LayoutDashboard className="w-5 h-5" /> }] },
  { label: 'Operations', items: [
    { to: '/staff/orders', label: 'Orders', icon: <ClipboardList className="w-5 h-5" /> },
    { to: '/staff/bookings', label: 'Bookings', icon: <CalendarCheck className="w-5 h-5" /> },
    { to: '/staff/menu', label: 'Menu', icon: <BookOpen className="w-5 h-5" /> },
  ]},
]

const riderSections = [
  { items: [
    { to: '/rider', label: 'Home', icon: <Home className="w-5 h-5" /> },
    { to: '/rider/deliveries/pending', label: 'Available', icon: <Package className="w-5 h-5" /> },
    { to: '/rider/deliveries/active', label: 'Active', icon: <Navigation className="w-5 h-5" /> },
    { to: '/rider/deliveries/completed', label: 'Completed', icon: <Clock className="w-5 h-5" /> },
  ]},
  { items: [
    { to: '/rider/map', label: 'Live Map', icon: <Map className="w-5 h-5" /> },
  ]},
  { label: 'More', items: [
    { to: '/rider/earnings', label: 'Earnings', icon: <FileBarChart className="w-5 h-5" /> },
    { to: '/rider/messages', label: 'Messages', icon: <MessageSquare className="w-5 h-5" /> },
    { to: '/rider/profile', label: 'Profile', icon: <User className="w-5 h-5" /> },
    { to: '/rider/settings', label: 'Settings', icon: <Settings className="w-5 h-5" /> },
  ]},
]

const tourismOfficeSections = [
  { items: [{ to: '/tourism-office/dashboard', label: 'Dashboard', icon: <LayoutDashboard className="w-5 h-5" /> }] },
  { label: 'Tourism', items: [
    { to: '/tourism-office/destinations', label: 'Destinations', icon: <MapPin className="w-5 h-5" /> },
    { to: '/tourism-office/events', label: 'Events', icon: <Calendar className="w-5 h-5" /> },
    { to: '/tourism-office/announcements', label: 'Announcements', icon: <Megaphone className="w-5 h-5" /> },
  ]},
  { label: 'Management', items: [
    { to: '/tourism-office/category-documents', label: 'Category Documents', icon: <FileText className="w-5 h-5" /> },
    { to: '/tourism-office/business-owners', label: 'Business Owners', icon: <Building2 className="w-5 h-5" /> },
    { to: '/tourism-office/reports', label: 'Reports', icon: <FileBarChart className="w-5 h-5" /> },
    { to: '/tourism-office/landing-content', label: 'Landing Page', icon: <Settings2 className="w-5 h-5" /> },
  ]},
]

function AuthEventHandler() {
  const navigate = useNavigate()

  useEffect(() => {
    const handleLogout = () => {
      navigate('/login', { replace: true })
    }
    const handleRedirect = (e: Event) => {
      const path = (e as CustomEvent).detail
      if (path) navigate(path, { replace: true })
    }

    window.addEventListener('auth:logout', handleLogout)
    window.addEventListener('auth:redirect', handleRedirect)
    return () => {
      window.removeEventListener('auth:logout', handleLogout)
      window.removeEventListener('auth:redirect', handleRedirect)
    }
  }, [navigate])

  return null
}

function SessionTimeoutHandler() {
  const { showWarning, countdown, resetTimer, handleLogout } = useSessionTimeout()

  return (
    <SessionTimeoutModal
      show={showWarning}
      countdown={countdown}
      onStayLoggedIn={resetTimer}
      onLogout={handleLogout}
    />
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AppProviders>
        <AuthEventHandler />
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/explore" element={<LandingExplorePage />} />
          <Route path="/explore/food/:id" element={<LandingRestaurantPage />} />
          <Route path="/explore/categories" element={<LandingAllCategoriesPage />} />
          <Route path="/explore/municipality/:id" element={<LandingMunicipalityPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/register/rider" element={<RiderRegisterPage />} />
          <Route path="/role-selection" element={<RoleSelectionPage />} />
          <Route path="/unauthorized" element={<UnauthorizedPage />} />
          <Route path="/forgot-password" element={<SuspenseWrapper><ForgotPasswordPage /></SuspenseWrapper>} />
          <Route path="/reset-password" element={<SuspenseWrapper><ResetPasswordPage /></SuspenseWrapper>} />
          <Route path="/verify-email" element={<SuspenseWrapper><VerifyEmailPage /></SuspenseWrapper>} />
          <Route path="/confirm-password" element={<SuspenseWrapper><ConfirmPasswordPage /></SuspenseWrapper>} />
          <Route path="/payment/callback" element={<SuspenseWrapper><PaymentCallbackPage /></SuspenseWrapper>} />

          {/* Admin */}
          <Route
            path="/admin"
            element={
              <ProtectedRoute roles={['bansud_tourism_office']}>
                <DashboardLayout sections={adminSections} roleLabel="Admin" theme="admin" />
              </ProtectedRoute>
            }
          >
            <Route path="dashboard" element={<AdminDashboard />} />
            <Route path="users" element={<AdminUsers />} />
            <Route path="users/create" element={<AdminUsersCreate />} />
            <Route path="users/:id/edit" element={<AdminUsersEdit />} />
            <Route path="businesses" element={<AdminBusinesses />} />
            <Route path="businesses/:id" element={<AdminBusinessShow />} />
            <Route path="business-categories" element={<AdminBusinessCategories />} />
            <Route path="municipalities" element={<AdminMunicipalities />} />
            <Route path="tourists" element={<AdminTourists />} />
            <Route path="roles" element={<AdminRoles />} />
            <Route path="riders" element={<AdminRiders />} />
            <Route path="riders/:id" element={<AdminRiderShow />} />
            <Route path="reports" element={<AdminReports />} />
            <Route path="audit-logs" element={<AdminAuditLogs />} />
            <Route path="notifications" element={<AdminNotifications />} />
            <Route path="system/config" element={<AdminSystemConfig />} />
            <Route path="system/backup" element={<AdminSystemBackup />} />
            <Route path="system/security" element={<AdminSystemSecurity />} />
            <Route path="system/ocr-settings" element={<AdminSystemOcrSettings />} />
            <Route path="live/map" element={<AdminLiveMap />} />
            <Route path="live/deliveries" element={<AdminLiveDeliveries />} />
            <Route path="live/sos" element={<AdminLiveSOS />} />
            <Route path="live/tours" element={<AdminLiveTours />} />
          </Route>

          {/* Tourist */}
          <Route path="/tourist" element={<TouristLayout />}>
            {/* Account / action routes (require tourist login) */}
            <Route element={<ProtectedRoute roles={['tourist']} />}>
              <Route path="dashboard" element={<TouristHome />} />
              <Route path="food/cart" element={<TouristFoodCart />} />
              <Route path="food/group-order/:id" element={<TouristGroupOrder />} />
              <Route path="food/order/:id/status" element={<TouristOrderStatus />} />
              <Route path="orders/:id/progress" element={<TouristOrderStatus />} />
              <Route path="stays/:id" element={<TouristBookingShow />} />
              <Route path="trips" element={<MyTrips />} />
              <Route path="transport" element={<TouristTransport />} />
              <Route path="transport/tracking/:id" element={<TouristTransportTracking />} />
              <Route path="booking" element={<TouristBooking />} />
              <Route path="booking/:id" element={<TouristBookingShow />} />
              <Route path="favorites" element={<TouristFavorites />} />
              <Route path="reviews" element={<TouristReviews />} />
              <Route path="orders" element={<TouristOrders />} />
              <Route path="history" element={<TouristHistory />} />
              <Route path="notifications" element={<TouristNotifications />} />
              <Route path="messages" element={<TouristMessages />} />
              <Route path="profile" element={<TouristProfile />} />
              <Route path="food" element={<TouristFood />} />
              <Route path="food/:id" element={<TouristFoodShow />} />
              <Route path="municipality/:id" element={<TouristMunicipality />} />
              <Route path="destinations" element={<TouristDestinations />} />
              <Route path="destinations/:id" element={<TouristDestinationShow />} />
            </Route>

            {/* Public browse */}
            <Route path="search" element={<TouristSearch />} />
            <Route path="explore" element={<TouristExplore />} />
            <Route path="explore/:id" element={<TouristExploreShow />} />
            <Route path="explore/map" element={<TouristExploreMap />} />
            <Route path="stays" element={<TouristStays />} />
            <Route path="directory" element={<TouristDirectory />} />
            <Route path="events" element={<TouristEvents />} />
            <Route path="events/:id" element={<TouristEventsShow />} />
          </Route>

          {/* Business Owner */}
          <Route
            path="/business-owner"
            element={
              <ProtectedRoute roles={['business_owner']}>
                <BusinessOwnerLayout />
              </ProtectedRoute>
            }
          >
            <Route path="dashboard" element={<BusinessOwnerDashboard />} />
            <Route path="businesses" element={<BusinessOwnerMyBusinesses />} />
            <Route path="businesses/create" element={<BusinessOwnerBusinessCreate />} />
            <Route path="businesses/create/tourist-attraction" element={<TouristAttractionRegistration />} />
            <Route path="businesses/create/steps/1" element={<BusinessOwnerBusinessStep1 />} />
            <Route path="businesses/create/steps/2" element={<BusinessOwnerBusinessStep2 />} />
            <Route path="businesses/create/steps/3" element={<BusinessOwnerBusinessStep3 />} />
            <Route path="businesses/create/steps/4" element={<BusinessOwnerBusinessStep4 />} />
            <Route path="businesses/create/steps/5" element={<BusinessOwnerBusinessStep5 />} />
            <Route path="businesses/create/steps/6" element={<BusinessOwnerBusinessStep6 />} />
            <Route path="businesses/create/steps/7" element={<BusinessOwnerBusinessStep7 />} />
            <Route path="businesses/create/steps/8" element={<BusinessOwnerBusinessStep8 />} />
            <Route path="businesses/create/steps/9" element={<BusinessOwnerBusinessStep9 />} />
            <Route path="businesses/create/steps/10" element={<BusinessOwnerBusinessStep10 />} />
            <Route path="businesses/create/steps/11" element={<BusinessOwnerBusinessStep11 />} />
            <Route path="businesses/:id/edit" element={<BusinessOwnerBusinessEdit />} />
            <Route path="businesses/:id/tourist-attraction-edit" element={<TouristAttractionEdit />} />
            <Route path="businesses/:id/documents" element={<BusinessOwnerBusinessDocuments />} />
            <Route path="businesses/:id/gallery" element={<BusinessOwnerBusinessGallery />} />
            <Route path="businesses/:id/tourist-attraction-gallery" element={<TouristAttractionGallery />} />
            <Route path="businesses/:id/restaurant-profile" element={<Navigate to="./gallery" replace />} />
            <Route path="businesses/:id/verification" element={<BusinessOwnerBusinessVerification />} />
            <Route path="offerings" element={<BusinessOwnerOfferings />} />
            <Route path="offerings/create" element={<BusinessOwnerOfferingCreate />} />
            <Route path="offerings/:id/edit" element={<BusinessOwnerOfferingEdit />} />
            <Route path="offerings/categories" element={<BusinessOwnerOfferingCategories />} />
            <Route path="menu" element={<BusinessOwnerMenu />} />
            <Route path="menu/create" element={<BusinessOwnerMenuCreate />} />
            <Route path="menu/:id/edit" element={<BusinessOwnerMenuEdit />} />
            <Route path="food/create" element={<BusinessOwnerFoodCreate />} />
            <Route path="orders" element={<BusinessOwnerOrders />} />
            <Route path="orders/:id" element={<BusinessOwnerOrderShow />} />
            <Route path="orders/deliveries" element={<BusinessOwnerOrderDelivery />} />
            <Route path="bookings" element={<BusinessOwnerBookings />} />
            <Route path="bookings/:id" element={<BusinessOwnerBookingShow />} />
            <Route path="bookings/calendar" element={<BusinessOwnerBookingCalendar />} />
            <Route path="promotions" element={<BusinessOwnerPromotions />} />
            <Route path="promotions/create" element={<BusinessOwnerPromotionCreate />} />
            <Route path="promotions/:id/edit" element={<BusinessOwnerPromotionEdit />} />
            <Route path="promotions/featured" element={<BusinessOwnerPromotionFeatured />} />
            <Route path="staff" element={<BusinessOwnerStaff />} />
            <Route path="staff/create" element={<BusinessOwnerStaffCreate />} />
            <Route path="staff/:id" element={<BusinessOwnerStaffShow />} />
            <Route path="staff/:id/edit" element={<BusinessOwnerStaffEdit />} />
            <Route path="profile" element={<BusinessOwnerProfile />} />
            <Route path="profile/edit" element={<BusinessOwnerProfileEdit />} />
            <Route path="account-settings" element={<BusinessOwnerAccountSettings />} />
            <Route path="account-status" element={<BusinessOwnerAccountStatus />} />
            <Route path="notifications" element={<BusinessOwnerNotifications />} />
            <Route path="activity-logs" element={<BusinessOwnerActivityLogs />} />
            <Route path="gallery" element={<BusinessOwnerGallery />} />
            <Route path="reports" element={<BusinessOwnerReports />} />
            <Route path="tables" element={<BusinessOwnerTables />} />
            <Route path="pos" element={<BusinessOwnerPOS />} />
            <Route path="kitchen" element={<BusinessOwnerKitchen />} />
            <Route path="attendance" element={<BusinessOwnerAttendance />} />
            <Route path="scheduling" element={<BusinessOwnerScheduling />} />
            <Route path="payroll" element={<BusinessOwnerPayroll />} />
            <Route path="customers" element={<BusinessOwnerCustomers />} />
            <Route path="roles" element={<BusinessOwnerRoles />} />
            <Route path="expenses" element={<BusinessOwnerExpenses />} />
            <Route path="dispatch" element={<BusinessOwnerDispatch />} />
            <Route path="settings" element={<BusinessOwnerSettings />} />
            <Route path="archive" element={<BusinessOwnerArchiveVault />} />
            <Route path="operational-reports" element={<BusinessOwnerOperationalReports />} />
          </Route>

          {/* Staff */}
          <Route
            path="/staff"
            element={
              <ProtectedRoute roles={['staff']}>
                <DashboardLayout sections={staffSections} roleLabel="Staff" />
              </ProtectedRoute>
            }
          >
            <Route path="dashboard" element={<StaffDashboard />} />
            <Route path="orders" element={<StaffOrders />} />
            <Route path="bookings" element={<StaffBookings />} />
            <Route path="menu" element={<StaffFoodIndex />} />
            <Route path="menu/create" element={<StaffFoodCreate />} />
            <Route path="menu/:id/edit" element={<StaffMenuEdit />} />
          </Route>

          {/* Rider */}
          <Route
            path="/rider"
            element={
              <ProtectedRoute roles={['rider']}>
                <RiderActiveTripProvider>
                  <RiderDispatchNotification />
                  <DashboardLayout sections={riderSections} roleLabel="Rider" theme="tourism" profilePath="/rider/profile" bottomNavigation />
                  <GlobalRiderAlert />
                </RiderActiveTripProvider>
              </ProtectedRoute>
            }
          >
            <Route index element={<Navigate to="/rider/map" replace />} />
            <Route path="earnings" element={<RiderEarnings />} />
            <Route path="earnings/:deliveryId" element={<RiderEarningShow />} />
            <Route path="profile" element={<RiderProfile />} />
            <Route path="settings" element={<RiderProfile />} />
            <Route path="history" element={<RiderHistory />} />
            <Route path="messages" element={<RiderMessages />} />
            <Route path="map" element={<RiderMap />} />
            <Route path="deliveries/pending" element={<RiderDeliveriesPending />} />
            <Route path="deliveries/active" element={<RiderDeliveriesActive />} />
            <Route path="deliveries/completed" element={<RiderDeliveriesCompleted />} />
          </Route>

          {/* Tourism Office */}
          <Route
            path="/tourism-office"
            element={
              <ProtectedRoute roles={['tourism_office', 'bansud_tourism_office']}>
                <DashboardLayout sections={tourismOfficeSections} roleLabel="Tourism Office" />
              </ProtectedRoute>
            }
          >
            <Route path="dashboard" element={<TourismOfficeDashboard />} />
            <Route path="destinations" element={<TourismOfficeDestinations />} />
            <Route path="events" element={<TourismOfficeEvents />} />
            <Route path="announcements" element={<TourismOfficeAnnouncements />} />
            <Route path="category-documents" element={<TourismOfficeCategoryDocuments />} />
            <Route path="business-owners" element={<TourismOfficeBusinessOwners />} />
            <Route path="business-owners/:id" element={<TourismOfficeBusinessOwnerShow />} />
            <Route path="reports" element={<TourismOfficeReports />} />
            <Route path="landing-content" element={<TourismOfficeLandingContent />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppProviders>
    </BrowserRouter>
  )
}
