/* eslint-disable */
/** Internal type. DO NOT USE DIRECTLY. */
type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
/** Internal type. DO NOT USE DIRECTLY. */
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
import type { DocumentTypeDecoration } from '@graphql-typed-document-node/core';
export type AddressInput = {
  city: string;
  countryCode: string;
  line1: string;
  line2?: string | null | undefined;
  phone?: string | null | undefined;
  postalCode?: string | null | undefined;
  recipientName: string;
  stateRegion?: string | null | undefined;
};

export type BankTransferProofInput = {
  note?: string | null | undefined;
  /** The reference or narration the shopper’s bank shows. */
  reference: string;
};

export type BookingConfirmation =
  /** Confirmed when booked (or paid). */
  | 'AUTOMATIC'
  /** The business confirms each booking. */
  | 'MANUAL'
  | '%future added value';

export type BookingPayment =
  /** Paid when booking (online or bank transfer) at the linked variant’s price. */
  | 'FULL'
  /** Settled with the business directly. */
  | 'NONE'
  | '%future added value';

/** NIGHT: checkIn and checkOut. SLOT: startsAt (from availability). EVENT: neither. */
export type BookingRequestInput = {
  /** The bookable’s slug. */
  bookable: string;
  /** YYYY-MM-DD. */
  checkIn?: string | null | undefined;
  /** YYYY-MM-DD. */
  checkOut?: string | null | undefined;
  /** Paid bookings: a store coupon. */
  couponCode?: string | null | undefined;
  /** Weekly repeats, the first included (default 1; at most the bookable’s maxOccurrences). */
  occurrences?: number | null | undefined;
  /** Seats, guests or units (default 1). */
  quantity?: number | null | undefined;
  /** ISO 8601 with offset. */
  startsAt?: string | null | undefined;
};

export type BookingStatus =
  | 'CANCELLED'
  | 'COMPLETED'
  | 'CONFIRMED'
  /** Not paid before the hold ended. */
  | 'EXPIRED'
  /** Waiting for payment or for the business; holds the place. */
  | 'PENDING'
  | '%future added value';

export type BookingUnit =
  /** One fixed date and time (a course cohort, a workshop); booked by the seat. */
  | 'EVENT'
  /** Nights between check-in and check-out dates (short lets, rooms). */
  | 'NIGHT'
  /** Fixed-length slots inside weekly opening hours (appointments, classes). */
  | 'SLOT'
  | '%future added value';

export type BusinessVertical =
  | 'ECOMMERCE'
  | 'REAL_ESTATE'
  | '%future added value';

export type CheckoutAttributionInput = {
  /** utm_campaign. */
  campaign?: string | null | undefined;
  /** utm_medium. */
  medium?: string | null | undefined;
  /** The referring page when there was no utm_source. */
  referrer?: string | null | undefined;
  /** utm_source of the landing link. */
  source?: string | null | undefined;
};

export type CheckoutInput = {
  /** The shopper ticked an unticked-by-default “Send me news and offers” box. Records consent (never removes it). */
  acceptsMarketing?: boolean | null | undefined;
  /** Where the shopper came from (the shared storefront package keeps it in a first-party cookie). Used for the business’s sales-by-source report only. */
  attribution?: CheckoutAttributionInput | null | undefined;
  couponCode?: string | null | undefined;
  email: string;
  firstName?: string | null | undefined;
  lastName?: string | null | undefined;
  note?: string | null | undefined;
  /** Defaults to ONLINE. */
  paymentMethod?: CheckoutPaymentMethod | null | undefined;
  phone?: string | null | undefined;
  shippingAddress: AddressInput;
  /** Required when the cart has products; properties aren’t shipped. */
  shippingMethodId?: string | number | null | undefined;
};

/** ONLINE: card/bank payment (Cartly Gateway or the store’s own Paystack). BANK_TRANSFER: the shopper transfers to the store’s bank account and staff confirm it. CASH_ON_DELIVERY: paid in cash on delivery; staff record the collection. */
export type CheckoutPaymentMethod =
  | 'BANK_TRANSFER'
  | 'CASH_ON_DELIVERY'
  | 'ONLINE'
  | '%future added value';

export type ConversationStatus =
  | 'CLOSED'
  | 'OPEN'
  | '%future added value';

export type CreateBookingInput = {
  /** The bookable’s slug. */
  bookable: string;
  /** YYYY-MM-DD. */
  checkIn?: string | null | undefined;
  /** YYYY-MM-DD. */
  checkOut?: string | null | undefined;
  /** Paid bookings: a store coupon. */
  couponCode?: string | null | undefined;
  email: string;
  guestName: string;
  notes?: string | null | undefined;
  /** Weekly repeats, the first included (default 1; at most the bookable’s maxOccurrences). */
  occurrences?: number | null | undefined;
  /** Paid bookings: ONLINE (default) or BANK_TRANSFER. */
  paymentMethod?: string | null | undefined;
  phone?: string | null | undefined;
  /** Seats, guests or units (default 1). */
  quantity?: number | null | undefined;
  /** ISO 8601 with offset. */
  startsAt?: string | null | undefined;
};

export type CustomerAddressInput = {
  city: string;
  countryCode: string;
  isDefaultBilling?: boolean | null | undefined;
  isDefaultShipping?: boolean | null | undefined;
  label?: string | null | undefined;
  line1: string;
  line2?: string | null | undefined;
  phone?: string | null | undefined;
  postalCode?: string | null | undefined;
  recipientName: string;
  stateRegion?: string | null | undefined;
};

export type CustomerConversationInput = {
  body: string;
  contactEmail: string;
  contactName: string;
  contactPhone?: string | null | undefined;
  subject: string;
};

export type EntityFieldType =
  | 'BOOLEAN'
  | 'DATE'
  | 'DATETIME'
  | 'DECIMAL'
  | 'EMAIL'
  | 'INTEGER'
  | 'LONG_TEXT'
  | 'MEDIA'
  | 'MONEY'
  | 'MULTI_SELECT'
  | 'PHONE'
  | 'REFERENCE'
  | 'SELECT'
  | 'TEXT'
  | 'URL'
  | '%future added value';

export type EntityRecordFilterInput = {
  field: string;
  op: RecordFilterOp;
  value: unknown;
};

/** What a storefront may do with a record type. */
export type EntityStorefrontAccess =
  /** Staff only. */
  | 'PRIVATE'
  /** Active records are listed on the storefront with their public fields (menus, courses, classes). */
  | 'PUBLISHED'
  /** Shoppers submit records through the storefront (reservations, appointment or enrolment requests); never listed. */
  | 'SUBMISSIONS'
  | '%future added value';

export type FurnishingStatus =
  | 'FURNISHED'
  | 'SEMI_FURNISHED'
  | 'UNFURNISHED'
  | '%future added value';

/** A map viewport; west must be less than east. */
export type GeoBoundsInput = {
  east: number;
  north: number;
  south: number;
  west: number;
};

/** Within radiusKm (up to 200) of a point. */
export type GeoNearInput = {
  latitude: number;
  longitude: number;
  radiusKm: number;
};

export type ListingType =
  | 'LEASE'
  | 'RENT'
  | 'SALE'
  | 'SHORT_LET'
  | '%future added value';

export type MediaKind =
  | 'DOCUMENT'
  | 'IMAGE'
  | 'VIDEO'
  | '%future added value';

export type MessageSenderType =
  | 'CUSTOMER'
  | 'STAFF'
  | 'SYSTEM'
  | '%future added value';

export type NewsletterSignupInput = {
  email: string;
  firstName?: string | null | undefined;
};

/** What happened to an order. Refetch the order (or the payment session) for its new state. */
export type OrderActivityKind =
  /** The payment was verified. */
  | 'PAID'
  /** The provider declined the payment. */
  | 'PAYMENT_FAILED'
  /** A new order (paid online later, bank transfer, or cash on delivery). */
  | 'PLACED'
  /** A refund completed. */
  | 'REFUNDED'
  /** Fulfilment status changed (processing, shipped, delivered, cancelled…). */
  | 'STATUS_CHANGED'
  /** Staff could not find the transfer. */
  | 'TRANSFER_REJECTED'
  /** The shopper reported a bank transfer. */
  | 'TRANSFER_SUBMITTED'
  | '%future added value';

/** Cursor pagination. limit defaults to 25, at most 100. */
export type PageInput = {
  /** pageInfo.nextCursor of the previous page. */
  cursor?: string | null | undefined;
  limit?: number | null | undefined;
};

export type PlatformReportReason =
  | 'IMPERSONATION'
  | 'INAPPROPRIATE_CONTENT'
  | 'INTELLECTUAL_PROPERTY'
  | 'OTHER'
  | 'PROHIBITED_ITEM'
  | 'SCAM_OR_FRAUD'
  | 'SPAM'
  | '%future added value';

/** What a report is about. */
export type PlatformReportSubject =
  | 'BUSINESS'
  | 'EVENT'
  | 'OTHER'
  | 'PRODUCT'
  | 'PROPERTY'
  | 'REVIEW'
  | '%future added value';

export type PricePeriod =
  | 'PER_MONTH'
  | 'PER_NIGHT'
  | 'PER_QUARTER'
  | 'PER_WEEK'
  | 'PER_YEAR'
  | 'TOTAL'
  | '%future added value';

export type ProductReviewInput = {
  /** Defaults to the shopper’s first name and initial. */
  authorName?: string | null | undefined;
  body: string;
  rating: number;
  title?: string | null | undefined;
};

export type PropertyAvailability =
  | 'AVAILABLE'
  | 'LET'
  | 'OFF_MARKET'
  | 'RESERVED'
  | 'SOLD'
  | 'UNDER_OFFER'
  | '%future added value';

export type PropertyCategory =
  | 'COMMERCIAL'
  | 'INDUSTRIAL'
  | 'LAND'
  | 'MIXED_USE'
  | 'RESIDENTIAL'
  | '%future added value';

export type PropertyCondition =
  | 'EXCELLENT'
  | 'FAIR'
  | 'GOOD'
  | 'NEEDS_RENOVATION'
  | 'NEW'
  | 'OFF_PLAN'
  | 'UNDER_CONSTRUCTION'
  | '%future added value';

export type PropertyPlanKind =
  | 'DEPOSIT'
  | 'FULL'
  | 'INSTALMENTS'
  | 'RESERVATION'
  | '%future added value';

export type PublicEnquiryInput = {
  contactEmail?: string | null | undefined;
  contactName: string;
  contactPhone?: string | null | undefined;
  message?: string | null | undefined;
  propertySlug: string;
};

export type PublicPropertyFilter = {
  category?: PropertyCategory | null | undefined;
  /** Only properties in this category. */
  categoryId?: string | number | null | undefined;
  /** Only properties in this collection. */
  collectionId?: string | number | null | undefined;
  listingType?: ListingType | null | undefined;
  locationId?: string | number | null | undefined;
  maxPrice?: string | null | undefined;
  minBedrooms?: number | null | undefined;
  minPrice?: string | null | undefined;
  /** Only properties with coordinates within the radius. */
  near?: GeoNearInput | null | undefined;
  propertyTypeSlug?: string | null | undefined;
  q?: string | null | undefined;
  /** Only properties with coordinates inside the viewport. */
  within?: GeoBoundsInput | null | undefined;
};

export type PublicViewingInput = {
  contactEmail?: string | null | undefined;
  contactName: string;
  contactPhone?: string | null | undefined;
  message?: string | null | undefined;
  propertySlug: string;
  scheduledEnd: string;
  scheduledStart: string;
};

export type RecordFilterOp =
  | 'CONTAINS'
  | 'EQ'
  | 'GT'
  | 'GTE'
  | 'IN'
  | 'LT'
  | 'LTE'
  | '%future added value';

/** PENDING until the business publishes or rejects it. */
export type ReviewStatus =
  | 'PENDING'
  | 'PUBLISHED'
  | 'REJECTED'
  | '%future added value';

/** PRODUCT or PROPERTY. */
export type SavedItemKind =
  | 'PRODUCT'
  | 'PROPERTY'
  | '%future added value';

/** Which page of the store to describe. */
export type SeoDocumentInput = {
  /** PAGE without an SEO record: its description. */
  description?: string | null | undefined;
  /** PAGE: the path, e.g. /about. */
  path?: string | null | undefined;
  /** The request’s query string: `page` keeps its own canonical; filters and sorting are noindexed and canonicalised to the plain listing; tracking parameters are ignored. */
  query?: string | null | undefined;
  resource: SeoResourceKind;
  /** PRODUCT, CATEGORY, COLLECTION, PROPERTY: the slug from the URL. */
  slug?: string | null | undefined;
  /** PAGE without an SEO record (e.g. /shop): its title. */
  title?: string | null | undefined;
};

/** INDEX_FOLLOW: may appear in search results. NOINDEX_FOLLOW: kept out of results, links still followed. NOINDEX_NOFOLLOW: neither. */
export type SeoIndexing =
  | 'INDEX_FOLLOW'
  | 'NOINDEX_FOLLOW'
  | 'NOINDEX_NOFOLLOW'
  | '%future added value';

/** Decides the structured data: ARTICLE → Article, FAQ → FAQPage (from the questions), CONTACT → LocalBusiness (with a street address). */
export type SeoPageKind =
  | 'ABOUT'
  | 'ARTICLE'
  | 'CONTACT'
  | 'FAQ'
  | 'LANDING'
  | 'PAGE'
  | '%future added value';

export type SeoResourceKind =
  | 'CATEGORY'
  | 'COLLECTION'
  | 'HOME'
  | 'PAGE'
  | 'PRODUCT'
  | 'PROPERTY'
  | '%future added value';

export type ShippingRateType =
  | 'FLAT_RATE'
  | 'FREE'
  | 'PICKUP'
  | '%future added value';

export type StorefrontHeroInput = {
  badge?: StorefrontStatInput | null | undefined;
  /** At most 60 characters. */
  eyebrow?: string | null | undefined;
  /** 1–120 characters. */
  headline: string;
  /** Must be a part of the headline. */
  highlight?: string | null | undefined;
  /** Alt text per image, in the same order (each at most 200 characters). */
  imageAlts?: Array<string> | null | undefined;
  /** READY images of this business, at most 5. */
  imageAssetIds?: Array<string | number> | null | undefined;
  /** Null: the store’s own default. */
  layout?: StorefrontHeroLayout | null | undefined;
  primaryAction?: StorefrontLinkInput | null | undefined;
  secondaryAction?: StorefrontLinkInput | null | undefined;
  showRating?: boolean | null | undefined;
  /** At most 6. The CAROUSEL layout needs at least 2. */
  slides?: Array<StorefrontHeroSlideInput> | null | undefined;
  /** At most 280 characters. */
  subheading?: string | null | undefined;
  /** A video of this business, READY or still processing. Keep a picture too: it is the fallback and poster. */
  videoAssetId?: string | number | null | undefined;
};

