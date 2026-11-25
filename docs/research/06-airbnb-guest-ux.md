# Airbnb guest UI/UX as of 25 Nov 2026: measured anatomy for the Amina Stays guest site

These values were measured on live airbnb.com on 25 Nov 2026, in Chrome at 1440×900 and 390×844, using computed styles from DevTools and screenshots. They are the reference the Amina Stays redesign was built against. Brand assets were not copied: no Rausch colour, Bélo logo or Cereal font. Amina keeps its own name, sail-and-wave mark and coral; only the patterns, scale, spacing and interactions follow Airbnb.

## 1. Global tokens

| Token | Airbnb (measured) | Amina Stays |
|---|---|---|
| Body type | Airbnb Cereal VF, 14px/20px, `#222` | Figtree (closest open-licence match), same sizes |
| Secondary text | `#6A6A6A` (`#6C6C6C` on cards) | `--color-ink-2: #6a6a6a` |
| Hairlines | `#DDDDDD`, `#EBEBEB` | `line`, `line-soft` |
| Surfaces | `#F7F7F7`; flat chips and round buttons `#F2F2F2` | `surface`, `chip` |
| Weights | 400 / 500 / 600 (UI never heavier) | `font-bold` is mapped to 600 |
| Primary CTA | 48px pill, `linear-gradient(to right, #E61E4D, #E31C5F, #D70466)`, radial highlight that follows the cursor, 16px/500 | Same mechanics in coral (`.btn-gradient`) |
| Secondary button | `#F2F2F2`, 8px radius, 16px/500 ("Show all photos", "Message host", "Show all reviews") | `variant="soft"` |
| Search bar shadow | `0 0 0 1px rgb(0 0 0/.02), 0 8px 24px rgb(0 0 0/.1)` | `shadow-search` |
| Badge shadow ("Guest favourite") | `0 0 0 1px rgb(0 0 0/.02), 0 2px 6px rgb(0 0 0/.04), 0 4px 8px rgb(0 0 0/.1)` | `shadow-badge` |
| Popovers / booking card | `0 2px 16px rgb(0 0 0/.12)` / `0 6px 16px rgb(0 0 0/.12)` | `shadow-pop` / `shadow-card` |
| Photo radius | 20px (home and search cards) | `rounded-card` |

## 2. Header and search

**Header (home, desktop).**
- Logo on the left.
- Centred tabs (All · Homes · Hotels · Experiences · Services): a ~36–44px 3D icon plus a 14px/500 label, with an underline under the active tab.
- On the right: "Become a host" (14px/500), then two 40px `#F2F2F2` circles (profile, menu).

**Hero band and search pill.**
- The hero band is `linear-gradient(white 39.9%, #F8F8F8)` with a hairline divider.
- The search pill is 850×66, radius 100px, 1px `#DDD` border.
- Its fields are Where ("Search destinations"), When ("Add dates") and Who ("Add guests"). Labels are 12px/500 and values 14px. The search button is a 48px circle.

**On scroll and on inner pages.**
- The header collapses to a compact pill: a 3D house, then "Anywhere | Anytime | Add guests", then a small search circle. The tabs are hidden.
- Clicking any part of the pill expands the full search over the page and dims everything below.

**Expanded state.**
- The bar turns `#EBEBEB`, the active field becomes a raised white pill, and the search circle grows into a "Search" pill.
- **Where panel:** 32px radius; "Suggested destinations"; rows with 56px tinted rounded-square tiles.
- **When panel:** two months with round day cells and chips under the calendar.
- **Who panel:** Adults (13+), Children (2–12), Infants (under 2), with 32px round steppers.

**Mobile (390px).**
- A "Start your search" shadowed pill, then tab chips with 3D icons.
- Search opens full screen with stacked step cards (Where? / When / Who) and a "Clear all" / "Search" footer.
- Bottom bar: Explore (active in brand colour), Wishlists, Log in; Trips and Messages appear when logged in.

→ Built in `site/header.tsx` and `site/search-bar.tsx` (desktop bar, compact pill, mobile full-screen search, bottom tab bar that hides on scroll).

## 3. Home feed

- Rows are titled 20px/600 with −0.18px tracking. Titles that link carry a "→" in a 28–32px `#F2F2F2` circle. Previous/next arrows sit top-right as 28px `#F2F2F2` circles.
- **"Destinations for you"** tiles: ~106×100 image with 16–20px radius, title 13px/500, subtitle 12px `#6C6C6C`.
- **"Popular homes in X"** cards: 185×175 image (about 20:19) with 20px radius.
  - A "Guest favorite" pill: white at 80–90%, 14px radius, 11–12px/600.
  - A heart top-right.
  - Title 13px/500 ("Home in Konohana-ku"), then a 12px grey line ("¥88,097 for 2 nights · ★ 5.0").
- A floating "Prices include all fees" chip with a 3D tag sits at the bottom centre.

→ `site/home-view.tsx` and `site/carousel.tsx`. Rows: Destinations, Popular homes, Available this weekend (real availability and totals for the coming Friday→Sunday), and "Make your stay special" (experiences and services). Then the USSD / SMS / voice "Book without data" module and "Why book direct".

