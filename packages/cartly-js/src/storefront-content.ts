import type {
  StorefrontHeroLayout,
  StorefrontHomePageInput,
  StorefrontHomePageQuery,
  StorefrontHomeSectionKind,
  StorefrontSectionLayout,
  StorefrontPageQuery,
  StorefrontProfileQuery,
  StorefrontBookableQuery,
  StorefrontRecordTypesQuery,
  StorefrontReviewsQuery,
  BookableAvailabilityQuery,
  MyBookingQuery,
} from "./gql/graphql"

/*
 * Named shapes of the storefront content API (generated from the
 * operations in operations/storefront.ts), for components that render
 * them. See docs/STOREFRONT_API.md.
 */

export type StorefrontProfile = StorefrontProfileQuery["storefrontProfile"]
export type StorefrontHomePage = StorefrontHomePageQuery["storefrontHomePage"]
export type StorefrontHero = NonNullable<StorefrontHomePage["hero"]>
export type StorefrontHomeSection = StorefrontHomePage["sections"][number]
export type StorefrontHeroSlide = StorefrontHero["slides"][number]
export type StorefrontImage = StorefrontHero["images"][number]
export type StorefrontLink = NonNullable<StorefrontHero["primaryAction"]>
export type StorefrontStat = StorefrontHomePage["stats"][number]
export type StorefrontReview =
  StorefrontReviewsQuery["storefrontReviews"]["items"][number]
export type StorefrontRatingSummary =
  StorefrontReviewsQuery["storefrontRatingSummary"]
export type StorefrontContentPage = StorefrontPageQuery["storefrontPage"]
export type StorefrontRecordType =
  StorefrontRecordTypesQuery["storefrontRecordTypes"][number]
export type StorefrontRecordField = StorefrontRecordType["fields"][number]
export type StorefrontBookable = StorefrontBookableQuery["storefrontBookable"]
export type BookableAvailability =
  BookableAvailabilityQuery["bookableAvailability"]
export type ShopperBooking = MyBookingQuery["myBooking"]
export type {
  StorefrontHeroLayout,
  StorefrontHomePageInput,
  StorefrontHomeSectionKind,
  StorefrontSectionLayout,
}

/**
 * The section kinds the API knows today, in the order an editor offers
 * them. Stores must skip a kind they don't render (the API may add more).
 */
export const HOME_SECTION_KINDS = [
  "COLLECTIONS",
  "FEATURED_PRODUCTS",
  "FEATURED_LISTINGS",
  "RECORDS",
  "BOOKABLES",
  "FEATURE_PANEL",
  "RICH_TEXT",
  "GALLERY",
  "STATS",
  "REVIEWS",
  "CALL_TO_ACTION",
  "CONTACT",
] as const satisfies readonly StorefrontHomeSectionKind[]
export type KnownHomeSectionKind = (typeof HOME_SECTION_KINDS)[number]

/** Kinds that show a number of items (`itemLimit`, 1–24). */
export const LIMITED_SECTION_KINDS: readonly KnownHomeSectionKind[] = [
  "COLLECTIONS",
  "FEATURED_PRODUCTS",
  "FEATURED_LISTINGS",
  "RECORDS",
  "BOOKABLES",
  "REVIEWS",
]

/** The hero layouts the API knows, in the order an editor offers them. */
export const HERO_LAYOUTS = [
  "IMAGE",
  "CAROUSEL",
  "SPLIT",
  "TEXT",
] as const satisfies readonly StorefrontHeroLayout[]

/** The layouts each section kind may use; kinds not listed have one form. */
export const LAYOUTS_BY_KIND: Partial<
  Record<KnownHomeSectionKind, readonly StorefrontSectionLayout[]>
> = {
  COLLECTIONS: ["GRID", "CAROUSEL"],
  FEATURED_PRODUCTS: ["GRID", "CAROUSEL"],
  FEATURED_LISTINGS: ["GRID", "CAROUSEL"],
  RECORDS: ["GRID", "CAROUSEL"],
  BOOKABLES: ["GRID", "CAROUSEL"],
  GALLERY: ["GRID", "CAROUSEL"],
  REVIEWS: ["GRID", "CAROUSEL"],
  FEATURE_PANEL: ["SPLIT", "BANNER"],
  CALL_TO_ACTION: ["SPLIT", "BANNER"],
}

/** The API's limits for `updateHomePage` (it refuses anything longer). */
export const HOME_PAGE_LIMITS = {
  announcement: 160,
  headline: 120,
  subheading: 280,
  label: 60,
  title: 120,
  body: 1000,
  alt: 200,
  stats: 6,
  heroImages: 5,
  heroSlides: 6,
  sectionImages: 12,
  sections: 20,
  itemLimit: 24,
} as const