/** How a store lays out its hero, each in its own style. A store treats a layout it has no design for as its default. */
export type StorefrontHeroLayout =
  /** Slides that change, each with its own picture, words and button (`slides`). */
  | 'CAROUSEL'
  /** One large picture with the words on it. */
  | 'IMAGE'
  /** The words beside the picture. */
  | 'SPLIT'
  /** Words only, no picture. */
  | 'TEXT'
  | '%future added value';

export type StorefrontHeroSlideInput = {
  /** Null: the hero’s primary action. */
  action?: StorefrontLinkInput | null | undefined;
  /** At most 60 characters. */
  eyebrow?: string | null | undefined;
  /** At most 120 characters. Null: the hero’s own headline. */
  headline?: string | null | undefined;
  /** At most 200 characters. */
  imageAlt?: string | null | undefined;
  /** A READY image of this business, each used once. */
  imageAssetId: string | number;
  /** At most 280 characters. */
  subheading?: string | null | undefined;
};

export type StorefrontHomePageInput = {
  /** At most 160 characters; null for no strip. */
  announcement?: string | null | undefined;
  hero?: StorefrontHeroInput | null | undefined;
  /** At most 20; replaces the list. */
  sections?: Array<StorefrontHomeSectionInput> | null | undefined;
  /** At most 6. */
  stats?: Array<StorefrontStatInput> | null | undefined;
};

export type StorefrontHomeSectionInput = {
  /** Plain text, at most 1,000 characters. */
  body?: string | null | undefined;
  collectionSlug?: string | null | undefined;
  /** At most 60 characters. */
  eyebrow?: string | null | undefined;
  /** Omit for a new section; send it back to keep a section’s id. */
  id?: string | number | null | undefined;
  imageAlts?: Array<string> | null | undefined;
  /** READY images of this business, at most 12. */
  imageAssetIds?: Array<string | number> | null | undefined;
  itemLimit?: number | null | undefined;
  kind: StorefrontHomeSectionKind;
  /** Null: the store’s own default. GRID or CAROUSEL for COLLECTIONS, FEATURED_PRODUCTS, FEATURED_LISTINGS, RECORDS, BOOKABLES, GALLERY and REVIEWS; SPLIT or BANNER for FEATURE_PANEL and CALL_TO_ACTION; none for the others. */
  layout?: StorefrontSectionLayout | null | undefined;
  link?: StorefrontLinkInput | null | undefined;
  recordType?: string | null | undefined;
  /** At most 120 characters. */
  title?: string | null | undefined;
  /** FEATURE_PANEL, CALL_TO_ACTION and RICH_TEXT only: a video of this business, READY or still processing. */
  videoAssetId?: string | number | null | undefined;
  visible: boolean;
};

/** How a store renders a home page section. Stores skip kinds they do not know, so new kinds never break a store. */
export type StorefrontHomeSectionKind =
  /** What can be booked (storefrontBookables: stays, appointments, classes, courses); `itemLimit` of them. */
  | 'BOOKABLES'
  /** A banner with a title, body and link. */
  | 'CALL_TO_ACTION'
  /** Published collections as cards (services, departments). `itemLimit` caps them. */
  | 'COLLECTIONS'
  /** The contact details of storefrontProfile. */
  | 'CONTACT'
  /** Property listings, newest first; `itemLimit` of them (real estate). */
  | 'FEATURED_LISTINGS'
  /** Products of `collectionSlug`, or the newest when null; `itemLimit` of them. */
  | 'FEATURED_PRODUCTS'
  /** Picture, eyebrow, title, body and one link. */
  | 'FEATURE_PANEL'
  /** Up to 12 pictures with an optional title. */
  | 'GALLERY'
  /** Records of the published record type `recordType` (a menu, courses, classes); `itemLimit` of them. */
  | 'RECORDS'
  /** Recent published reviews (storefrontReviews); `itemLimit` of them. */
  | 'REVIEWS'
  /** Eyebrow, title and body text. */
  | 'RICH_TEXT'
  /** The page’s `stats`. */
  | 'STATS'
  | '%future added value';

export type StorefrontLinkInput = {
  /** A path starting with / (not //) or an https:// URL. */
  href: string;
  /** At most 60 characters. */
  label: string;
};

export type StorefrontPageFilter = {
  /** e.g. ARTICLE for a journal. */
  kind?: SeoPageKind | null | undefined;
  /** Only pages whose path starts with this, e.g. /journal/. Must start with /. */
  pathPrefix?: string | null | undefined;
};

/** HOME ("/"), any other PAGE, or the HEADER and FOOTER shown on every page. */
export type StorefrontPageKind =
  | 'FOOTER'
  | 'HEADER'
  | 'HOME'
  | 'PAGE'
  | '%future added value';

export type StorefrontProductFilter = {
  categorySlug?: string | null | undefined;
  /** Products with an active variant at or below this price (store currency). */
  priceMax?: string | null | undefined;
  /** Products with an active variant at or above this price (store currency). */
  priceMin?: string | null | undefined;
  /** Full-text search over titles, descriptions, SKUs and tags. */
  q?: string | null | undefined;
  /** Products carrying this exact tag. */
  tag?: string | null | undefined;
};

/** NEWEST first (default), or by price: a product sorts at its lowest active price within any price filter. */
export type StorefrontProductSort =
  | 'NEWEST'
  | 'PRICE_ASC'
  | 'PRICE_DESC'
  | '%future added value';

/** Which front-end draws a store: STOREFRONT (Cartly’s storefront app), ENGINE (the storefront engine: stores made in the website builder) or MERCHANT (the merchant’s own server). */
export type StorefrontRenderer =
  | 'ENGINE'
  | 'MERCHANT'
  | 'STOREFRONT'
  | '%future added value';

/** How a home page section arranges its content, each store in its own style. A store treats a layout it has no design for as its default. */
export type StorefrontSectionLayout =
  /** A full-width picture with the words on it. */
  | 'BANNER'
  /** Items in one row that scrolls sideways. */
  | 'CAROUSEL'
  /** Items in rows and columns. */
  | 'GRID'
  /** The picture beside the words. */
  | 'SPLIT'
  | '%future added value';

export type StorefrontStatInput = {
  /** At most 60 characters. */
  label: string;
  /** At most 60 characters. */
  value: string;
};

export type SubmitReportInput = {
  /** The business reported, when not sent from its own storefront (X-Storefront-Host). Not needed for OTHER. */
  businessSlug?: string | null | undefined;
  /** What is wrong (required for OTHER), at most 2,000 characters. */
  details?: string | null | undefined;
  /** For a reply, when not signed in. */
  email?: string | null | undefined;
  reason: PlatformReportReason;
  subject: PlatformReportSubject;
  /** The product, property, event or review reported (required for those subjects). */
  subjectId?: string | number | null | undefined;
  /** The page reported (http or https). */
  url?: string | null | undefined;
};

export type TenantStatus =
  | 'ACTIVE'
  | 'CLOSED'
  | 'PROVISIONING'
  | 'SUSPENDED'
  | '%future added value';

export type CartlySdkTypeAnchorsQueryVariables = Exact<{
  homePage?: StorefrontHomePageInput | null | undefined;
}>;


export type CartlySdkTypeAnchorsQuery = { __typename: 'Query' };

export type ViewerQueryVariables = Exact<{ [key: string]: never; }>;


export type ViewerQuery = { viewer: { id: string, email: string, displayName: string | null, emailVerified: boolean, mfaEnabled: boolean, businesses: Array<{ id: string, name: string, slug: string, status: TenantStatus, verticals: Array<BusinessVertical>, roles: Array<{ key: string, name: string }> }> } };

export type PaymentSessionFieldsFragment = { status: string, resourceType: string, amount: string, currency: string, methods: Array<string>, method: string | null, paymentReference: string | null, expiresAt: string, completedAt: string | null, title: string, cashOnDeliveryInstructions: string | null, merchant: { name: string, logoUrl: string | null, primaryColor: string | null, accentColor: string | null, headingFont: string | null, bodyFont: string | null }, lines: Array<{ description: string, quantity: number, amount: string }>, bankTransfer: { bankName: string, accountName: string, accountNumber: string, instructions: string | null, reference: string, submittedAt: string | null, rejectionReason: string | null } | null };

export type PaymentSessionQueryVariables = Exact<{
  token: string;
}>;


export type PaymentSessionQuery = { paymentSession: { status: string, resourceType: string, amount: string, currency: string, methods: Array<string>, method: string | null, paymentReference: string | null, expiresAt: string, completedAt: string | null, title: string, cashOnDeliveryInstructions: string | null, merchant: { name: string, logoUrl: string | null, primaryColor: string | null, accentColor: string | null, headingFont: string | null, bodyFont: string | null }, lines: Array<{ description: string, quantity: number, amount: string }>, bankTransfer: { bankName: string, accountName: string, accountNumber: string, instructions: string | null, reference: string, submittedAt: string | null, rejectionReason: string | null } | null } };

export type RefreshPaymentSessionMutationVariables = Exact<{
  token: string;
}>;


export type RefreshPaymentSessionMutation = { refreshPaymentSession: { status: string, resourceType: string, amount: string, currency: string, methods: Array<string>, method: string | null, paymentReference: string | null, expiresAt: string, completedAt: string | null, title: string, cashOnDeliveryInstructions: string | null, merchant: { name: string, logoUrl: string | null, primaryColor: string | null, accentColor: string | null, headingFont: string | null, bodyFont: string | null }, lines: Array<{ description: string, quantity: number, amount: string }>, bankTransfer: { bankName: string, accountName: string, accountNumber: string, instructions: string | null, reference: string, submittedAt: string | null, rejectionReason: string | null } | null } };

export type StartPaymentSessionMutationVariables = Exact<{
  token: string;
  method: string;
}>;


export type StartPaymentSessionMutation = { startPaymentSession: { checkoutUrl: string | null } };

export type SubmitBankTransferProofMutationVariables = Exact<{
  token: string;
  input: BankTransferProofInput;
}>;


export type SubmitBankTransferProofMutation = { submitBankTransferProof: { status: string, resourceType: string, amount: string, currency: string, methods: Array<string>, method: string | null, paymentReference: string | null, expiresAt: string, completedAt: string | null, title: string, cashOnDeliveryInstructions: string | null, merchant: { name: string, logoUrl: string | null, primaryColor: string | null, accentColor: string | null, headingFont: string | null, bodyFont: string | null }, lines: Array<{ description: string, quantity: number, amount: string }>, bankTransfer: { bankName: string, accountName: string, accountNumber: string, instructions: string | null, reference: string, submittedAt: string | null, rejectionReason: string | null } | null } };

export type ListingCardFieldsFragment = { id: string, slug: string, title: string, referenceCode: string, category: PropertyCategory, listingType: ListingType, status: PropertyAvailability, price: string | null, priceOnRequest: boolean, pricePeriod: PricePeriod, currency: string, bedrooms: number | null, bathrooms: number | null, city: string | null, stateRegion: string | null, media: Array<{ id: string, url: string | null, caption: string | null, kind: MediaKind, isFloorPlan: boolean }> };

export type ListingsQueryVariables = Exact<{
  filter?: PublicPropertyFilter | null | undefined;
  page?: PageInput | null | undefined;
}>;


export type ListingsQuery = { listings: { items: Array<{ id: string, slug: string, title: string, referenceCode: string, category: PropertyCategory, listingType: ListingType, status: PropertyAvailability, price: string | null, priceOnRequest: boolean, pricePeriod: PricePeriod, currency: string, bedrooms: number | null, bathrooms: number | null, city: string | null, stateRegion: string | null, media: Array<{ id: string, url: string | null, caption: string | null, kind: MediaKind, isFloorPlan: boolean }> }>, pageInfo: { nextCursor: string | null, hasMore: boolean, limit: number } } };

export type ListingQueryVariables = Exact<{
  slug: string;
}>;


export type ListingQuery = { listing: { description: string | null, seoTitle: string | null, seoDescription: string | null, availableFrom: string | null, condition: PropertyCondition | null, furnishing: FurnishingStatus | null, floorAreaSqm: string | null, landAreaSqm: string | null, parkingSpaces: number | null, toilets: number | null, serviceCharge: string | null, yearBuilt: number | null, publishedAt: string | null, sellOnline: boolean, purchasable: boolean, collectionIds: Array<string>, categoryIds: Array<string>, id: string, slug: string, title: string, referenceCode: string, category: PropertyCategory, listingType: ListingType, status: PropertyAvailability, price: string | null, priceOnRequest: boolean, pricePeriod: PricePeriod, currency: string, bedrooms: number | null, bathrooms: number | null, city: string | null, stateRegion: string | null, propertyType: { name: string, slug: string } | null, paymentOptions: Array<{ planId: string | null, kind: PropertyPlanKind, label: string, description: string | null, dueNow: string, balance: string, schedule: Array<{ sequence: number, dueDate: string, amount: string }> }>, documents: Array<{ id: string, title: string, kind: string | null, mimeType: string, url: string | null }>, media: Array<{ id: string, url: string | null, caption: string | null, kind: MediaKind, isFloorPlan: boolean }> } };

export type SubmitPropertyEnquiryMutationVariables = Exact<{
  input: PublicEnquiryInput;
}>;


export type SubmitPropertyEnquiryMutation = { submitPropertyEnquiry: { id: string, status: string } };

export type RequestPropertyViewingMutationVariables = Exact<{
  input: PublicViewingInput;
}>;


export type RequestPropertyViewingMutation = { requestPropertyViewing: { id: string, status: string } };

export type NearbyListingsQueryVariables = Exact<{
  near: GeoNearInput;
  limit?: number | null | undefined;
}>;


export type NearbyListingsQuery = { nearbyListings: Array<{ distanceMeters: number, listing: { id: string, slug: string, title: string, referenceCode: string, category: PropertyCategory, listingType: ListingType, status: PropertyAvailability, price: string | null, priceOnRequest: boolean, pricePeriod: PricePeriod, currency: string, bedrooms: number | null, bathrooms: number | null, city: string | null, stateRegion: string | null, media: Array<{ id: string, url: string | null, caption: string | null, kind: MediaKind, isFloorPlan: boolean }> } }> };

export type StorefrontSeoQueryVariables = Exact<{
  input: SeoDocumentInput;
}>;


export type StorefrontSeoQuery = { storefrontSeo: { title: string, description: string, canonicalUrl: string, robots: string, indexing: SeoIndexing, jsonLdScript: string, lastModified: string | null, openGraph: { type: string, title: string, description: string, url: string, siteName: string, locale: string, images: Array<{ url: string, width: number | null, height: number | null, alt: string }> }, twitter: { card: string, title: string, description: string, site: string | null, image: string | null, imageAlt: string | null }, breadcrumbs: Array<{ name: string, url: string }>, verification: { google: string | null, bing: string | null } } };

export type StorefrontSitemapQueryVariables = Exact<{
  name?: string | null | undefined;
}>;


export type StorefrontSitemapQuery = { storefrontSitemap: { contentType: string, body: string } };

export type StorefrontRobotsTxtQueryVariables = Exact<{ [key: string]: never; }>;


export type StorefrontRobotsTxtQuery = { storefrontRobotsTxt: { contentType: string, body: string } };

