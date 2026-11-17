import { graphql } from "../gql"

/*
 * Public storefront operations. They need `storefrontHost` in the request
 * context; cart operations also need `cartToken`. Call them from the server
 * (the API's CORS allow-list does not include merchant domains).
 */

export const PageInfoFields = graphql(`
  fragment PageInfoFields on PageInfo {
    nextCursor
    hasMore
    limit
  }
`)

export const StorefrontProductCardFields = graphql(`
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
`)

export const StorefrontProductsQuery = graphql(`
  query StorefrontProducts(
    $filter: StorefrontProductFilter
    $sort: StorefrontProductSort
    $page: PageInput
  ) {
    storefrontProducts(filter: $filter, sort: $sort, page: $page) {
      items {
        ...StorefrontProductCardFields
      }
      pageInfo {
        ...PageInfoFields
      }
    }
  }
`)

export const StorefrontProductQuery = graphql(`
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
`)

export const StorefrontCategoriesQuery = graphql(`
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
`)

export const CartFields = graphql(`
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
`)

/** Returns the secret `cartToken`: store it server-side only. */
export const CreateCartMutation = graphql(`
  mutation CreateCart {
    createCart {
      cartId
      cartToken
      currency
    }
  }
`)

export const CartQuery = graphql(`
  query Cart {
    cart {
      ...CartFields
    }
  }
`)

/**
 * The cart repriced with a coupon, before checkout (UNPROCESSABLE when the
 * code doesn't apply). Nothing is redeemed. Needs `cartToken`.
 */
export const PreviewCartCouponQuery = graphql(`
  query PreviewCartCoupon($code: String!, $email: String) {
    previewCartCoupon(code: $code, email: $email) {
      ...CartFields
    }
  }
`)

export const SetCartItemMutation = graphql(`
  mutation SetCartItem($variantId: ID!, $quantity: Int!) {
    setCartItem(variantId: $variantId, quantity: $quantity) {
      ...CartFields
    }
  }
`)

export const RemoveCartItemMutation = graphql(`
  mutation RemoveCartItem($variantId: ID!) {
    removeCartItem(variantId: $variantId) {
      ...CartFields
    }
  }
`)

/**
 * Puts a property in the cart on one of its `paymentOptions` (planId null:
 * paid in full when the merchant set no plan), or changes the plan.
 * CONFLICT when it can't be bought on that plan.
 */
export const SetCartPropertyMutation = graphql(`
  mutation SetCartProperty($propertyId: ID!, $planId: ID) {
    setCartProperty(propertyId: $propertyId, planId: $planId) {
      ...CartFields
    }
  }
`)

export const RemoveCartPropertyMutation = graphql(`
  mutation RemoveCartProperty($propertyId: ID!) {
    removeCartProperty(propertyId: $propertyId) {
      ...CartFields
    }
  }
`)

/** Whether the business serves (delivers to) a point. `enabled` is false when it does not use service areas. */
export const StorefrontServiceCoverageQuery = graphql(`
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
`)

/** The free introductory period new clients receive (pricing pages). */
export const IntroductoryOfferQuery = graphql(`
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
`)

export const StorefrontCheckoutOptionsQuery = graphql(`
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
`)

/**
 * Places the order and starts payment. Needs `cartToken` and an
 * `idempotencyKey` (reuse the key when retrying the same submission).
 */
export const CheckoutMutation = graphql(`
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
`)

/** A shopper's message to the business (contact forms). Rate limited. */
export const ContactBusinessMutation = graphql(`
  mutation ContactBusiness($input: CustomerConversationInput!) {
    contactBusiness(input: $input) {
      conversationId
      accessToken
    }
  }
`)

/** The shopper's conversation with the business (needs `conversationToken`). */
export const MyConversationQuery = graphql(`
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
`)

export const ReplyAsCustomerMutation = graphql(`
  mutation ReplyAsCustomer($body: String!) {
    replyAsCustomer(body: $body) {
      id
    }
  }
`)

/*
 * Shopper accounts. Call from the store's server with `storefrontHost`;
 * signed-in operations also need `customerToken` (kept in an HttpOnly cookie
 * on the store's domain, never readable by page scripts).
 */