## 4. Search results (`/s/…`)

- Compact header pill showing the current search, then a filter row: a "Filters" button with a sliders icon, a divider, and chips (34px, 12px, 1px `#DDD`, 24px radius).
- Heading "Over 1,000 homes in Mombasa" (20px/600) with "Prices include all fees" on the right.
- Two-column results beside a sticky map (≈40% width, 20px radius) with white price-pill markers. Hovering a card turns its marker black. Expand and zoom controls.
- **Result card:**
  - Image about 4:3 with 20px radius; pager dots where the active one stretches into a pill.
  - "Room in Mombasa" (15px/500) with "★ 5.0 (36)" on the right.
  - Grey lines for name, beds and dates.
  - Total price underlined plus "for 5 nights".
  - "Free cancellation" tag (11px/500 on `#F2F2F2`).
- **Filters modal:** "Recommended for you" 3D cards, price histogram with a dual slider and min/max boxes, rooms and beds steppers, amenity chips, property-type cards, and a footer with "Clear all" plus "Show N places".

→ `site/search-view.tsx` and `site/maps.tsx`. The backend gained `type` and `free_cancellation` filters, and the card gained a `free_cancellation` flag.

## 5. Listing page

- Content is 1120px wide. Title 26px with underlined Share and Save.
- Photo grid of 1 large + 4 small with 8px gaps and rounded outer corners. "Show all photos" opens a **photo tour** grouped by room.
- Overview: "Entire condo in Mombasa, Kenya" (22px/500) and "2 guests · 1 bedroom · 2 beds · 1 bath".
- **Guest-favourite box:** laurels, "One of the most loved homes…", rating with stars, a divider, then the review count.
- Host row, then three highlights with line icons, then the description clamped with a grey "Show more".
- Cards for "Where you'll sleep".
- "What this place offers": two columns; missing essentials struck through; grey "Show all N amenities".
- Inline two-month calendar with "Clear dates".
- **Booking card:**
  - "Add dates for prices" (22px/500), or the underlined total "for N nights".
  - A CHECK-IN / CHECKOUT / GUESTS box with 10px/700 uppercase labels.
  - Pill CTA "Check availability" / "Reserve", then "You won't be charged yet", fee lines and the total.
  - A "rare find" card above it when the home is usually booked.
- A **sticky section nav** (Photos · Amenities · Reviews · Location) appears after the photos, with price and CTA on the right once past the booking card.
- **Reviews:**
  - A large rating between laurels, then "Guest favorite".
  - An overall-rating histogram and six category columns with icons and vertical dividers.
  - "Guests mention" chips with 3D icons and counts.
  - Two-column review cards (48px avatar, name and location, stars · date, 3-line clamp).
  - A grey "Show all N reviews" button.
- **"Where you'll be":** a rounded map and "Exact location provided after booking".
- **"Meet your host":** a shadowed card (avatar, badge, name, Superhost, Reviews / Rating / Years) beside host details, a grey "Message host" button and a payment-protection note.
- **"Things to know":** three columns with icons (cancellation, house rules, safety & property), each with "Show more".
- **Mobile:** a full-bleed carousel with back / share / save; the content sheet overlaps the photo with 24px rounded corners and a centred title; a bottom bar shows price or "Add dates" plus the CTA.

→ `site/listing-view.tsx`. Our additions: photo extras ("Make it yours"), the USSD booking note, the TRA licence line, and keyword "Guests mention" counts across English, Kiswahili, Italian, German and French reviews.

## 6. Checkout ("Confirm and pay", 2025 redesign)

- Logo-only header and a back arrow plus 32px title.
- Numbered step cards on the left:
  1. Log in or sign up
  2. Choose when to pay
  3. Add a payment method
  4. Review
- The active step is open; completed steps collapse to a one-line summary and a "Change" button; future steps are greyed.
- A sticky summary card on the right: photo, title, rating, cancellation terms, Dates and Guests rows each with a "Change" button, price details and the total.

→ `site/checkout-view.tsx`. Our steps: Log in → When to pay (full or 30% deposit) → Make it yours (extras) → Guest details (Kenyan guest register with consent, arrival) → Pay and confirm (M-Pesa or card).

## 7. Account and trips

- Trips: a 32px "Trips" title, upcoming trip cards and a "Where you've been" list with thumbnails.
- Account: a 32px "Account" title, name and contact line, then a grid of shadowed cards (icon, title, description) linking to each settings area.

→ `site/trips-view.tsx` and `site/account-view.tsx`.

## 8. Icons and imagery

Airbnb's 3D icon set is proprietary. We use Microsoft Fluent Emoji 3D (MIT), 55 icons downscaled to 128px in `frontend/public/3d`, wherever Airbnb uses 3D art:
- tabs and search suggestions;
- filters and "Guests mention";
- "Things to know";
- the account and hosting menus.

Laurels are drawn in SVG. Experience and service photos come from Unsplash, stored on each add-on (`Addon.photo_url`).