export type StorefrontLlmsTxtQueryVariables = Exact<{ [key: string]: never; }>;


export type StorefrontLlmsTxtQuery = { storefrontLlmsTxt: { contentType: string, body: string } };

export type StorefrontCanonicalHostQueryVariables = Exact<{
  requestHost?: string | null | undefined;
}>;


export type StorefrontCanonicalHostQuery = { storefrontCanonicalHost: { canonicalHost: string, redirectTo: string | null } };

export type StorefrontRoutingQueryVariables = Exact<{
  requestHost?: string | null | undefined;
}>;


export type StorefrontRoutingQuery = { storefrontCanonicalHost: { businessSlug: string, appKey: string | null, canonicalHost: string, redirectTo: string | null, selfBuilt: boolean } };

export type StorefrontRouteQueryVariables = Exact<{ [key: string]: never; }>;


export type StorefrontRouteQuery = { storefrontRoute: { renderer: StorefrontRenderer, live: boolean } };

export type StorefrontIndexNowKeyQueryVariables = Exact<{
  key: string;
}>;


export type StorefrontIndexNowKeyQuery = { storefrontIndexNowKey: { contentType: string, body: string } };

export type StorefrontRedirectQueryVariables = Exact<{
  path: string;
}>;


export type StorefrontRedirectQuery = { storefrontRedirect: { location: string, permanent: boolean } | null };

export type StorefrontVisualPageQueryVariables = Exact<{
  path: string;
}>;


export type StorefrontVisualPageQuery = { storefrontVisualPage: { document: unknown, theme: unknown, data: unknown, preview: boolean, page: { id: string, kind: StorefrontPageKind, path: string, title: string, seoTitle: string | null, seoDescription: string | null, noIndex: boolean, socialImageUrl: string | null }, navigation: Array<{ label: string, href: string }> } | null };

export type StorefrontVisualChromeQueryVariables = Exact<{ [key: string]: never; }>;


export type StorefrontVisualChromeQuery = { storefrontVisualChrome: { header: unknown, footer: unknown, theme: unknown, data: unknown, navigation: Array<{ label: string, href: string }> } | null };

export type StorefrontPagePreviewQueryVariables = Exact<{
  token: string;
}>;


export type StorefrontPagePreviewQuery = { storefrontPagePreview: { document: unknown, header: unknown, footer: unknown, theme: unknown, data: unknown, preview: boolean, page: { id: string, kind: StorefrontPageKind, path: string, title: string, seoTitle: string | null, seoDescription: string | null, noIndex: boolean, socialImageUrl: string | null }, navigation: Array<{ label: string, href: string }> } };

export type PageInfoFieldsFragment = { nextCursor: string | null, hasMore: boolean, limit: number };

export type StorefrontProductCardFieldsFragment = { id: string, slug: string, title: string, description: string | null, media: Array<{ id: string, url: string | null, altText: string | null, kind: MediaKind }>, variants: Array<{ id: string, price: string, compareAtPrice: string | null, currency: string, inStock: boolean, lowStock: boolean }> };

export type StorefrontProductsQueryVariables = Exact<{
  filter?: StorefrontProductFilter | null | undefined;
  sort?: StorefrontProductSort | null | undefined;
  page?: PageInput | null | undefined;
}>;


export type StorefrontProductsQuery = { storefrontProducts: { items: Array<{ id: string, slug: string, title: string, description: string | null, media: Array<{ id: string, url: string | null, altText: string | null, kind: MediaKind }>, variants: Array<{ id: string, price: string, compareAtPrice: string | null, currency: string, inStock: boolean, lowStock: boolean }> }>, pageInfo: { nextCursor: string | null, hasMore: boolean, limit: number } } };

export type StorefrontProductQueryVariables = Exact<{
  slug: string;
}>;


export type StorefrontProductQuery = { storefrontProduct: { description: string | null, seoTitle: string | null, seoDescription: string | null, tags: Array<string>, categoryIds: Array<string>, id: string, slug: string, title: string, attributes: Array<{ code: string, name: string, value: unknown }>, variants: Array<{ sku: string, title: string | null, id: string, price: string, compareAtPrice: string | null, currency: string, inStock: boolean, lowStock: boolean, options: Array<{ name: string, value: string }> }>, options: Array<{ name: string, values: Array<string> }>, media: Array<{ variantId: string | null, id: string, url: string | null, altText: string | null, kind: MediaKind }> } };

export type StorefrontCategoriesQueryVariables = Exact<{ [key: string]: never; }>;


export type StorefrontCategoriesQuery = { storefrontCategories: Array<{ id: string, name: string, slug: string, parentId: string | null, description: string | null, imageUrl: string | null, productCount: number | null }> };

export type CartFieldsFragment = { currency: string, subtotal: string, discountTotal: string, shippingTotal: string, taxTotal: string, total: string, propertyItems: Array<{ propertyId: string, slug: string, title: string, referenceCode: string, imageUrl: string | null, planId: string | null, planKind: string, planLabel: string, dueNow: string, balance: string, schedule: Array<{ sequence: number, dueDate: string, amount: string }> }>, items: Array<{ variantId: string, sku: string, productTitle: string, productSlug: string, imageUrl: string | null, variantTitle: string | null, quantity: number, unitPrice: string, lineTotal: string }> };

export type CreateCartMutationVariables = Exact<{ [key: string]: never; }>;


export type CreateCartMutation = { createCart: { cartId: string, cartToken: string, currency: string } };

export type CartQueryVariables = Exact<{ [key: string]: never; }>;


export type CartQuery = { cart: { currency: string, subtotal: string, discountTotal: string, shippingTotal: string, taxTotal: string, total: string, propertyItems: Array<{ propertyId: string, slug: string, title: string, referenceCode: string, imageUrl: string | null, planId: string | null, planKind: string, planLabel: string, dueNow: string, balance: string, schedule: Array<{ sequence: number, dueDate: string, amount: string }> }>, items: Array<{ variantId: string, sku: string, productTitle: string, productSlug: string, imageUrl: string | null, variantTitle: string | null, quantity: number, unitPrice: string, lineTotal: string }> } };

export type PreviewCartCouponQueryVariables = Exact<{
  code: string;
  email?: string | null | undefined;
}>;


export type PreviewCartCouponQuery = { previewCartCoupon: { currency: string, subtotal: string, discountTotal: string, shippingTotal: string, taxTotal: string, total: string, propertyItems: Array<{ propertyId: string, slug: string, title: string, referenceCode: string, imageUrl: string | null, planId: string | null, planKind: string, planLabel: string, dueNow: string, balance: string, schedule: Array<{ sequence: number, dueDate: string, amount: string }> }>, items: Array<{ variantId: string, sku: string, productTitle: string, productSlug: string, imageUrl: string | null, variantTitle: string | null, quantity: number, unitPrice: string, lineTotal: string }> } };

export type SetCartItemMutationVariables = Exact<{
  variantId: string | number;
  quantity: number;
}>;


export type SetCartItemMutation = { setCartItem: { currency: string, subtotal: string, discountTotal: string, shippingTotal: string, taxTotal: string, total: string, propertyItems: Array<{ propertyId: string, slug: string, title: string, referenceCode: string, imageUrl: string | null, planId: string | null, planKind: string, planLabel: string, dueNow: string, balance: string, schedule: Array<{ sequence: number, dueDate: string, amount: string }> }>, items: Array<{ variantId: string, sku: string, productTitle: string, productSlug: string, imageUrl: string | null, variantTitle: string | null, quantity: number, unitPrice: string, lineTotal: string }> } };

export type RemoveCartItemMutationVariables = Exact<{
  variantId: string | number;
}>;


export type RemoveCartItemMutation = { removeCartItem: { currency: string, subtotal: string, discountTotal: string, shippingTotal: string, taxTotal: string, total: string, propertyItems: Array<{ propertyId: string, slug: string, title: string, referenceCode: string, imageUrl: string | null, planId: string | null, planKind: string, planLabel: string, dueNow: string, balance: string, schedule: Array<{ sequence: number, dueDate: string, amount: string }> }>, items: Array<{ variantId: string, sku: string, productTitle: string, productSlug: string, imageUrl: string | null, variantTitle: string | null, quantity: number, unitPrice: string, lineTotal: string }> } };

export type SetCartPropertyMutationVariables = Exact<{
  propertyId: string | number;
  planId?: string | number | null | undefined;
}>;


export type SetCartPropertyMutation = { setCartProperty: { currency: string, subtotal: string, discountTotal: string, shippingTotal: string, taxTotal: string, total: string, propertyItems: Array<{ propertyId: string, slug: string, title: string, referenceCode: string, imageUrl: string | null, planId: string | null, planKind: string, planLabel: string, dueNow: string, balance: string, schedule: Array<{ sequence: number, dueDate: string, amount: string }> }>, items: Array<{ variantId: string, sku: string, productTitle: string, productSlug: string, imageUrl: string | null, variantTitle: string | null, quantity: number, unitPrice: string, lineTotal: string }> } };

export type RemoveCartPropertyMutationVariables = Exact<{
  propertyId: string | number;
}>;


export type RemoveCartPropertyMutation = { removeCartProperty: { currency: string, subtotal: string, discountTotal: string, shippingTotal: string, taxTotal: string, total: string, propertyItems: Array<{ propertyId: string, slug: string, title: string, referenceCode: string, imageUrl: string | null, planId: string | null, planKind: string, planLabel: string, dueNow: string, balance: string, schedule: Array<{ sequence: number, dueDate: string, amount: string }> }>, items: Array<{ variantId: string, sku: string, productTitle: string, productSlug: string, imageUrl: string | null, variantTitle: string | null, quantity: number, unitPrice: string, lineTotal: string }> } };

export type StorefrontServiceCoverageQueryVariables = Exact<{
  latitude: number;
  longitude: number;
}>;


export type StorefrontServiceCoverageQuery = { storefrontServiceCoverage: { enabled: boolean, covered: boolean, areas: Array<{ id: string, name: string }> } };

export type IntroductoryOfferQueryVariables = Exact<{ [key: string]: never; }>;


export type IntroductoryOfferQuery = { introductoryOffer: { available: boolean, durationMonths: number | null, package: { key: string, name: string } | null } };

export type StorefrontCheckoutOptionsQueryVariables = Exact<{ [key: string]: never; }>;


export type StorefrontCheckoutOptionsQuery = { storefrontShippingMethods: Array<{ id: string, name: string, description: string | null, price: string, currency: string, rateType: ShippingRateType, minOrderSubtotal: string | null, estimatedMinDays: number | null, estimatedMaxDays: number | null, countryCodes: Array<string> }>, storefrontPaymentMethods: { online: boolean, bankTransfer: boolean, cashOnDelivery: boolean, cashOnDeliveryCountries: Array<string> } };

export type CheckoutMutationVariables = Exact<{
  input: CheckoutInput;
}>;


export type CheckoutMutation = { checkout: { orderId: string, orderNumber: number, total: string, currency: string, sessionToken: string, payment: { method: CheckoutPaymentMethod, checkoutUrl: string | null, reference: string, bankTransfer: { bankName: string, accountName: string, accountNumber: string, amount: string, currency: string, reference: string, instructions: string | null, expiresAt: string } | null } } };

export type ContactBusinessMutationVariables = Exact<{
  input: CustomerConversationInput;
}>;


export type ContactBusinessMutation = { contactBusiness: { conversationId: string, accessToken: string } };

export type MyConversationQueryVariables = Exact<{ [key: string]: never; }>;


export type MyConversationQuery = { myConversation: { id: string, subject: string, status: ConversationStatus, messages: Array<{ id: string, body: string, createdAt: string, senderType: MessageSenderType, senderName: string | null }> } };

export type ReplyAsCustomerMutationVariables = Exact<{
  body: string;
}>;


export type ReplyAsCustomerMutation = { replyAsCustomer: { id: string } };

export type RegisterCustomerMutationVariables = Exact<{
  email: string;
  password: string;
  firstName?: string | null | undefined;
  lastName?: string | null | undefined;
}>;


export type RegisterCustomerMutation = { registerCustomer: boolean };

export type VerifyCustomerEmailMutationVariables = Exact<{
  token: string;
}>;


export type VerifyCustomerEmailMutation = { verifyCustomerEmail: boolean };

export type StorefrontSignInProvidersQueryVariables = Exact<{ [key: string]: never; }>;


export type StorefrontSignInProvidersQuery = { storefrontSignInProviders: Array<string> };

export type CustomerProviderSignInMutationVariables = Exact<{
  code: string;
}>;


export type CustomerProviderSignInMutation = { customerProviderSignIn: { token: string, expiresAt: string } };

export type CustomerLoginMutationVariables = Exact<{
  email: string;
  password: string;
}>;


export type CustomerLoginMutation = { customerLogin: { token: string, expiresAt: string } };

export type CustomerLogoutMutationVariables = Exact<{ [key: string]: never; }>;


export type CustomerLogoutMutation = { customerLogout: boolean };

export type RequestCustomerPasswordResetMutationVariables = Exact<{
  email: string;
}>;


export type RequestCustomerPasswordResetMutation = { requestCustomerPasswordReset: boolean };

export type ResetCustomerPasswordMutationVariables = Exact<{
  token: string;
  password: string;
}>;


export type ResetCustomerPasswordMutation = { resetCustomerPassword: boolean };

export type CustomerAccountQueryVariables = Exact<{ [key: string]: never; }>;


export type CustomerAccountQuery = { customerAccount: { email: string, firstName: string | null, lastName: string | null, phone: string | null, createdAt: string }, customerOrders: Array<{ orderNumber: number, status: string, paymentStatus: string, fulfillmentStatus: string, currency: string, total: string, itemCount: number, placedAt: string }> };

export type CustomerOrderHistoryQueryVariables = Exact<{
  page?: PageInput | null | undefined;
}>;


export type CustomerOrderHistoryQuery = { customerOrderHistory: { items: Array<{ orderNumber: number, status: string, paymentStatus: string, fulfillmentStatus: string, currency: string, total: string, itemCount: number, placedAt: string }>, pageInfo: { nextCursor: string | null, hasMore: boolean } } };

export type CustomerOrderQueryVariables = Exact<{
  orderNumber: number;
}>;


export type CustomerOrderQuery = { customerOrder: { orderNumber: number, status: string, paymentStatus: string, fulfillmentStatus: string, placedAt: string, currency: string, subtotal: string, discountTotal: string, shippingTotal: string, taxTotal: string, total: string, note: string | null, paymentMethod: string | null, shippingMethodName: string | null, canPay: boolean, shippingAddress: { recipientName: string, phone: string | null, line1: string, line2: string | null, city: string, stateRegion: string | null, postalCode: string | null, countryCode: string } | null, lines: Array<{ productTitle: string, variantTitle: string | null, sku: string, quantity: number, unitPrice: string, lineTotal: string, productSlug: string | null, propertySlug: string | null, imageUrl: string | null }>, instalments: Array<{ id: string, title: string, sequence: number, count: number, dueDate: string, amount: string, currency: string, status: string, paidAt: string | null, canPay: boolean }>, events: Array<{ kind: string, at: string }> } };