/** Always true: the email tells the address owner what happens next. */
export const RegisterCustomerMutation = graphql(`
  mutation RegisterCustomer(
    $email: String!
    $password: String!
    $firstName: String
    $lastName: String
  ) {
    registerCustomer(
      email: $email
      password: $password
      firstName: $firstName
      lastName: $lastName
    )
  }
`)

export const VerifyCustomerEmailMutation = graphql(`
  mutation VerifyCustomerEmail($token: String!) {
    verifyCustomerEmail(token: $token)
  }
`)

/** Returns the secret session token: store it server-side only. */
/** Shopper sign-in methods switched on besides email and password ("google", "apple"). Storefront auth: never ask /api/v1/auth. */
export const StorefrontSignInProvidersQuery = graphql(`
  query StorefrontSignInProviders {
    storefrontSignInProviders
  }
`)

/** Finishes Google/Apple sign-in: trades the one-time code from the API's redirect for a session. */
export const CustomerProviderSignInMutation = graphql(`
  mutation CustomerProviderSignIn($code: String!) {
    customerProviderSignIn(code: $code) {
      token
      expiresAt
    }
  }
`)

export const CustomerLoginMutation = graphql(`
  mutation CustomerLogin($email: String!, $password: String!) {
    customerLogin(email: $email, password: $password) {
      token
      expiresAt
    }
  }
`)

export const CustomerLogoutMutation = graphql(`
  mutation CustomerLogout {
    customerLogout
  }
`)

export const RequestCustomerPasswordResetMutation = graphql(`
  mutation RequestCustomerPasswordReset($email: String!) {
    requestCustomerPasswordReset(email: $email)
  }
`)

export const ResetCustomerPasswordMutation = graphql(`
  mutation ResetCustomerPassword($token: String!, $password: String!) {
    resetCustomerPassword(token: $token, password: $password)
  }
`)

export const CustomerAccountQuery = graphql(`
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
`)

/** All of the signed-in shopper's orders, newest first, a page at a time. */
export const CustomerOrderHistoryQuery = graphql(`
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
`)

/** One of the signed-in shopper's orders in full; NOT_FOUND for anyone else's. */
export const CustomerOrderQuery = graphql(`
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
`)

/**
 * A payment session token for one of the shopper's unpaid orders (see
 * `canPay`). Keep it in the payment-session cookie and open /checkout/pay,
 * exactly as after checkout.
 */
export const ResumeCustomerOrderPaymentMutation = graphql(`
  mutation ResumeCustomerOrderPayment($orderNumber: Int!) {
    resumeCustomerOrderPayment(orderNumber: $orderNumber)
  }
`)

/**
 * A payment session token for the next instalment due on a property the
 * shopper bought on a plan (see `instalments[].canPay`). Keep it like
 * checkout's and open /checkout/pay.
 */
export const PayCustomerInstalmentMutation = graphql(`
  mutation PayCustomerInstalment(
    $orderNumber: Int!
    $instalmentId: ID!
    $paymentMethod: CheckoutPaymentMethod
  ) {
    payCustomerInstalment(
      orderNumber: $orderNumber
      instalmentId: $instalmentId
      paymentMethod: $paymentMethod
    )
  }
`)

export const ShopperAddressFields = graphql(`
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
`)

/** The signed-in shopper's saved addresses, default shipping first (at most 20). */
export const ShopperAddressesQuery = graphql(`
  query ShopperAddresses {
    shopperAddresses {
      ...ShopperAddressFields
    }
  }
`)

/** A new address (without id) or a replacement for one of the shopper's. */
export const SaveShopperAddressMutation = graphql(`
  mutation SaveShopperAddress($input: CustomerAddressInput!, $id: ID) {
    saveShopperAddress(input: $input, id: $id) {
      ...ShopperAddressFields
    }
  }
`)

export const DeleteShopperAddressMutation = graphql(`
  mutation DeleteShopperAddress($id: ID!) {
    deleteShopperAddress(id: $id)
  }
`)

