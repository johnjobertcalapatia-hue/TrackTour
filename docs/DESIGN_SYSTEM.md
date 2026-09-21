# Design System: Tourism Management Portal

This document defines the core visual language for the application. All new features should adhere to these specifications to ensure a consistent experience.

## 1. Color Palette (The "Emerald & Amber" Theme)

This palette is designed to evoke trust (Emerald) and warmth/hospitality (Amber).

| Usage | Role | Tailwind Class | Hex Code |
| --- | --- | --- | --- |
| **Primary** | Actions, Success, Live Status | `emerald-600` | `#059669` |
| **Secondary** | Pending, Attention, Warnings | `amber-500` | `#F59E0B` |
| **Surface** | Card Backgrounds | `white` | `#FFFFFF` |
| **Background** | Page Base | `gray-50` | `#F9FAFB` |
| **Typography** | Body Text | `gray-800` | `#1F2937` |

## 2. Component Guidelines

### Card Style (`.app-card`)

Every widget on the dashboard must share the same structural integrity:

* **Background:** `bg-white`
* **Border:** `border border-gray-200`
* **Radius:** `rounded-2xl`
* **Shadow:** `shadow-sm`

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