export type ResumeCustomerOrderPaymentMutationVariables = Exact<{
  orderNumber: number;
}>;


export type ResumeCustomerOrderPaymentMutation = { resumeCustomerOrderPayment: string };

export type PayCustomerInstalmentMutationVariables = Exact<{
  orderNumber: number;
  instalmentId: string | number;
  paymentMethod?: CheckoutPaymentMethod | null | undefined;
}>;


export type PayCustomerInstalmentMutation = { payCustomerInstalment: string };

export type ShopperAddressFieldsFragment = { id: string, label: string | null, recipientName: string, phone: string | null, line1: string, line2: string | null, city: string, stateRegion: string | null, postalCode: string | null, countryCode: string, isDefaultShipping: boolean, isDefaultBilling: boolean };

export type ShopperAddressesQueryVariables = Exact<{ [key: string]: never; }>;


export type ShopperAddressesQuery = { shopperAddresses: Array<{ id: string, label: string | null, recipientName: string, phone: string | null, line1: string, line2: string | null, city: string, stateRegion: string | null, postalCode: string | null, countryCode: string, isDefaultShipping: boolean, isDefaultBilling: boolean }> };

export type SaveShopperAddressMutationVariables = Exact<{
  input: CustomerAddressInput;
  id?: string | number | null | undefined;
}>;


export type SaveShopperAddressMutation = { saveShopperAddress: { id: string, label: string | null, recipientName: string, phone: string | null, line1: string, line2: string | null, city: string, stateRegion: string | null, postalCode: string | null, countryCode: string, isDefaultShipping: boolean, isDefaultBilling: boolean } };

export type DeleteShopperAddressMutationVariables = Exact<{
  id: string | number;
}>;


export type DeleteShopperAddressMutation = { deleteShopperAddress: boolean };

export type CustomerReviewsQueryVariables = Exact<{
  page?: PageInput | null | undefined;
}>;


export type CustomerReviewsQuery = { customerReviews: { items: Array<{ id: string, rating: number, title: string | null, body: string, status: ReviewStatus, verifiedPurchase: boolean, reply: string | null, createdAt: string, product: { slug: string | null, title: string, imageUrl: string | null } }>, pageInfo: { nextCursor: string | null, hasMore: boolean } } };

export type SavedItemsQueryVariables = Exact<{
  page?: PageInput | null | undefined;
}>;


export type SavedItemsQuery = { savedItems: { items: Array<{ kind: SavedItemKind, slug: string, title: string, imageUrl: string | null, price: string | null, currency: string, available: boolean, savedAt: string }>, pageInfo: { nextCursor: string | null, hasMore: boolean } } };

export type SaveItemMutationVariables = Exact<{
  kind: SavedItemKind;
  slug: string;
}>;


export type SaveItemMutation = { saveItem: { kind: SavedItemKind, slug: string, saved: boolean } };

export type UnsaveItemMutationVariables = Exact<{
  kind: SavedItemKind;
  slug: string;
}>;


export type UnsaveItemMutation = { unsaveItem: { kind: SavedItemKind, slug: string, saved: boolean } };

export type RequestCustomerEmailChangeMutationVariables = Exact<{
  newEmail: string;
  password: string;
}>;


export type RequestCustomerEmailChangeMutation = { requestCustomerEmailChange: boolean };

export type UpdateCustomerAccountMutationVariables = Exact<{
  firstName?: string | null | undefined;
  lastName?: string | null | undefined;
  phone?: string | null | undefined;
}>;


export type UpdateCustomerAccountMutation = { updateCustomerAccount: { firstName: string | null, lastName: string | null, phone: string | null } };

export type ChangeCustomerPasswordMutationVariables = Exact<{
  currentPassword: string;
  newPassword: string;
}>;


export type ChangeCustomerPasswordMutation = { changeCustomerPassword: boolean };

export type StorefrontCollectionsQueryVariables = Exact<{ [key: string]: never; }>;


export type StorefrontCollectionsQuery = { storefrontCollections: Array<{ id: string, title: string, slug: string, description: string | null, imageUrl: string | null, productCount: number }> };

export type StorefrontCollectionQueryVariables = Exact<{
  slug: string;
}>;


export type StorefrontCollectionQuery = { storefrontCollection: { id: string, title: string, slug: string, description: string | null, imageUrl: string | null, productCount: number, products: Array<{ id: string, slug: string, title: string, description: string | null, media: Array<{ id: string, url: string | null, altText: string | null, kind: MediaKind }>, variants: Array<{ id: string, price: string, compareAtPrice: string | null, currency: string, inStock: boolean, lowStock: boolean }> }> } };

export type StorefrontProductReviewsQueryVariables = Exact<{
  slug: string;
  page?: PageInput | null | undefined;
}>;


export type StorefrontProductReviewsQuery = { storefrontProductReviews: { averageRating: number | null, reviewCount: number, distribution: Array<{ rating: number, count: number }>, page: { items: Array<{ id: string, authorName: string, rating: number, title: string | null, body: string, verifiedPurchase: boolean, reply: string | null, createdAt: string }>, pageInfo: { nextCursor: string | null, hasMore: boolean, limit: number } } } };

export type SubmitProductReviewMutationVariables = Exact<{
  slug: string;
  input: ProductReviewInput;
}>;


export type SubmitProductReviewMutation = { submitProductReview: { id: string, status: ReviewStatus } };

export type StorefrontBrandQueryVariables = Exact<{
  slug: string;
}>;


export type StorefrontBrandQuery = { publicBusinessBrand: { businessName: string, description: string | null, primaryColor: string, secondaryColor: string, accentColor: string | null, headingFont: string, bodyFont: string, logo: { deliveryUrl: string | null } | null } | null };

export type StorefrontProfileQueryVariables = Exact<{ [key: string]: never; }>;


export type StorefrontProfileQuery = { storefrontProfile: { name: string, tagline: string | null, description: string | null, logoUrl: string | null, contactEmail: string | null, contactPhone: string | null, whatsappPhone: string | null, openingHours: string | null, serviceArea: string | null, address: { line1: string | null, line2: string | null, city: string | null, stateRegion: string | null, postalCode: string | null, countryCode: string | null } | null, socialLinks: Array<{ network: string, url: string }> } };

export type StorefrontFeaturesQueryVariables = Exact<{ [key: string]: never; }>;


export type StorefrontFeaturesQuery = { storefrontFeatures: { currency: string, countryCode: string | null, capabilities: Array<string>, businessTypes: Array<{ key: string, name: string, categoryKey: string }> } };

export type StorefrontImageFieldsFragment = { assetId: string, url: string | null, alt: string | null };

export type StorefrontHomePageFieldsFragment = { announcement: string | null, updatedAt: string | null, hero: { layout: StorefrontHeroLayout | null, eyebrow: string | null, headline: string, highlight: string | null, subheading: string | null, showRating: boolean, slides: Array<{ eyebrow: string | null, headline: string | null, subheading: string | null, image: { assetId: string, url: string | null, alt: string | null }, action: { label: string, href: string } | null }>, primaryAction: { label: string, href: string } | null, secondaryAction: { label: string, href: string } | null, images: Array<{ assetId: string, url: string | null, alt: string | null }>, video: { assetId: string, url: string | null } | null, badge: { value: string, label: string } | null } | null, stats: Array<{ value: string, label: string }>, sections: Array<{ id: string, kind: StorefrontHomeSectionKind, layout: StorefrontSectionLayout | null, visible: boolean, eyebrow: string | null, title: string | null, body: string | null, collectionSlug: string | null, recordType: string | null, itemLimit: number | null, images: Array<{ assetId: string, url: string | null, alt: string | null }>, video: { assetId: string, url: string | null } | null, link: { label: string, href: string } | null }> };

export type StorefrontHomePageQueryVariables = Exact<{ [key: string]: never; }>;


export type StorefrontHomePageQuery = { storefrontHomePage: { announcement: string | null, updatedAt: string | null, hero: { layout: StorefrontHeroLayout | null, eyebrow: string | null, headline: string, highlight: string | null, subheading: string | null, showRating: boolean, slides: Array<{ eyebrow: string | null, headline: string | null, subheading: string | null, image: { assetId: string, url: string | null, alt: string | null }, action: { label: string, href: string } | null }>, primaryAction: { label: string, href: string } | null, secondaryAction: { label: string, href: string } | null, images: Array<{ assetId: string, url: string | null, alt: string | null }>, video: { assetId: string, url: string | null } | null, badge: { value: string, label: string } | null } | null, stats: Array<{ value: string, label: string }>, sections: Array<{ id: string, kind: StorefrontHomeSectionKind, layout: StorefrontSectionLayout | null, visible: boolean, eyebrow: string | null, title: string | null, body: string | null, collectionSlug: string | null, recordType: string | null, itemLimit: number | null, images: Array<{ assetId: string, url: string | null, alt: string | null }>, video: { assetId: string, url: string | null } | null, link: { label: string, href: string } | null }> } };

export type StorefrontPageQueryVariables = Exact<{
  path: string;
}>;


export type StorefrontPageQuery = { storefrontPage: { path: string, kind: SeoPageKind, title: string, summary: string | null, body: string | null, updatedAt: string, images: Array<{ assetId: string, url: string | null, alt: string | null }>, faq: Array<{ question: string, answer: string }> } };

export type StorefrontPagesQueryVariables = Exact<{
  filter?: StorefrontPageFilter | null | undefined;
  page?: PageInput | null | undefined;
}>;


export type StorefrontPagesQuery = { storefrontPages: { items: Array<{ path: string, kind: SeoPageKind, title: string, summary: string | null, authorName: string | null, publishedAt: string | null, image: { assetId: string, url: string | null, alt: string | null } | null }>, pageInfo: { hasMore: boolean, nextCursor: string | null } } };

export type StorefrontReviewsQueryVariables = Exact<{
  page?: PageInput | null | undefined;
}>;


export type StorefrontReviewsQuery = { storefrontReviews: { items: Array<{ id: string, authorName: string, rating: number, title: string | null, body: string, reply: string | null, verifiedPurchase: boolean, createdAt: string, product: { slug: string, title: string, imageUrl: string | null } }>, pageInfo: { nextCursor: string | null, hasMore: boolean, limit: number } }, storefrontRatingSummary: { averageRating: number | null, reviewCount: number, distribution: Array<{ rating: number, count: number }> } };

export type StorefrontRecordTypesQueryVariables = Exact<{ [key: string]: never; }>;


export type StorefrontRecordTypesQuery = { storefrontRecordTypes: Array<{ key: string, name: string, description: string | null, access: EntityStorefrontAccess, fields: Array<{ key: string, label: string, type: EntityFieldType, description: string | null, required: boolean, filterable: boolean, searchable: boolean, min: number | null, max: number | null, referenceTo: string | null, options: Array<{ value: string, label: string }> | null }> }> };

export type StorefrontRecordsQueryVariables = Exact<{
  type: string;
  filters?: Array<EntityRecordFilterInput> | EntityRecordFilterInput | null | undefined;
  q?: string | null | undefined;
  page?: PageInput | null | undefined;
}>;


export type StorefrontRecordsQuery = { storefrontRecords: { items: Array<{ id: string, type: string, data: unknown, createdAt: string, updatedAt: string }>, pageInfo: { nextCursor: string | null, hasMore: boolean, limit: number } } };

export type StorefrontRecordQueryVariables = Exact<{
  type: string;
  id: string | number;
}>;


export type StorefrontRecordQuery = { storefrontRecord: { id: string, type: string, data: unknown, createdAt: string, updatedAt: string } };

export type SubmitStorefrontRecordMutationVariables = Exact<{
  type: string;
  data: unknown;
}>;


export type SubmitStorefrontRecordMutation = { submitStorefrontRecord: { id: string, type: string, createdAt: string } };

export type PaymentSessionActivitySubscriptionVariables = Exact<{
  token: string;
}>;


export type PaymentSessionActivitySubscription = { paymentSessionActivity: { kind: OrderActivityKind, at: string } };

export type MyStorefrontRecordsQueryVariables = Exact<{
  type?: string | null | undefined;
}>;


export type MyStorefrontRecordsQuery = { myStorefrontRecords: Array<{ id: string, type: string, typeName: string, data: unknown, archived: boolean, createdAt: string, updatedAt: string, progress: Array<{ field: string, label: string, value: string, valueLabel: string }> }> };

export type StorefrontBookableFieldsFragment = { id: string, slug: string, name: string, description: string | null, unit: BookingUnit, slotMinutes: number | null, minUnits: number, maxUnits: number, maxQuantity: number, checkInTime: string, checkOutTime: string, eventStartsAt: string | null, eventEndsAt: string | null, timezone: string, payment: BookingPayment, confirmation: BookingConfirmation, cancellationHours: number, depositPercent: number | null, maxOccurrences: number, price: { amount: string, currency: string, per: string } | null, priceRules: Array<{ label: string, weekdays: Array<number>, startDate: string | null, endDate: string | null, amount: string, currency: string }>, images: Array<{ assetId: string, url: string | null, alt: string | null }>, media: Array<{ assetId: string, kind: MediaKind, url: string | null, poster: string | null }>, rules: Array<{ weekday: number, startTime: string, endTime: string }> };

export type StorefrontBookablesQueryVariables = Exact<{ [key: string]: never; }>;


export type StorefrontBookablesQuery = { storefrontBookables: Array<{ id: string, slug: string, name: string, description: string | null, unit: BookingUnit, slotMinutes: number | null, minUnits: number, maxUnits: number, maxQuantity: number, checkInTime: string, checkOutTime: string, eventStartsAt: string | null, eventEndsAt: string | null, timezone: string, payment: BookingPayment, confirmation: BookingConfirmation, cancellationHours: number, depositPercent: number | null, maxOccurrences: number, price: { amount: string, currency: string, per: string } | null, priceRules: Array<{ label: string, weekdays: Array<number>, startDate: string | null, endDate: string | null, amount: string, currency: string }>, images: Array<{ assetId: string, url: string | null, alt: string | null }>, media: Array<{ assetId: string, kind: MediaKind, url: string | null, poster: string | null }>, rules: Array<{ weekday: number, startTime: string, endTime: string }> }> };

export type StorefrontBookableQueryVariables = Exact<{
  slug: string;
}>;


export type StorefrontBookableQuery = { storefrontBookable: { id: string, slug: string, name: string, description: string | null, unit: BookingUnit, slotMinutes: number | null, minUnits: number, maxUnits: number, maxQuantity: number, checkInTime: string, checkOutTime: string, eventStartsAt: string | null, eventEndsAt: string | null, timezone: string, payment: BookingPayment, confirmation: BookingConfirmation, cancellationHours: number, depositPercent: number | null, maxOccurrences: number, price: { amount: string, currency: string, per: string } | null, priceRules: Array<{ label: string, weekdays: Array<number>, startDate: string | null, endDate: string | null, amount: string, currency: string }>, images: Array<{ assetId: string, url: string | null, alt: string | null }>, media: Array<{ assetId: string, kind: MediaKind, url: string | null, poster: string | null }>, rules: Array<{ weekday: number, startTime: string, endTime: string }> } };