/** The signed-in shopper's own reviews, newest first, in any status. */
export const CustomerReviewsQuery = graphql(`
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
`)

/** The signed-in shopper's saved products and properties, newest first, as cards. */
export const SavedItemsQuery = graphql(`
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
`)

/** Idempotent; NOT_FOUND when it isn't on sale or published. */
export const SaveItemMutation = graphql(`
  mutation SaveItem($kind: SavedItemKind!, $slug: String!) {
    saveItem(kind: $kind, slug: $slug) {
      kind
      slug
      saved
    }
  }
`)

export const UnsaveItemMutation = graphql(`
  mutation UnsaveItem($kind: SavedItemKind!, $slug: String!) {
    unsaveItem(kind: $kind, slug: $slug) {
      kind
      slug
      saved
    }
  }
`)

/**
 * Emails a link to the new address (to /verify-email); the change happens
 * when it is used. Same answer whether or not the address is in use.
 */
export const RequestCustomerEmailChangeMutation = graphql(`
  mutation RequestCustomerEmailChange($newEmail: String!, $password: String!) {
    requestCustomerEmailChange(newEmail: $newEmail, password: $password)
  }
`)

export const UpdateCustomerAccountMutation = graphql(`
  mutation UpdateCustomerAccount(
    $firstName: String
    $lastName: String
    $phone: String
  ) {
    updateCustomerAccount(
      firstName: $firstName
      lastName: $lastName
      phone: $phone
    ) {
      firstName
      lastName
      phone
    }
  }
`)

export const ChangeCustomerPasswordMutation = graphql(`
  mutation ChangeCustomerPassword(
    $currentPassword: String!
    $newPassword: String!
  ) {
    changeCustomerPassword(
      currentPassword: $currentPassword
      newPassword: $newPassword
    )
  }
`)

export const StorefrontCollectionsQuery = graphql(`
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
`)

export const StorefrontCollectionQuery = graphql(`
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
`)

export const StorefrontProductReviewsQuery = graphql(`
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
`)

export const SubmitProductReviewMutation = graphql(`
  mutation SubmitProductReview($slug: String!, $input: ProductReviewInput!) {
    submitProductReview(slug: $slug, input: $input) {
      id
      status
    }
  }
`)

/**
 * A store's public brand: name, description, logo and colours (the
 * business's brand settings). Public; the store passes its own slug.
 */
export const StorefrontBrandQuery = graphql(`
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
`)

/*
 * Storefront content: one set of operations for every store, whatever the
 * business sells (see docs/STOREFRONT_API.md). Public, `storefrontHost`
 * only; NOT_FOUND until the storefront is published on an active domain.
 */

/** Contact details, opening hours, WhatsApp and social links (header, footer, contact page). */
export const StorefrontProfileQuery = graphql(`
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
`)

/** What this store offers: business types and active shopper-facing capabilities. */
export const StorefrontFeaturesQuery = graphql(`
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
`)

export const StorefrontImageFields = graphql(`
  fragment StorefrontImageFields on StorefrontImage {
    assetId
    url
    alt
  }
`)

export const StorefrontHomePageFields = graphql(`
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
`)

/** The home page shoppers see (visible sections only); empty until the business saves one. */
export const StorefrontHomePageQuery = graphql(`
  query StorefrontHomePage {
    storefrontHomePage {
      ...StorefrontHomePageFields
    }
  }
`)

/** A published content page (About, policies, FAQ) by path; NOT_FOUND otherwise. */
export const StorefrontPageQuery = graphql(`
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
`)

/**
 * Published content pages without their body, newest first: a journal, blog
 * or guides index. Filter by kind (ARTICLE) and a path prefix (/journal/).
 */
export const StorefrontPagesQuery = graphql(`
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
`)

/** Published reviews of every product on sale (newest first) and the store's rating. */
export const StorefrontReviewsQuery = graphql(`
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
`)

/** Record types this store lists (PUBLISHED) or takes submissions for (SUBMISSIONS), with their public fields. */
export const StorefrontRecordTypesQuery = graphql(`
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
`)