export type BookableAvailabilityQueryVariables = Exact<{
  slug: string;
  from: string;
  to: string;
}>;


export type BookableAvailabilityQuery = { bookableAvailability: { unit: BookingUnit, days: Array<{ date: string, remaining: number }>, slots: Array<{ startsAt: string, endsAt: string, remaining: number }> } };

export type QuoteBookingQueryVariables = Exact<{
  input: BookingRequestInput;
}>;


export type QuoteBookingQuery = { quoteBooking: { startsAt: string, endsAt: string, units: number, quantity: number, subtotal: string | null, discount: string | null, total: string | null, deposit: string | null, dueNow: string | null, balance: string | null, currency: string | null, payment: BookingPayment, available: boolean, occurrences: Array<{ startsAt: string, endsAt: string, available: boolean }>, lines: Array<{ label: string, unitPrice: string, quantity: number, amount: string }> } };

export type ShopperBookingFieldsFragment = { reference: string, status: BookingStatus, startsAt: string, endsAt: string, units: number, quantity: number, guestName: string, subtotal: string | null, discountTotal: string | null, couponCode: string | null, total: string | null, currency: string | null, depositAmount: string | null, balanceDue: string | null, balancePaid: boolean, paid: boolean, holdExpiresAt: string | null, canCancel: boolean, canPayBalance: boolean, createdAt: string, bookable: { slug: string, name: string, unit: BookingUnit }, occurrences: Array<{ reference: string, startsAt: string, endsAt: string, status: BookingStatus }> };

export type CreateBookingMutationVariables = Exact<{
  input: CreateBookingInput;
}>;


export type CreateBookingMutation = { createBooking: { accessToken: string, sessionToken: string | null, booking: { reference: string, status: BookingStatus, startsAt: string, endsAt: string, units: number, quantity: number, guestName: string, subtotal: string | null, discountTotal: string | null, couponCode: string | null, total: string | null, currency: string | null, depositAmount: string | null, balanceDue: string | null, balancePaid: boolean, paid: boolean, holdExpiresAt: string | null, canCancel: boolean, canPayBalance: boolean, createdAt: string, bookable: { slug: string, name: string, unit: BookingUnit }, occurrences: Array<{ reference: string, startsAt: string, endsAt: string, status: BookingStatus }> }, payment: { method: string, reference: string, checkoutUrl: string | null, bankTransfer: { bankName: string, accountName: string, accountNumber: string, instructions: string | null, amount: string, currency: string, reference: string, expiresAt: string } | null } | null } };

export type MyBookingQueryVariables = Exact<{
  token: string;
}>;


export type MyBookingQuery = { myBooking: { reference: string, status: BookingStatus, startsAt: string, endsAt: string, units: number, quantity: number, guestName: string, subtotal: string | null, discountTotal: string | null, couponCode: string | null, total: string | null, currency: string | null, depositAmount: string | null, balanceDue: string | null, balancePaid: boolean, paid: boolean, holdExpiresAt: string | null, canCancel: boolean, canPayBalance: boolean, createdAt: string, bookable: { slug: string, name: string, unit: BookingUnit }, occurrences: Array<{ reference: string, startsAt: string, endsAt: string, status: BookingStatus }> } };

export type CancelMyBookingMutationVariables = Exact<{
  token: string;
}>;


export type CancelMyBookingMutation = { cancelMyBooking: { reference: string, status: BookingStatus, startsAt: string, endsAt: string, units: number, quantity: number, guestName: string, subtotal: string | null, discountTotal: string | null, couponCode: string | null, total: string | null, currency: string | null, depositAmount: string | null, balanceDue: string | null, balancePaid: boolean, paid: boolean, holdExpiresAt: string | null, canCancel: boolean, canPayBalance: boolean, createdAt: string, bookable: { slug: string, name: string, unit: BookingUnit }, occurrences: Array<{ reference: string, startsAt: string, endsAt: string, status: BookingStatus }> } };

export type CustomerBookingsQueryVariables = Exact<{ [key: string]: never; }>;


export type CustomerBookingsQuery = { customerBookings: Array<{ reference: string, status: BookingStatus, startsAt: string, endsAt: string, units: number, quantity: number, guestName: string, subtotal: string | null, discountTotal: string | null, couponCode: string | null, total: string | null, currency: string | null, depositAmount: string | null, balanceDue: string | null, balancePaid: boolean, paid: boolean, holdExpiresAt: string | null, canCancel: boolean, canPayBalance: boolean, createdAt: string, bookable: { slug: string, name: string, unit: BookingUnit }, occurrences: Array<{ reference: string, startsAt: string, endsAt: string, status: BookingStatus }> }> };

export type PayBookingBalanceMutationVariables = Exact<{
  token: string;
  paymentMethod?: string | null | undefined;
}>;


export type PayBookingBalanceMutation = { payBookingBalance: { sessionToken: string, payment: { method: string, reference: string, checkoutUrl: string | null, bankTransfer: { bankName: string, accountName: string, accountNumber: string, instructions: string | null, amount: string, currency: string, reference: string, expiresAt: string } | null } } };

export type StorefrontPaymentMethodsQueryVariables = Exact<{ [key: string]: never; }>;


export type StorefrontPaymentMethodsQuery = { storefrontPaymentMethods: { online: boolean, bankTransfer: boolean } };

export type StorefrontFontCatalogQueryVariables = Exact<{ [key: string]: never; }>;


export type StorefrontFontCatalogQuery = { brandingCatalog: { fonts: Array<{ key: string, family: string, googleFamily: string }> } };

export type SubscribeToNewsletterMutationVariables = Exact<{
  input: NewsletterSignupInput;
}>;


export type SubscribeToNewsletterMutation = { subscribeToNewsletter: boolean };

export type SubmitReportMutationVariables = Exact<{
  input: SubmitReportInput;
}>;


export type SubmitReportMutation = { submitReport: boolean };

export class TypedDocumentString<TResult, TVariables>
  extends String
  implements DocumentTypeDecoration<TResult, TVariables>
{
  __apiType?: NonNullable<DocumentTypeDecoration<TResult, TVariables>['__apiType']>;
  private value: string;
  public __meta__?: Record<string, any> | undefined;

  constructor(value: string, __meta__?: Record<string, any> | undefined) {
    super(value);
    this.value = value;
    this.__meta__ = __meta__;
  }

  override toString(): string & DocumentTypeDecoration<TResult, TVariables> {
    return this.value;
  }
}
export const PaymentSessionFieldsFragmentDoc = new TypedDocumentString(`
    fragment PaymentSessionFields on PaymentSessionView {
  status
  resourceType
  amount
  currency
  methods
  method
  paymentReference
  expiresAt
  completedAt
  title
  merchant {
    name
    logoUrl
    primaryColor
    accentColor
    headingFont
    bodyFont
  }
  lines {
    description
    quantity
    amount
  }
  bankTransfer {
    bankName
    accountName
    accountNumber
    instructions
    reference
    submittedAt
    rejectionReason
  }
  cashOnDeliveryInstructions
}
    `, {"fragmentName":"PaymentSessionFields"}) as unknown as TypedDocumentString<PaymentSessionFieldsFragment, unknown>;
export const ListingCardFieldsFragmentDoc = new TypedDocumentString(`
    fragment ListingCardFields on PublicProperty {
  id
  slug
  title
  referenceCode
  category
  listingType
  status
  price
  priceOnRequest
  pricePeriod
  currency
  bedrooms
  bathrooms
  city
  stateRegion
  media {
    id
    url
    caption
    kind
    isFloorPlan
  }
}
    `, {"fragmentName":"ListingCardFields"}) as unknown as TypedDocumentString<ListingCardFieldsFragment, unknown>;
export const PageInfoFieldsFragmentDoc = new TypedDocumentString(`
    fragment PageInfoFields on PageInfo {
  nextCursor
  hasMore
  limit
}
    `, {"fragmentName":"PageInfoFields"}) as unknown as TypedDocumentString<PageInfoFieldsFragment, unknown>;
export const StorefrontProductCardFieldsFragmentDoc = new TypedDocumentString(`
    fragment StorefrontProductCardFields on StorefrontProduct {
  id
  slug
  title
  description
  media {
    id
    url
    altText
    kind
  }
  variants {
    id
    price
    compareAtPrice
    currency
    inStock
    lowStock
  }
}
    `, {"fragmentName":"StorefrontProductCardFields"}) as unknown as TypedDocumentString<StorefrontProductCardFieldsFragment, unknown>;
export const CartFieldsFragmentDoc = new TypedDocumentString(`
    fragment CartFields on Cart {
  currency
  propertyItems {
    propertyId
    slug
    title
    referenceCode
    imageUrl
    planId
    planKind
    planLabel
    dueNow
    balance
    schedule {
      sequence
      dueDate
      amount
    }
  }
  items {
    variantId
    sku
    productTitle
    productSlug
    imageUrl
    variantTitle
    quantity
    unitPrice
    lineTotal
  }
  subtotal
  discountTotal
  shippingTotal
  taxTotal
  total
}
    `, {"fragmentName":"CartFields"}) as unknown as TypedDocumentString<CartFieldsFragment, unknown>;
export const ShopperAddressFieldsFragmentDoc = new TypedDocumentString(`
    fragment ShopperAddressFields on CustomerAddress {
  id
  label
  recipientName
  phone
  line1
  line2
  city
  stateRegion
  postalCode
  countryCode
  isDefaultShipping
  isDefaultBilling
}
    `, {"fragmentName":"ShopperAddressFields"}) as unknown as TypedDocumentString<ShopperAddressFieldsFragment, unknown>;
export const StorefrontImageFieldsFragmentDoc = new TypedDocumentString(`
    fragment StorefrontImageFields on StorefrontImage {
  assetId
  url
  alt
}
    `, {"fragmentName":"StorefrontImageFields"}) as unknown as TypedDocumentString<StorefrontImageFieldsFragment, unknown>;
export const StorefrontHomePageFieldsFragmentDoc = new TypedDocumentString(`
    fragment StorefrontHomePageFields on StorefrontHomePage {
  announcement
  hero {
    layout
    slides {
      image {
        ...StorefrontImageFields
      }
      eyebrow
      headline
      subheading
      action {
        label
        href
      }
    }
    eyebrow
    headline
    highlight
    subheading
    primaryAction {
      label
      href
    }
    secondaryAction {
      label
      href
    }
    images {
      ...StorefrontImageFields
    }
    video {
      assetId
      url
    }
    badge {
      value
      label
    }
    showRating
  }
  stats {
    value
    label
  }
  sections {
    id
    kind
    layout
    visible
    eyebrow
    title
    body
    images {
      ...StorefrontImageFields
    }
    video {
      assetId
      url
    }
    link {
      label
      href
    }
    collectionSlug
    recordType
    itemLimit
  }
  updatedAt
}
    fragment StorefrontImageFields on StorefrontImage {
  assetId
  url
  alt
}`, {"fragmentName":"StorefrontHomePageFields"}) as unknown as TypedDocumentString<StorefrontHomePageFieldsFragment, unknown>;
export const StorefrontBookableFieldsFragmentDoc = new TypedDocumentString(`
    fragment StorefrontBookableFields on StorefrontBookable {
  id
  slug
  name
  description
  unit
  slotMinutes
  minUnits
  maxUnits
  maxQuantity
  checkInTime
  checkOutTime
  eventStartsAt
  eventEndsAt
  timezone
  payment
  confirmation
  cancellationHours
  depositPercent
  maxOccurrences
  price {
    amount
    currency
    per
  }
  priceRules {
    label
    weekdays
    startDate
    endDate
    amount
    currency
  }
  images {
    ...StorefrontImageFields
  }
  media {
    assetId
    kind
    url
    poster
  }
  rules {
    weekday
    startTime
    endTime
  }
}
    fragment StorefrontImageFields on StorefrontImage {
  assetId
  url
  alt
}`, {"fragmentName":"StorefrontBookableFields"}) as unknown as TypedDocumentString<StorefrontBookableFieldsFragment, unknown>;
export const ShopperBookingFieldsFragmentDoc = new TypedDocumentString(`
    fragment ShopperBookingFields on ShopperBooking {
  reference
  status
  bookable {
    slug
    name
    unit
  }
  startsAt
  endsAt
  units
  quantity
  guestName
  occurrences {
    reference
    startsAt
    endsAt
    status
  }
  subtotal
  discountTotal
  couponCode
  total
  currency
  depositAmount
  balanceDue
  balancePaid
  paid
  holdExpiresAt
  canCancel
  canPayBalance
  createdAt
}
    `, {"fragmentName":"ShopperBookingFields"}) as unknown as TypedDocumentString<ShopperBookingFieldsFragment, unknown>;
export const CartlySdkTypeAnchorsDocument = new TypedDocumentString(`
    query CartlySdkTypeAnchors($homePage: StorefrontHomePageInput) {
  __typename
}
    `) as unknown as TypedDocumentString<CartlySdkTypeAnchorsQuery, CartlySdkTypeAnchorsQueryVariables>;
export const ViewerDocument = new TypedDocumentString(`
    query Viewer {
  viewer {
    id
    email
    displayName
    emailVerified
    mfaEnabled
    businesses {
      id
      name
      slug
      status
      verticals
      roles {
        key
        name
      }
    }
  }
}
    `) as unknown as TypedDocumentString<ViewerQuery, ViewerQueryVariables>;
export const PaymentSessionDocument = new TypedDocumentString(`
    query PaymentSession($token: String!) {
  paymentSession(token: $token) {
    ...PaymentSessionFields
  }
}
    fragment PaymentSessionFields on PaymentSessionView {
  status
  resourceType
  amount
  currency
  methods
  method
  paymentReference
  expiresAt
  completedAt
  title
  merchant {
    name
    logoUrl
    primaryColor
    accentColor
    headingFont
    bodyFont
  }
  lines {
    description
    quantity
    amount
  }
  bankTransfer {
    bankName
    accountName
    accountNumber
    instructions
    reference
    submittedAt
    rejectionReason
  }
  cashOnDeliveryInstructions
}`) as unknown as TypedDocumentString<PaymentSessionQuery, PaymentSessionQueryVariables>;
export const RefreshPaymentSessionDocument = new TypedDocumentString(`
    mutation RefreshPaymentSession($token: String!) {
  refreshPaymentSession(token: $token) {
    ...PaymentSessionFields
  }
}
    fragment PaymentSessionFields on PaymentSessionView {
  status
  resourceType
  amount
  currency
  methods
  method
  paymentReference
  expiresAt
  completedAt
  title
  merchant {
    name
    logoUrl
    primaryColor
    accentColor
    headingFont
    bodyFont
  }
  lines {
    description
    quantity
    amount
  }
  bankTransfer {
    bankName
    accountName
    accountNumber
    instructions
    reference
    submittedAt
    rejectionReason
  }
  cashOnDeliveryInstructions
}`) as unknown as TypedDocumentString<RefreshPaymentSessionMutation, RefreshPaymentSessionMutationVariables>;
export const StartPaymentSessionDocument = new TypedDocumentString(`
    mutation StartPaymentSession($token: String!, $method: String!) {
  startPaymentSession(token: $token, method: $method) {
    checkoutUrl
  }
}
    `) as unknown as TypedDocumentString<StartPaymentSessionMutation, StartPaymentSessionMutationVariables>;
export const SubmitBankTransferProofDocument = new TypedDocumentString(`
    mutation SubmitBankTransferProof($token: String!, $input: BankTransferProofInput!) {
  submitBankTransferProof(token: $token, input: $input) {
    ...PaymentSessionFields
  }
}
    fragment PaymentSessionFields on PaymentSessionView {
  status
  resourceType
  amount
  currency
  methods
  method
  paymentReference
  expiresAt
  completedAt
  title
  merchant {
    name
    logoUrl
    primaryColor
    accentColor
    headingFont
    bodyFont
  }
  lines {
    description
    quantity
    amount
  }
  bankTransfer {
    bankName
    accountName
    accountNumber
    instructions
    reference
    submittedAt
    rejectionReason
  }
  cashOnDeliveryInstructions
}`) as unknown as TypedDocumentString<SubmitBankTransferProofMutation, SubmitBankTransferProofMutationVariables>;
export const ListingsDocument = new TypedDocumentString(`
    query Listings($filter: PublicPropertyFilter, $page: PageInput) {
  listings(filter: $filter, page: $page) {
    items {
      ...ListingCardFields
    }
    pageInfo {
      ...PageInfoFields
    }
  }
}
    fragment ListingCardFields on PublicProperty {
  id
  slug
  title
  referenceCode
  category
  listingType
  status
  price
  priceOnRequest
  pricePeriod
  currency
  bedrooms
  bathrooms
  city
  stateRegion
  media {
    id
    url
    caption
    kind
    isFloorPlan
  }
}
fragment PageInfoFields on PageInfo {
  nextCursor
  hasMore
  limit
}`) as unknown as TypedDocumentString<ListingsQuery, ListingsQueryVariables>;
export const ListingDocument = new TypedDocumentString(`
    query Listing($slug: String!) {
  listing(slug: $slug) {
    ...ListingCardFields
    description
    seoTitle
    seoDescription
    availableFrom
    condition
    furnishing
    floorAreaSqm
    landAreaSqm
    parkingSpaces
    toilets
    serviceCharge
    yearBuilt
    publishedAt
    propertyType {
      name
      slug
    }
    sellOnline
    purchasable
    paymentOptions {
      planId
      kind
      label
      description
      dueNow
      balance
      schedule {
        sequence
        dueDate
        amount
      }
    }
    documents {
      id
      title
      kind
      mimeType
      url
    }
    collectionIds
    categoryIds
  }
}
    fragment ListingCardFields on PublicProperty {
  id
  slug
  title
  referenceCode
  category
  listingType
  status
  price
  priceOnRequest
  pricePeriod
  currency
  bedrooms
  bathrooms
  city
  stateRegion
  media {
    id
    url
    caption
    kind
    isFloorPlan
  }
}`) as unknown as TypedDocumentString<ListingQuery, ListingQueryVariables>;
export const SubmitPropertyEnquiryDocument = new TypedDocumentString(`
    mutation SubmitPropertyEnquiry($input: PublicEnquiryInput!) {
  submitPropertyEnquiry(input: $input) {
    id
    status
  }
}
    `) as unknown as TypedDocumentString<SubmitPropertyEnquiryMutation, SubmitPropertyEnquiryMutationVariables>;
export const RequestPropertyViewingDocument = new TypedDocumentString(`
    mutation RequestPropertyViewing($input: PublicViewingInput!) {
  requestPropertyViewing(input: $input) {
    id
    status
  }
}
    `) as unknown as TypedDocumentString<RequestPropertyViewingMutation, RequestPropertyViewingMutationVariables>;
export const NearbyListingsDocument = new TypedDocumentString(`
    query NearbyListings($near: GeoNearInput!, $limit: Int) {
  nearbyListings(near: $near, limit: $limit) {
    distanceMeters
    listing {
      ...ListingCardFields
    }
  }
}
    fragment ListingCardFields on PublicProperty {
  id
  slug
  title
  referenceCode
  category
  listingType
  status
  price
  priceOnRequest
  pricePeriod
  currency
  bedrooms
  bathrooms
  city
  stateRegion
  media {
    id
    url
    caption
    kind
    isFloorPlan
  }
}`) as unknown as TypedDocumentString<NearbyListingsQuery, NearbyListingsQueryVariables>;
export const StorefrontSeoDocument = new TypedDocumentString(`
    query StorefrontSeo($input: SeoDocumentInput!) {
  storefrontSeo(input: $input) {
    title
    description
    canonicalUrl
    robots
    indexing
    jsonLdScript
    lastModified
    openGraph {
      type
      title
      description
      url
      siteName
      locale
      images {
        url
        width
        height
        alt
      }
    }
    twitter {
      card
      title
      description
      site
      image
      imageAlt
    }
    breadcrumbs {
      name
      url
    }
    verification {
      google
      bing
    }
  }
}
    `) as unknown as TypedDocumentString<StorefrontSeoQuery, StorefrontSeoQueryVariables>;
export const StorefrontSitemapDocument = new TypedDocumentString(`
    query StorefrontSitemap($name: String) {
  storefrontSitemap(name: $name) {
    contentType
    body
  }
}
    `) as unknown as TypedDocumentString<StorefrontSitemapQuery, StorefrontSitemapQueryVariables>;
export const StorefrontRobotsTxtDocument = new TypedDocumentString(`
    query StorefrontRobotsTxt {
  storefrontRobotsTxt {
    contentType
    body
  }
}
    `) as unknown as TypedDocumentString<StorefrontRobotsTxtQuery, StorefrontRobotsTxtQueryVariables>;
export const StorefrontLlmsTxtDocument = new TypedDocumentString(`
    query StorefrontLlmsTxt {
  storefrontLlmsTxt {
    contentType
    body
  }
}
    `) as unknown as TypedDocumentString<StorefrontLlmsTxtQuery, StorefrontLlmsTxtQueryVariables>;
export const StorefrontCanonicalHostDocument = new TypedDocumentString(`
    query StorefrontCanonicalHost($requestHost: String) {
  storefrontCanonicalHost(requestHost: $requestHost) {
    canonicalHost
    redirectTo
  }
}
    `) as unknown as TypedDocumentString<StorefrontCanonicalHostQuery, StorefrontCanonicalHostQueryVariables>;
export const StorefrontRoutingDocument = new TypedDocumentString(`
    query StorefrontRouting($requestHost: String) {
  storefrontCanonicalHost(requestHost: $requestHost) {
    businessSlug
    appKey
    canonicalHost
    redirectTo
    selfBuilt
  }
}
    `) as unknown as TypedDocumentString<StorefrontRoutingQuery, StorefrontRoutingQueryVariables>;
export const StorefrontRouteDocument = new TypedDocumentString(`
    query StorefrontRoute {
  storefrontRoute {
    renderer
    live
  }
}
    `) as unknown as TypedDocumentString<StorefrontRouteQuery, StorefrontRouteQueryVariables>;
export const StorefrontIndexNowKeyDocument = new TypedDocumentString(`
    query StorefrontIndexNowKey($key: String!) {
  storefrontIndexNowKey(key: $key) {
    contentType
    body
  }
}
    `) as unknown as TypedDocumentString<StorefrontIndexNowKeyQuery, StorefrontIndexNowKeyQueryVariables>;
export const StorefrontRedirectDocument = new TypedDocumentString(`
    query StorefrontRedirect($path: String!) {
  storefrontRedirect(path: $path) {
    location
    permanent
  }
}
    `) as unknown as TypedDocumentString<StorefrontRedirectQuery, StorefrontRedirectQueryVariables>;
export const StorefrontVisualPageDocument = new TypedDocumentString(`
    query StorefrontVisualPage($path: String!) {
  storefrontVisualPage(path: $path) {
    page {
      id
      kind
      path
      title
      seoTitle
      seoDescription
      noIndex
      socialImageUrl
    }
    document
    theme
    navigation {
      label
      href
    }
    data
    preview
  }
}
    `) as unknown as TypedDocumentString<StorefrontVisualPageQuery, StorefrontVisualPageQueryVariables>;
export const StorefrontVisualChromeDocument = new TypedDocumentString(`
    query StorefrontVisualChrome {
  storefrontVisualChrome {
    header
    footer
    theme
    navigation {
      label
      href
    }
    data
  }
}
    `) as unknown as TypedDocumentString<StorefrontVisualChromeQuery, StorefrontVisualChromeQueryVariables>;
export const StorefrontPagePreviewDocument = new TypedDocumentString(`
    query StorefrontPagePreview($token: String!) {
  storefrontPagePreview(token: $token) {
    page {
      id
      kind
      path
      title
      seoTitle
      seoDescription
      noIndex
      socialImageUrl
    }
    document
    header
    footer
    theme
    navigation {
      label
      href
    }
    data
    preview
  }
}
    `) as unknown as TypedDocumentString<StorefrontPagePreviewQuery, StorefrontPagePreviewQueryVariables>;
export const StorefrontProductsDocument = new TypedDocumentString(`
    query StorefrontProducts($filter: StorefrontProductFilter, $sort: StorefrontProductSort, $page: PageInput) {
  storefrontProducts(filter: $filter, sort: $sort, page: $page) {
    items {
      ...StorefrontProductCardFields
    }
    pageInfo {
      ...PageInfoFields
    }
  }
}
    fragment PageInfoFields on PageInfo {
  nextCursor
  hasMore
  limit
}
fragment StorefrontProductCardFields on StorefrontProduct {
  id
  slug
  title
  description
  media {
    id
    url
    altText
    kind
  }
  variants {
    id
    price
    compareAtPrice
    currency
    inStock
    lowStock
  }
}`) as unknown as TypedDocumentString<StorefrontProductsQuery, StorefrontProductsQueryVariables>;
export const StorefrontProductDocument = new TypedDocumentString(`
    query StorefrontProduct($slug: String!) {
  storefrontProduct(slug: $slug) {
    ...StorefrontProductCardFields
    description
    seoTitle
    seoDescription
    tags
    categoryIds
    attributes {
      code
      name
      value
    }
    variants {
      sku
      title
      options {
        name
        value
      }
    }
    options {
      name
      values
    }
    media {
      variantId
    }
  }
}
    fragment StorefrontProductCardFields on StorefrontProduct {
  id
  slug
  title
  description
  media {
    id
    url
    altText
    kind
  }
  variants {
    id
    price
    compareAtPrice
    currency
    inStock
    lowStock
  }
}`) as unknown as TypedDocumentString<StorefrontProductQuery, StorefrontProductQueryVariables>;
export const StorefrontCategoriesDocument = new TypedDocumentString(`
    query StorefrontCategories {
  storefrontCategories {
    id
    name
    slug
    parentId
    description
    imageUrl
    productCount
  }
}
    `) as unknown as TypedDocumentString<StorefrontCategoriesQuery, StorefrontCategoriesQueryVariables>;
export const CreateCartDocument = new TypedDocumentString(`
    mutation CreateCart {
  createCart {
    cartId
    cartToken
    currency
  }
}
    `) as unknown as TypedDocumentString<CreateCartMutation, CreateCartMutationVariables>;
export const CartDocument = new TypedDocumentString(`
    query Cart {
  cart {
    ...CartFields
  }
}
    fragment CartFields on Cart {
  currency
  propertyItems {
    propertyId
    slug
    title
    referenceCode
    imageUrl
    planId
    planKind
    planLabel
    dueNow
    balance
    schedule {
      sequence
      dueDate
      amount
    }
  }
  items {
    variantId
    sku
    productTitle
    productSlug
    imageUrl
    variantTitle
    quantity
    unitPrice
    lineTotal
  }
  subtotal
  discountTotal
  shippingTotal
  taxTotal
  total
}`) as unknown as TypedDocumentString<CartQuery, CartQueryVariables>;
export const PreviewCartCouponDocument = new TypedDocumentString(`
    query PreviewCartCoupon($code: String!, $email: String) {
  previewCartCoupon(code: $code, email: $email) {
    ...CartFields
  }
}
    fragment CartFields on Cart {
  currency
  propertyItems {
    propertyId
    slug
    title
    referenceCode
    imageUrl
    planId
    planKind
    planLabel
    dueNow
    balance
    schedule {
      sequence
      dueDate
      amount
    }
  }
  items {
    variantId
    sku
    productTitle
    productSlug
    imageUrl
    variantTitle
    quantity
    unitPrice
    lineTotal
  }
  subtotal
  discountTotal
  shippingTotal
  taxTotal
  total
}`) as unknown as TypedDocumentString<PreviewCartCouponQuery, PreviewCartCouponQueryVariables>;
export const SetCartItemDocument = new TypedDocumentString(`
    mutation SetCartItem($variantId: ID!, $quantity: Int!) {
  setCartItem(variantId: $variantId, quantity: $quantity) {
    ...CartFields
  }
}
    fragment CartFields on Cart {
  currency
  propertyItems {
    propertyId
    slug
    title
    referenceCode
    imageUrl
    planId
    planKind
    planLabel
    dueNow
    balance
    schedule {
      sequence
      dueDate
      amount
    }
  }
  items {
    variantId
    sku
    productTitle
    productSlug
    imageUrl
    variantTitle
    quantity
    unitPrice
    lineTotal
  }
  subtotal
  discountTotal
  shippingTotal
  taxTotal
  total
}`) as unknown as TypedDocumentString<SetCartItemMutation, SetCartItemMutationVariables>;
export const RemoveCartItemDocument = new TypedDocumentString(`
    mutation RemoveCartItem($variantId: ID!) {
  removeCartItem(variantId: $variantId) {
    ...CartFields
  }
}
    fragment CartFields on Cart {
  currency
  propertyItems {
    propertyId
    slug
    title
    referenceCode
    imageUrl
    planId
    planKind
    planLabel
    dueNow
    balance
    schedule {
      sequence
      dueDate
      amount
    }
  }
  items {
    variantId
    sku
    productTitle
    productSlug
    imageUrl
    variantTitle
    quantity
    unitPrice
    lineTotal
  }
  subtotal
  discountTotal
  shippingTotal
  taxTotal
  total
}`) as unknown as TypedDocumentString<RemoveCartItemMutation, RemoveCartItemMutationVariables>;
export const SetCartPropertyDocument = new TypedDocumentString(`
    mutation SetCartProperty($propertyId: ID!, $planId: ID) {
  setCartProperty(propertyId: $propertyId, planId: $planId) {
    ...CartFields
  }
}
    fragment CartFields on Cart {
  currency
  propertyItems {
    propertyId
    slug
    title
    referenceCode
    imageUrl
    planId
    planKind
    planLabel
    dueNow
    balance
    schedule {
      sequence
      dueDate
      amount
    }
  }
  items {
    variantId
    sku
    productTitle
    productSlug
    imageUrl
    variantTitle
    quantity
    unitPrice
    lineTotal
  }
  subtotal
  discountTotal
  shippingTotal
  taxTotal
  total
}`) as unknown as TypedDocumentString<SetCartPropertyMutation, SetCartPropertyMutationVariables>;
export const RemoveCartPropertyDocument = new TypedDocumentString(`
    mutation RemoveCartProperty($propertyId: ID!) {
  removeCartProperty(propertyId: $propertyId) {
    ...CartFields
  }
}
    fragment CartFields on Cart {
  currency
  propertyItems {
    propertyId
    slug
    title
    referenceCode
    imageUrl
    planId
    planKind
    planLabel
    dueNow
    balance
    schedule {
      sequence
      dueDate
      amount
    }
  }
  items {
    variantId
    sku
    productTitle
    productSlug
    imageUrl
    variantTitle
    quantity
    unitPrice
    lineTotal
  }
  subtotal
  discountTotal
  shippingTotal
  taxTotal
  total
}`) as unknown as TypedDocumentString<RemoveCartPropertyMutation, RemoveCartPropertyMutationVariables>;
export const StorefrontServiceCoverageDocument = new TypedDocumentString(`
    query StorefrontServiceCoverage($latitude: Float!, $longitude: Float!) {
  storefrontServiceCoverage(latitude: $latitude, longitude: $longitude) {
    enabled
    covered
    areas {
      id
      name
    }
  }
}
    `) as unknown as TypedDocumentString<StorefrontServiceCoverageQuery, StorefrontServiceCoverageQueryVariables>;