/** Active records of a PUBLISHED record type (a menu, courses, classes), public fields only. */
export const StorefrontRecordsQuery = graphql(`
  query StorefrontRecords(
    $type: String!
    $filters: [EntityRecordFilterInput!]
    $q: String
    $page: PageInput
  ) {
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
`)

export const StorefrontRecordQuery = graphql(`
  query StorefrontRecord($type: String!, $id: ID!) {
    storefrontRecord(type: $type, id: $id) {
      id
      type
      data
      createdAt
      updatedAt
    }
  }
`)

/** A shopper's form (reservation, appointment or enrolment request) for a SUBMISSIONS record type. */
export const SubmitStorefrontRecordMutation = graphql(`
  mutation SubmitStorefrontRecord($type: String!, $data: JSON!) {
    submitStorefrontRecord(type: $type, data: $data) {
      id
      type
      createdAt
    }
  }
`)

/** Live changes to the order a payment session pays for (WebSocket; refetch the session on each event). */
export const PaymentSessionActivitySubscription = graphql(`
  subscription PaymentSessionActivity($token: String!) {
    paymentSessionActivity(token: $token) {
      kind
      at
    }
  }
`)

/** A signed-in shopper's own form submissions (X-Customer-Token), with the business's progress. */
export const MyStorefrontRecordsQuery = graphql(`
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
`)

/*
 * Bookings (capability core.bookings): stays by the night, appointments and
 * classes by the slot, courses and events by the seat. See
 * docs/STOREFRONT_API.md#bookings.
 */

export const StorefrontBookableFields = graphql(`
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
`)

export const StorefrontBookablesQuery = graphql(`
  query StorefrontBookables {
    storefrontBookables {
      ...StorefrontBookableFields
    }
  }
`)

export const StorefrontBookableQuery = graphql(`
  query StorefrontBookable($slug: String!) {
    storefrontBookable(slug: $slug) {
      ...StorefrontBookableFields
    }
  }
`)

/** Free nights (`days`) or slots between two local dates (at most 62 days). */
export const BookableAvailabilityQuery = graphql(`
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
`)

export const QuoteBookingQuery = graphql(`
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
`)

export const ShopperBookingFields = graphql(`
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
`)

/** Needs `idempotencyKey` (and `customerToken` to link it to the shopper). */
export const CreateBookingMutation = graphql(`
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
`)

export const MyBookingQuery = graphql(`
  query MyBooking($token: String!) {
    myBooking(token: $token) {
      ...ShopperBookingFields
    }
  }
`)

export const CancelMyBookingMutation = graphql(`
  mutation CancelMyBooking($token: String!) {
    cancelMyBooking(token: $token) {
      ...ShopperBookingFields
    }
  }
`)

export const CustomerBookingsQuery = graphql(`
  query CustomerBookings {
    customerBookings {
      ...ShopperBookingFields
    }
  }
`)

/** Pays the balance of a deposit booking (canPayBalance) through a new payment session. */
export const PayBookingBalanceMutation = graphql(`
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
`)

/** How this store takes payment, for pages that don't ship anything (bookings). */
export const StorefrontPaymentMethodsQuery = graphql(`
  query StorefrontPaymentMethods {
    storefrontPaymentMethods {
      online
      bankTransfer
    }
  }
`)

/** The fonts a merchant's brand can name (public). */
export const StorefrontFontCatalogQuery = graphql(`
  query StorefrontFontCatalog {
    brandingCatalog {
      fonts {
        key
        family
        googleFamily
      }
    }
  }
`)

/** The store's email sign-up form: Cartly emails a confirmation link (double opt-in). Always true. */
export const SubscribeToNewsletterMutation = graphql(`
  mutation SubscribeToNewsletter($input: NewsletterSignupInput!) {
    subscribeToNewsletter(input: $input)
  }
`)

/**
 * Reports a business (from its own storefront, X-Storefront-Host), a listing
 * or review on it, or anything else to Cartly's staff. The business is never
 * told. Always true for a valid report.
 */
export const SubmitReportMutation = graphql(`
  mutation SubmitReport($input: SubmitReportInput!) {
    submitReport(input: $input)
  }
`)