export const IntroductoryOfferDocument = new TypedDocumentString(`
    query IntroductoryOffer {
  introductoryOffer {
    available
    durationMonths
    package {
      key
      name
    }
  }
}
    `) as unknown as TypedDocumentString<IntroductoryOfferQuery, IntroductoryOfferQueryVariables>;
export const StorefrontCheckoutOptionsDocument = new TypedDocumentString(`
    query StorefrontCheckoutOptions {
  storefrontShippingMethods {
    id
    name
    description
    price
    currency
    rateType
    minOrderSubtotal
    estimatedMinDays
    estimatedMaxDays
    countryCodes
  }
  storefrontPaymentMethods {
    online
    bankTransfer
    cashOnDelivery
    cashOnDeliveryCountries
  }
}
    `) as unknown as TypedDocumentString<StorefrontCheckoutOptionsQuery, StorefrontCheckoutOptionsQueryVariables>;
export const CheckoutDocument = new TypedDocumentString(`
    mutation Checkout($input: CheckoutInput!) {
  checkout(input: $input) {
    orderId
    orderNumber
    total
    currency
    sessionToken
    payment {
      method
      checkoutUrl
      reference
      bankTransfer {
        bankName
        accountName
        accountNumber
        amount
        currency
        reference
        instructions
        expiresAt
      }
    }
  }
}
    `) as unknown as TypedDocumentString<CheckoutMutation, CheckoutMutationVariables>;
export const ContactBusinessDocument = new TypedDocumentString(`
    mutation ContactBusiness($input: CustomerConversationInput!) {
  contactBusiness(input: $input) {
    conversationId
    accessToken
  }
}
    `) as unknown as TypedDocumentString<ContactBusinessMutation, ContactBusinessMutationVariables>;
export const MyConversationDocument = new TypedDocumentString(`
    query MyConversation {
  myConversation {
    id
    subject
    status
    messages {
      id
      body
      createdAt
      senderType
      senderName
    }
  }
}
    `) as unknown as TypedDocumentString<MyConversationQuery, MyConversationQueryVariables>;
export const ReplyAsCustomerDocument = new TypedDocumentString(`
    mutation ReplyAsCustomer($body: String!) {
  replyAsCustomer(body: $body) {
    id
  }
}
    `) as unknown as TypedDocumentString<ReplyAsCustomerMutation, ReplyAsCustomerMutationVariables>;
export const RegisterCustomerDocument = new TypedDocumentString(`
    mutation RegisterCustomer($email: String!, $password: String!, $firstName: String, $lastName: String) {
  registerCustomer(
    email: $email
    password: $password
    firstName: $firstName
    lastName: $lastName
  )
}
    `) as unknown as TypedDocumentString<RegisterCustomerMutation, RegisterCustomerMutationVariables>;
export const VerifyCustomerEmailDocument = new TypedDocumentString(`
    mutation VerifyCustomerEmail($token: String!) {
  verifyCustomerEmail(token: $token)
}
    `) as unknown as TypedDocumentString<VerifyCustomerEmailMutation, VerifyCustomerEmailMutationVariables>;
export const StorefrontSignInProvidersDocument = new TypedDocumentString(`
    query StorefrontSignInProviders {
  storefrontSignInProviders
}
    `) as unknown as TypedDocumentString<StorefrontSignInProvidersQuery, StorefrontSignInProvidersQueryVariables>;
export const CustomerProviderSignInDocument = new TypedDocumentString(`
    mutation CustomerProviderSignIn($code: String!) {
  customerProviderSignIn(code: $code) {
    token
    expiresAt
  }
}
    `) as unknown as TypedDocumentString<CustomerProviderSignInMutation, CustomerProviderSignInMutationVariables>;
export const CustomerLoginDocument = new TypedDocumentString(`
    mutation CustomerLogin($email: String!, $password: String!) {
  customerLogin(email: $email, password: $password) {
    token
    expiresAt
  }
}
    `) as unknown as TypedDocumentString<CustomerLoginMutation, CustomerLoginMutationVariables>;
export const CustomerLogoutDocument = new TypedDocumentString(`
    mutation CustomerLogout {
  customerLogout
}
    `) as unknown as TypedDocumentString<CustomerLogoutMutation, CustomerLogoutMutationVariables>;
export const RequestCustomerPasswordResetDocument = new TypedDocumentString(`
    mutation RequestCustomerPasswordReset($email: String!) {
  requestCustomerPasswordReset(email: $email)
}
    `) as unknown as TypedDocumentString<RequestCustomerPasswordResetMutation, RequestCustomerPasswordResetMutationVariables>;
export const ResetCustomerPasswordDocument = new TypedDocumentString(`
    mutation ResetCustomerPassword($token: String!, $password: String!) {
  resetCustomerPassword(token: $token, password: $password)
}
    `) as unknown as TypedDocumentString<ResetCustomerPasswordMutation, ResetCustomerPasswordMutationVariables>;
export const CustomerAccountDocument = new TypedDocumentString(`
    query CustomerAccount {
  customerAccount {
    email
    firstName
    lastName
    phone
    createdAt
  }
  customerOrders {
    orderNumber
    status
    paymentStatus
    fulfillmentStatus
    currency
    total
    itemCount
    placedAt
  }
}
    `) as unknown as TypedDocumentString<CustomerAccountQuery, CustomerAccountQueryVariables>;
export const CustomerOrderHistoryDocument = new TypedDocumentString(`
    query CustomerOrderHistory($page: PageInput) {
  customerOrderHistory(page: $page) {
    items {
      orderNumber
      status
      paymentStatus
      fulfillmentStatus
      currency
      total
      itemCount
      placedAt
    }
    pageInfo {
      nextCursor
      hasMore
    }
  }
}
    `) as unknown as TypedDocumentString<CustomerOrderHistoryQuery, CustomerOrderHistoryQueryVariables>;
export const CustomerOrderDocument = new TypedDocumentString(`
    query CustomerOrder($orderNumber: Int!) {
  customerOrder(orderNumber: $orderNumber) {
    orderNumber
    status
    paymentStatus
    fulfillmentStatus
    placedAt
    currency
    subtotal
    discountTotal
    shippingTotal
    taxTotal
    total
    note
    paymentMethod
    shippingMethodName
    shippingAddress {
      recipientName
      phone
      line1
      line2
      city
      stateRegion
      postalCode
      countryCode
    }
    lines {
      productTitle
      variantTitle
      sku
      quantity
      unitPrice
      lineTotal
      productSlug
      propertySlug
      imageUrl
    }
    instalments {
      id
      title
      sequence
      count
      dueDate
      amount
      currency
      status
      paidAt
      canPay
    }
    events {
      kind
      at
    }
    canPay
  }
}
    `) as unknown as TypedDocumentString<CustomerOrderQuery, CustomerOrderQueryVariables>;
export const ResumeCustomerOrderPaymentDocument = new TypedDocumentString(`
    mutation ResumeCustomerOrderPayment($orderNumber: Int!) {
  resumeCustomerOrderPayment(orderNumber: $orderNumber)
}
    `) as unknown as TypedDocumentString<ResumeCustomerOrderPaymentMutation, ResumeCustomerOrderPaymentMutationVariables>;
export const PayCustomerInstalmentDocument = new TypedDocumentString(`
    mutation PayCustomerInstalment($orderNumber: Int!, $instalmentId: ID!, $paymentMethod: CheckoutPaymentMethod) {
  payCustomerInstalment(
    orderNumber: $orderNumber
    instalmentId: $instalmentId
    paymentMethod: $paymentMethod
  )
}
    `) as unknown as TypedDocumentString<PayCustomerInstalmentMutation, PayCustomerInstalmentMutationVariables>;
export const ShopperAddressesDocument = new TypedDocumentString(`
    query ShopperAddresses {
  shopperAddresses {
    ...ShopperAddressFields
  }
}
    fragment ShopperAddressFields on CustomerAddress {
  id
  label
  recipientName
  phone
  line1
  line2
  city
  stateRegion
  postalCode
  countryCode
  isDefaultShipping
  isDefaultBilling
}`) as unknown as TypedDocumentString<ShopperAddressesQuery, ShopperAddressesQueryVariables>;
export const SaveShopperAddressDocument = new TypedDocumentString(`
    mutation SaveShopperAddress($input: CustomerAddressInput!, $id: ID) {
  saveShopperAddress(input: $input, id: $id) {
    ...ShopperAddressFields
  }
}
    fragment ShopperAddressFields on CustomerAddress {
  id
  label
  recipientName
  phone
  line1
  line2
  city
  stateRegion
  postalCode
  countryCode
  isDefaultShipping
  isDefaultBilling
}`) as unknown as TypedDocumentString<SaveShopperAddressMutation, SaveShopperAddressMutationVariables>;
export const DeleteShopperAddressDocument = new TypedDocumentString(`
    mutation DeleteShopperAddress($id: ID!) {
  deleteShopperAddress(id: $id)
}
    `) as unknown as TypedDocumentString<DeleteShopperAddressMutation, DeleteShopperAddressMutationVariables>;
export const CustomerReviewsDocument = new TypedDocumentString(`
    query CustomerReviews($page: PageInput) {
  customerReviews(page: $page) {
    items {
      id
      rating
      title
      body
      status
      verifiedPurchase
      reply
      createdAt
      product {
        slug
        title
        imageUrl
      }
    }
    pageInfo {
      nextCursor
      hasMore
    }
  }
}
    `) as unknown as TypedDocumentString<CustomerReviewsQuery, CustomerReviewsQueryVariables>;
export const SavedItemsDocument = new TypedDocumentString(`
    query SavedItems($page: PageInput) {
  savedItems(page: $page) {
    items {
      kind
      slug
      title
      imageUrl
      price
      currency
      available
      savedAt
    }
    pageInfo {
      nextCursor
      hasMore
    }
  }
}
    `) as unknown as TypedDocumentString<SavedItemsQuery, SavedItemsQueryVariables>;
export const SaveItemDocument = new TypedDocumentString(`
    mutation SaveItem($kind: SavedItemKind!, $slug: String!) {
  saveItem(kind: $kind, slug: $slug) {
    kind
    slug
    saved
  }
}
    `) as unknown as TypedDocumentString<SaveItemMutation, SaveItemMutationVariables>;
export const UnsaveItemDocument = new TypedDocumentString(`
    mutation UnsaveItem($kind: SavedItemKind!, $slug: String!) {
  unsaveItem(kind: $kind, slug: $slug) {
    kind
    slug
    saved
  }
}
    `) as unknown as TypedDocumentString<UnsaveItemMutation, UnsaveItemMutationVariables>;
export const RequestCustomerEmailChangeDocument = new TypedDocumentString(`
    mutation RequestCustomerEmailChange($newEmail: String!, $password: String!) {
  requestCustomerEmailChange(newEmail: $newEmail, password: $password)
}
    `) as unknown as TypedDocumentString<RequestCustomerEmailChangeMutation, RequestCustomerEmailChangeMutationVariables>;
export const UpdateCustomerAccountDocument = new TypedDocumentString(`
    mutation UpdateCustomerAccount($firstName: String, $lastName: String, $phone: String) {
  updateCustomerAccount(firstName: $firstName, lastName: $lastName, phone: $phone) {
    firstName
    lastName
    phone
  }
}
    `) as unknown as TypedDocumentString<UpdateCustomerAccountMutation, UpdateCustomerAccountMutationVariables>;
export const ChangeCustomerPasswordDocument = new TypedDocumentString(`
    mutation ChangeCustomerPassword($currentPassword: String!, $newPassword: String!) {
  changeCustomerPassword(
    currentPassword: $currentPassword
    newPassword: $newPassword
  )
}
    `) as unknown as TypedDocumentString<ChangeCustomerPasswordMutation, ChangeCustomerPasswordMutationVariables>;
export const StorefrontCollectionsDocument = new TypedDocumentString(`
    query StorefrontCollections {
  storefrontCollections {
    id
    title
    slug
    description
    imageUrl
    productCount
  }
}
    `) as unknown as TypedDocumentString<StorefrontCollectionsQuery, StorefrontCollectionsQueryVariables>;
export const StorefrontCollectionDocument = new TypedDocumentString(`
    query StorefrontCollection($slug: String!) {
  storefrontCollection(slug: $slug) {
    id
    title
    slug
    description
    imageUrl
    productCount
    products {
      ...StorefrontProductCardFields
    }
  }
}
    fragment StorefrontProductCardFields on StorefrontProduct {
  id
  slug
  title
  description
  media {
    id
    url
    altText
    kind
  }
  variants {
    id
    price
    compareAtPrice
    currency
    inStock
    lowStock
  }
}`) as unknown as TypedDocumentString<StorefrontCollectionQuery, StorefrontCollectionQueryVariables>;
export const StorefrontProductReviewsDocument = new TypedDocumentString(`
    query StorefrontProductReviews($slug: String!, $page: PageInput) {
  storefrontProductReviews(slug: $slug, page: $page) {
    averageRating
    reviewCount
    distribution {
      rating
      count
    }
    page {
      items {
        id
        authorName
        rating
        title
        body
        verifiedPurchase
        reply
        createdAt
      }
      pageInfo {
        ...PageInfoFields
      }
    }
  }
}
    fragment PageInfoFields on PageInfo {
  nextCursor
  hasMore
  limit
}`) as unknown as TypedDocumentString<StorefrontProductReviewsQuery, StorefrontProductReviewsQueryVariables>;
export const SubmitProductReviewDocument = new TypedDocumentString(`
    mutation SubmitProductReview($slug: String!, $input: ProductReviewInput!) {
  submitProductReview(slug: $slug, input: $input) {
    id
    status
  }
}
    `) as unknown as TypedDocumentString<SubmitProductReviewMutation, SubmitProductReviewMutationVariables>;
export const StorefrontBrandDocument = new TypedDocumentString(`
    query StorefrontBrand($slug: String!) {
  publicBusinessBrand(slug: $slug) {
    businessName
    description
    primaryColor
    secondaryColor
    accentColor
    headingFont
    bodyFont
    logo {
      deliveryUrl
    }
  }
}
    `) as unknown as TypedDocumentString<StorefrontBrandQuery, StorefrontBrandQueryVariables>;
export const StorefrontProfileDocument = new TypedDocumentString(`
    query StorefrontProfile {
  storefrontProfile {
    name
    tagline
    description
    logoUrl
    contactEmail
    contactPhone
    whatsappPhone
    openingHours
    serviceArea
    address {
      line1
      line2
      city
      stateRegion
      postalCode
      countryCode
    }
    socialLinks {
      network
      url
    }
  }
}
    `) as unknown as TypedDocumentString<StorefrontProfileQuery, StorefrontProfileQueryVariables>;
export const StorefrontFeaturesDocument = new TypedDocumentString(`
    query StorefrontFeatures {
  storefrontFeatures {
    currency
    countryCode
    capabilities
    businessTypes {
      key
      name
      categoryKey
    }
  }
}
    `) as unknown as TypedDocumentString<StorefrontFeaturesQuery, StorefrontFeaturesQueryVariables>;
export const StorefrontHomePageDocument = new TypedDocumentString(`
    query StorefrontHomePage {
  storefrontHomePage {
    ...StorefrontHomePageFields
  }
}
    fragment StorefrontImageFields on StorefrontImage {
  assetId
  url
  alt
}
fragment StorefrontHomePageFields on StorefrontHomePage {
  announcement
  hero {
    layout
    slides {
      image {
        ...StorefrontImageFields
      }
      eyebrow
      headline
      subheading
      action {
        label
        href
      }
    }
    eyebrow
    headline
    highlight
    subheading
    primaryAction {
      label
      href
    }
    secondaryAction {
      label
      href
    }
    images {
      ...StorefrontImageFields
    }
    video {
      assetId
      url
    }
    badge {
      value
      label
    }
    showRating
  }
  stats {
    value
    label
  }
  sections {
    id
    kind
    layout
    visible
    eyebrow
    title
    body
    images {
      ...StorefrontImageFields
    }
    video {
      assetId
      url
    }
    link {
      label
      href
    }
    collectionSlug
    recordType
    itemLimit
  }
  updatedAt
}`) as unknown as TypedDocumentString<StorefrontHomePageQuery, StorefrontHomePageQueryVariables>;
export const StorefrontPageDocument = new TypedDocumentString(`
    query StorefrontPage($path: String!) {
  storefrontPage(path: $path) {
    path
    kind
    title
    summary
    body
    images {
      ...StorefrontImageFields
    }
    faq {
      question
      answer
    }
    updatedAt
  }
}
    fragment StorefrontImageFields on StorefrontImage {
  assetId
  url
  alt
}`) as unknown as TypedDocumentString<StorefrontPageQuery, StorefrontPageQueryVariables>;
export const StorefrontPagesDocument = new TypedDocumentString(`
    query StorefrontPages($filter: StorefrontPageFilter, $page: PageInput) {
  storefrontPages(filter: $filter, page: $page) {
    items {
      path
      kind
      title
      summary
      authorName
      publishedAt
      image {
        ...StorefrontImageFields
      }
    }
    pageInfo {
      hasMore
      nextCursor
    }
  }
}
    fragment StorefrontImageFields on StorefrontImage {
  assetId
  url
  alt
}`) as unknown as TypedDocumentString<StorefrontPagesQuery, StorefrontPagesQueryVariables>;
export const StorefrontReviewsDocument = new TypedDocumentString(`
    query StorefrontReviews($page: PageInput) {
  storefrontReviews(page: $page) {
    items {
      id
      authorName
      rating
      title
      body
      reply
      verifiedPurchase
      createdAt
      product {
        slug
        title
        imageUrl
      }
    }
    pageInfo {
      ...PageInfoFields
    }
  }
  storefrontRatingSummary {
    averageRating
    reviewCount
    distribution {
      rating
      count
    }
  }
}
    fragment PageInfoFields on PageInfo {
  nextCursor
  hasMore
  limit
}`) as unknown as TypedDocumentString<StorefrontReviewsQuery, StorefrontReviewsQueryVariables>;
export const StorefrontRecordTypesDocument = new TypedDocumentString(`
    query StorefrontRecordTypes {
  storefrontRecordTypes {
    key
    name
    description
    access
    fields {
      key
      label
      type
      description
      required
      filterable
      searchable
      options {
        value
        label
      }
      min
      max
      referenceTo
    }
  }
}
    `) as unknown as TypedDocumentString<StorefrontRecordTypesQuery, StorefrontRecordTypesQueryVariables>;
export const StorefrontRecordsDocument = new TypedDocumentString(`
    query StorefrontRecords($type: String!, $filters: [EntityRecordFilterInput!], $q: String, $page: PageInput) {
  storefrontRecords(type: $type, filters: $filters, q: $q, page: $page) {
    items {
      id
      type
      data
      createdAt
      updatedAt
    }
    pageInfo {
      ...PageInfoFields
    }
  }
}
    fragment PageInfoFields on PageInfo {
  nextCursor
  hasMore
  limit
}`) as unknown as TypedDocumentString<StorefrontRecordsQuery, StorefrontRecordsQueryVariables>;
export const StorefrontRecordDocument = new TypedDocumentString(`
    query StorefrontRecord($type: String!, $id: ID!) {
  storefrontRecord(type: $type, id: $id) {
    id
    type
    data
    createdAt
    updatedAt
  }
}
    `) as unknown as TypedDocumentString<StorefrontRecordQuery, StorefrontRecordQueryVariables>;
export const SubmitStorefrontRecordDocument = new TypedDocumentString(`
    mutation SubmitStorefrontRecord($type: String!, $data: JSON!) {
  submitStorefrontRecord(type: $type, data: $data) {
    id
    type
    createdAt
  }
}
    `) as unknown as TypedDocumentString<SubmitStorefrontRecordMutation, SubmitStorefrontRecordMutationVariables>;
export const PaymentSessionActivityDocument = new TypedDocumentString(`
    subscription PaymentSessionActivity($token: String!) {
  paymentSessionActivity(token: $token) {
    kind
    at
  }
}
    `) as unknown as TypedDocumentString<PaymentSessionActivitySubscription, PaymentSessionActivitySubscriptionVariables>;
export const MyStorefrontRecordsDocument = new TypedDocumentString(`
    query MyStorefrontRecords($type: String) {
  myStorefrontRecords(type: $type) {
    id
    type
    typeName
    data
    progress {
      field
      label
      value
      valueLabel
    }
    archived
    createdAt
    updatedAt
  }
}
    `) as unknown as TypedDocumentString<MyStorefrontRecordsQuery, MyStorefrontRecordsQueryVariables>;
export const StorefrontBookablesDocument = new TypedDocumentString(`
    query StorefrontBookables {
  storefrontBookables {
    ...StorefrontBookableFields
  }
}
    fragment StorefrontImageFields on StorefrontImage {
  assetId
  url
  alt
}
fragment StorefrontBookableFields on StorefrontBookable {
  id
  slug
  name
  description
  unit
  slotMinutes
  minUnits
  maxUnits
  maxQuantity
  checkInTime
  checkOutTime
  eventStartsAt
  eventEndsAt
  timezone
  payment
  confirmation
  cancellationHours
  depositPercent
  maxOccurrences
  price {
    amount
    currency
    per
  }
  priceRules {
    label
    weekdays
    startDate
    endDate
    amount
    currency
  }
  images {
    ...StorefrontImageFields
  }
  media {
    assetId
    kind
    url
    poster
  }
  rules {
    weekday
    startTime
    endTime
  }
}`) as unknown as TypedDocumentString<StorefrontBookablesQuery, StorefrontBookablesQueryVariables>;
export const StorefrontBookableDocument = new TypedDocumentString(`
    query StorefrontBookable($slug: String!) {
  storefrontBookable(slug: $slug) {
    ...StorefrontBookableFields
  }
}
    fragment StorefrontImageFields on StorefrontImage {
  assetId
  url
  alt
}
fragment StorefrontBookableFields on StorefrontBookable {
  id
  slug
  name
  description
  unit
  slotMinutes
  minUnits
  maxUnits
  maxQuantity
  checkInTime
  checkOutTime
  eventStartsAt
  eventEndsAt
  timezone
  payment
  confirmation
  cancellationHours
  depositPercent
  maxOccurrences
  price {
    amount
    currency
    per
  }
  priceRules {
    label
    weekdays
    startDate
    endDate
    amount
    currency
  }
  images {
    ...StorefrontImageFields
  }
  media {
    assetId
    kind
    url
    poster
  }
  rules {
    weekday
    startTime
    endTime
  }
}`) as unknown as TypedDocumentString<StorefrontBookableQuery, StorefrontBookableQueryVariables>;
export const BookableAvailabilityDocument = new TypedDocumentString(`
    query BookableAvailability($slug: String!, $from: String!, $to: String!) {
  bookableAvailability(slug: $slug, from: $from, to: $to) {
    unit
    days {
      date
      remaining
    }
    slots {
      startsAt
      endsAt
      remaining
    }
  }
}
    `) as unknown as TypedDocumentString<BookableAvailabilityQuery, BookableAvailabilityQueryVariables>;
export const QuoteBookingDocument = new TypedDocumentString(`
    query QuoteBooking($input: BookingRequestInput!) {
  quoteBooking(input: $input) {
    startsAt
    endsAt
    units
    quantity
    occurrences {
      startsAt
      endsAt
      available
    }
    lines {
      label
      unitPrice
      quantity
      amount
    }
    subtotal
    discount
    total
    deposit
    dueNow
    balance
    currency
    payment
    available
  }
}
    `) as unknown as TypedDocumentString<QuoteBookingQuery, QuoteBookingQueryVariables>;
export const CreateBookingDocument = new TypedDocumentString(`
    mutation CreateBooking($input: CreateBookingInput!) {
  createBooking(input: $input) {
    accessToken
    sessionToken
    booking {
      ...ShopperBookingFields
    }
    payment {
      method
      reference
      checkoutUrl
      bankTransfer {
        bankName
        accountName
        accountNumber
        instructions
        amount
        currency
        reference
        expiresAt
      }
    }
  }
}
    fragment ShopperBookingFields on ShopperBooking {
  reference
  status
  bookable {
    slug
    name
    unit
  }
  startsAt
  endsAt
  units
  quantity
  guestName
  occurrences {
    reference
    startsAt
    endsAt
    status
  }
  subtotal
  discountTotal
  couponCode
  total
  currency
  depositAmount
  balanceDue
  balancePaid
  paid
  holdExpiresAt
  canCancel
  canPayBalance
  createdAt
}`) as unknown as TypedDocumentString<CreateBookingMutation, CreateBookingMutationVariables>;
export const MyBookingDocument = new TypedDocumentString(`
    query MyBooking($token: String!) {
  myBooking(token: $token) {
    ...ShopperBookingFields
  }
}
    fragment ShopperBookingFields on ShopperBooking {
  reference
  status
  bookable {
    slug
    name
    unit
  }
  startsAt
  endsAt
  units
  quantity
  guestName
  occurrences {
    reference
    startsAt
    endsAt
    status
  }
  subtotal
  discountTotal
  couponCode
  total
  currency
  depositAmount
  balanceDue
  balancePaid
  paid
  holdExpiresAt
  canCancel
  canPayBalance
  createdAt
}`) as unknown as TypedDocumentString<MyBookingQuery, MyBookingQueryVariables>;
export const CancelMyBookingDocument = new TypedDocumentString(`
    mutation CancelMyBooking($token: String!) {
  cancelMyBooking(token: $token) {
    ...ShopperBookingFields
  }
}
    fragment ShopperBookingFields on ShopperBooking {
  reference
  status
  bookable {
    slug
    name
    unit
  }
  startsAt
  endsAt
  units
  quantity
  guestName
  occurrences {
    reference
    startsAt
    endsAt
    status
  }
  subtotal
  discountTotal
  couponCode
  total
  currency
  depositAmount
  balanceDue
  balancePaid
  paid
  holdExpiresAt
  canCancel
  canPayBalance
  createdAt
}`) as unknown as TypedDocumentString<CancelMyBookingMutation, CancelMyBookingMutationVariables>;
export const CustomerBookingsDocument = new TypedDocumentString(`
    query CustomerBookings {
  customerBookings {
    ...ShopperBookingFields
  }
}
    fragment ShopperBookingFields on ShopperBooking {
  reference
  status
  bookable {
    slug
    name
    unit
  }
  startsAt
  endsAt
  units
  quantity
  guestName
  occurrences {
    reference
    startsAt
    endsAt
    status
  }
  subtotal
  discountTotal
  couponCode
  total
  currency
  depositAmount
  balanceDue
  balancePaid
  paid
  holdExpiresAt
  canCancel
  canPayBalance
  createdAt
}`) as unknown as TypedDocumentString<CustomerBookingsQuery, CustomerBookingsQueryVariables>;
export const PayBookingBalanceDocument = new TypedDocumentString(`
    mutation PayBookingBalance($token: String!, $paymentMethod: String) {
  payBookingBalance(token: $token, paymentMethod: $paymentMethod) {
    sessionToken
    payment {
      method
      reference
      checkoutUrl
      bankTransfer {
        bankName
        accountName
        accountNumber
        instructions
        amount
        currency
        reference
        expiresAt
      }
    }
  }
}
    `) as unknown as TypedDocumentString<PayBookingBalanceMutation, PayBookingBalanceMutationVariables>;
export const StorefrontPaymentMethodsDocument = new TypedDocumentString(`
    query StorefrontPaymentMethods {
  storefrontPaymentMethods {
    online
    bankTransfer
  }
}
    `) as unknown as TypedDocumentString<StorefrontPaymentMethodsQuery, StorefrontPaymentMethodsQueryVariables>;
export const StorefrontFontCatalogDocument = new TypedDocumentString(`
    query StorefrontFontCatalog {
  brandingCatalog {
    fonts {
      key
      family
      googleFamily
    }
  }
}
    `) as unknown as TypedDocumentString<StorefrontFontCatalogQuery, StorefrontFontCatalogQueryVariables>;
export const SubscribeToNewsletterDocument = new TypedDocumentString(`
    mutation SubscribeToNewsletter($input: NewsletterSignupInput!) {
  subscribeToNewsletter(input: $input)
}
    `) as unknown as TypedDocumentString<SubscribeToNewsletterMutation, SubscribeToNewsletterMutationVariables>;
export const SubmitReportDocument = new TypedDocumentString(`
    mutation SubmitReport($input: SubmitReportInput!) {
  submitReport(input: $input)
}
    `) as unknown as TypedDocumentString<SubmitReportMutation, SubmitReportMutationVariables>;