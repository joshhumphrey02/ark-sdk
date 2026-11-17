/* eslint-disable */
import * as types from './graphql';



/**
 * Map of all GraphQL operations in the project.
 *
 * This map has several performance disadvantages:
 * 1. It is not tree-shakeable, so it will include all operations in the project.
 * 2. It is not minifiable, so the string of a GraphQL query will be multiple times inside the bundle.
 * 3. It does not support dead code elimination, so it will add unused operations.
 *
 * Therefore it is highly recommended to use the babel or swc plugin for production.
 * Learn more about it here: https://the-guild.dev/graphql/codegen/plugins/presets/preset-client#reducing-bundle-size
 */
type Documents = {
    "query CartlySdkTypeAnchors($homePage: StorefrontHomePageInput) {\n  __typename\n}": typeof types.CartlySdkTypeAnchorsDocument,
    "\n  query Viewer {\n    viewer {\n      id\n      email\n      displayName\n      emailVerified\n      mfaEnabled\n      businesses {\n        id\n        name\n        slug\n        status\n        verticals\n        roles {\n          key\n          name\n        }\n      }\n    }\n  }\n": typeof types.ViewerDocument,
    "\n  fragment PaymentSessionFields on PaymentSessionView {\n    status\n    resourceType\n    amount\n    currency\n    methods\n    method\n    paymentReference\n    expiresAt\n    completedAt\n    title\n    merchant {\n      name\n      logoUrl\n      primaryColor\n      accentColor\n      headingFont\n      bodyFont\n    }\n    lines {\n      description\n      quantity\n      amount\n    }\n    bankTransfer {\n      bankName\n      accountName\n      accountNumber\n      instructions\n      reference\n      submittedAt\n      rejectionReason\n    }\n    cashOnDeliveryInstructions\n  }\n": typeof types.PaymentSessionFieldsFragmentDoc,
    "\n  query PaymentSession($token: String!) {\n    paymentSession(token: $token) {\n      ...PaymentSessionFields\n    }\n  }\n": typeof types.PaymentSessionDocument,
    "\n  mutation RefreshPaymentSession($token: String!) {\n    refreshPaymentSession(token: $token) {\n      ...PaymentSessionFields\n    }\n  }\n": typeof types.RefreshPaymentSessionDocument,
    "\n  mutation StartPaymentSession($token: String!, $method: String!) {\n    startPaymentSession(token: $token, method: $method) {\n      checkoutUrl\n    }\n  }\n": typeof types.StartPaymentSessionDocument,
    "\n  mutation SubmitBankTransferProof(\n    $token: String!\n    $input: BankTransferProofInput!\n  ) {\n    submitBankTransferProof(token: $token, input: $input) {\n      ...PaymentSessionFields\n    }\n  }\n": typeof types.SubmitBankTransferProofDocument,
    "\n  fragment ListingCardFields on PublicProperty {\n    id\n    slug\n    title\n    referenceCode\n    category\n    listingType\n    status\n    price\n    priceOnRequest\n    pricePeriod\n    currency\n    bedrooms\n    bathrooms\n    city\n    stateRegion\n    media {\n      id\n      url\n      caption\n      kind\n      isFloorPlan\n    }\n  }\n": typeof types.ListingCardFieldsFragmentDoc,
    "\n  query Listings($filter: PublicPropertyFilter, $page: PageInput) {\n    listings(filter: $filter, page: $page) {\n      items {\n        ...ListingCardFields\n      }\n      pageInfo {\n        ...PageInfoFields\n      }\n    }\n  }\n": typeof types.ListingsDocument,
    "\n  query Listing($slug: String!) {\n    listing(slug: $slug) {\n      ...ListingCardFields\n      description\n      seoTitle\n      seoDescription\n      availableFrom\n      condition\n      furnishing\n      floorAreaSqm\n      landAreaSqm\n      parkingSpaces\n      toilets\n      serviceCharge\n      yearBuilt\n      publishedAt\n      propertyType {\n        name\n        slug\n      }\n      sellOnline\n      purchasable\n      paymentOptions {\n        planId\n        kind\n        label\n        description\n        dueNow\n        balance\n        schedule {\n          sequence\n          dueDate\n          amount\n        }\n      }\n      documents {\n        id\n        title\n        kind\n        mimeType\n        url\n      }\n      collectionIds\n      categoryIds\n    }\n  }\n": typeof types.ListingDocument,
    "\n  mutation SubmitPropertyEnquiry($input: PublicEnquiryInput!) {\n    submitPropertyEnquiry(input: $input) {\n      id\n      status\n    }\n  }\n": typeof types.SubmitPropertyEnquiryDocument,
    "\n  mutation RequestPropertyViewing($input: PublicViewingInput!) {\n    requestPropertyViewing(input: $input) {\n      id\n      status\n    }\n  }\n": typeof types.RequestPropertyViewingDocument,
    "\n  query NearbyListings($near: GeoNearInput!, $limit: Int) {\n    nearbyListings(near: $near, limit: $limit) {\n      distanceMeters\n      listing {\n        ...ListingCardFields\n      }\n    }\n  }\n": typeof types.NearbyListingsDocument,
    "\n  query StorefrontSeo($input: SeoDocumentInput!) {\n    storefrontSeo(input: $input) {\n      title\n      description\n      canonicalUrl\n      robots\n      indexing\n      jsonLdScript\n      lastModified\n      openGraph {\n        type\n        title\n        description\n        url\n        siteName\n        locale\n        images {\n          url\n          width\n          height\n          alt\n        }\n      }\n      twitter {\n        card\n        title\n        description\n        site\n        image\n        imageAlt\n      }\n      breadcrumbs {\n        name\n        url\n      }\n      verification {\n        google\n        bing\n      }\n    }\n  }\n": typeof types.StorefrontSeoDocument,
    "\n  query StorefrontSitemap($name: String) {\n    storefrontSitemap(name: $name) {\n      contentType\n      body\n    }\n  }\n": typeof types.StorefrontSitemapDocument,
    "\n  query StorefrontRobotsTxt {\n    storefrontRobotsTxt {\n      contentType\n      body\n    }\n  }\n": typeof types.StorefrontRobotsTxtDocument,
    "\n  query StorefrontLlmsTxt {\n    storefrontLlmsTxt {\n      contentType\n      body\n    }\n  }\n": typeof types.StorefrontLlmsTxtDocument,
    "\n  query StorefrontCanonicalHost($requestHost: String) {\n    storefrontCanonicalHost(requestHost: $requestHost) {\n      canonicalHost\n      redirectTo\n    }\n  }\n": typeof types.StorefrontCanonicalHostDocument,
    "\n  query StorefrontRouting($requestHost: String) {\n    storefrontCanonicalHost(requestHost: $requestHost) {\n      businessSlug\n      appKey\n      canonicalHost\n      redirectTo\n      selfBuilt\n    }\n  }\n": typeof types.StorefrontRoutingDocument,
    "\n  query StorefrontRoute {\n    storefrontRoute {\n      renderer\n      live\n    }\n  }\n": typeof types.StorefrontRouteDocument,
    "\n  query StorefrontIndexNowKey($key: String!) {\n    storefrontIndexNowKey(key: $key) {\n      contentType\n      body\n    }\n  }\n": typeof types.StorefrontIndexNowKeyDocument,
    "\n  query StorefrontRedirect($path: String!) {\n    storefrontRedirect(path: $path) {\n      location\n      permanent\n    }\n  }\n": typeof types.StorefrontRedirectDocument,
    "\n  query StorefrontVisualPage($path: String!) {\n    storefrontVisualPage(path: $path) {\n      page {\n        id\n        kind\n        path\n        title\n        seoTitle\n        seoDescription\n        noIndex\n        socialImageUrl\n      }\n      document\n      theme\n      navigation {\n        label\n        href\n      }\n      data\n      preview\n    }\n  }\n": typeof types.StorefrontVisualPageDocument,
    "\n  query StorefrontVisualChrome {\n    storefrontVisualChrome {\n      header\n      footer\n      theme\n      navigation {\n        label\n        href\n      }\n      data\n    }\n  }\n": typeof types.StorefrontVisualChromeDocument,
    "\n  query StorefrontPagePreview($token: String!) {\n    storefrontPagePreview(token: $token) {\n      page {\n        id\n        kind\n        path\n        title\n        seoTitle\n        seoDescription\n        noIndex\n        socialImageUrl\n      }\n      document\n      header\n      footer\n      theme\n      navigation {\n        label\n        href\n      }\n      data\n      preview\n    }\n  }\n": typeof types.StorefrontPagePreviewDocument,
    "\n  fragment PageInfoFields on PageInfo {\n    nextCursor\n    hasMore\n    limit\n  }\n": typeof types.PageInfoFieldsFragmentDoc,
    "\n  fragment StorefrontProductCardFields on StorefrontProduct {\n    id\n    slug\n    title\n    description\n    media {\n      id\n      url\n      altText\n      kind\n    }\n    variants {\n      id\n      price\n      compareAtPrice\n      currency\n      inStock\n      lowStock\n    }\n  }\n": typeof types.StorefrontProductCardFieldsFragmentDoc,
    "\n  query StorefrontProducts(\n    $filter: StorefrontProductFilter\n    $sort: StorefrontProductSort\n    $page: PageInput\n  ) {\n    storefrontProducts(filter: $filter, sort: $sort, page: $page) {\n      items {\n        ...StorefrontProductCardFields\n      }\n      pageInfo {\n        ...PageInfoFields\n      }\n    }\n  }\n": typeof types.StorefrontProductsDocument,
    "\n  query StorefrontProduct($slug: String!) {\n    storefrontProduct(slug: $slug) {\n      ...StorefrontProductCardFields\n      description\n      seoTitle\n      seoDescription\n      tags\n      categoryIds\n      attributes {\n        code\n        name\n        value\n      }\n      variants {\n        sku\n        title\n        options {\n          name\n          value\n        }\n      }\n      options {\n        name\n        values\n      }\n      media {\n        variantId\n      }\n    }\n  }\n": typeof types.StorefrontProductDocument,
    "\n  query StorefrontCategories {\n    storefrontCategories {\n      id\n      name\n      slug\n      parentId\n      description\n      imageUrl\n      productCount\n    }\n  }\n": typeof types.StorefrontCategoriesDocument,
    "\n  fragment CartFields on Cart {\n    currency\n    propertyItems {\n      propertyId\n      slug\n      title\n      referenceCode\n      imageUrl\n      planId\n      planKind\n      planLabel\n      dueNow\n      balance\n      schedule {\n        sequence\n        dueDate\n        amount\n      }\n    }\n    items {\n      variantId\n      sku\n      productTitle\n      productSlug\n      imageUrl\n      variantTitle\n      quantity\n      unitPrice\n      lineTotal\n    }\n    subtotal\n    discountTotal\n    shippingTotal\n    taxTotal\n    total\n  }\n": typeof types.CartFieldsFragmentDoc,
    "\n  mutation CreateCart {\n    createCart {\n      cartId\n      cartToken\n      currency\n    }\n  }\n": typeof types.CreateCartDocument,
    "\n  query Cart {\n    cart {\n      ...CartFields\n    }\n  }\n": typeof types.CartDocument,
    "\n  query PreviewCartCoupon($code: String!, $email: String) {\n    previewCartCoupon(code: $code, email: $email) {\n      ...CartFields\n    }\n  }\n": typeof types.PreviewCartCouponDocument,
    "\n  mutation SetCartItem($variantId: ID!, $quantity: Int!) {\n    setCartItem(variantId: $variantId, quantity: $quantity) {\n      ...CartFields\n    }\n  }\n": typeof types.SetCartItemDocument,
    "\n  mutation RemoveCartItem($variantId: ID!) {\n    removeCartItem(variantId: $variantId) {\n      ...CartFields\n    }\n  }\n": typeof types.RemoveCartItemDocument,
    "\n  mutation SetCartProperty($propertyId: ID!, $planId: ID) {\n    setCartProperty(propertyId: $propertyId, planId: $planId) {\n      ...CartFields\n    }\n  }\n": typeof types.SetCartPropertyDocument,
    "\n  mutation RemoveCartProperty($propertyId: ID!) {\n    removeCartProperty(propertyId: $propertyId) {\n      ...CartFields\n    }\n  }\n": typeof types.RemoveCartPropertyDocument,
    "\n  query StorefrontServiceCoverage($latitude: Float!, $longitude: Float!) {\n    storefrontServiceCoverage(latitude: $latitude, longitude: $longitude) {\n      enabled\n      covered\n      areas {\n        id\n        name\n      }\n    }\n  }\n": typeof types.StorefrontServiceCoverageDocument,
    "\n  query IntroductoryOffer {\n    introductoryOffer {\n      available\n      durationMonths\n      package {\n        key\n        name\n      }\n    }\n  }\n": typeof types.IntroductoryOfferDocument,
    "\n  query StorefrontCheckoutOptions {\n    storefrontShippingMethods {\n      id\n      name\n      description\n      price\n      currency\n      rateType\n      minOrderSubtotal\n      estimatedMinDays\n      estimatedMaxDays\n      countryCodes\n    }\n    storefrontPaymentMethods {\n      online\n      bankTransfer\n      cashOnDelivery\n      cashOnDeliveryCountries\n    }\n  }\n": typeof types.StorefrontCheckoutOptionsDocument,
    "\n  mutation Checkout($input: CheckoutInput!) {\n    checkout(input: $input) {\n      orderId\n      orderNumber\n      total\n      currency\n      sessionToken\n      payment {\n        method\n        checkoutUrl\n        reference\n        bankTransfer {\n          bankName\n          accountName\n          accountNumber\n          amount\n          currency\n          reference\n          instructions\n          expiresAt\n        }\n      }\n    }\n  }\n": typeof types.CheckoutDocument,
    "\n  mutation ContactBusiness($input: CustomerConversationInput!) {\n    contactBusiness(input: $input) {\n      conversationId\n      accessToken\n    }\n  }\n": typeof types.ContactBusinessDocument,
    "\n  query MyConversation {\n    myConversation {\n      id\n      subject\n      status\n      messages {\n        id\n        body\n        createdAt\n        senderType\n        senderName\n      }\n    }\n  }\n": typeof types.MyConversationDocument,
    "\n  mutation ReplyAsCustomer($body: String!) {\n    replyAsCustomer(body: $body) {\n      id\n    }\n  }\n": typeof types.ReplyAsCustomerDocument,
    "\n  mutation RegisterCustomer(\n    $email: String!\n    $password: String!\n    $firstName: String\n    $lastName: String\n  ) {\n    registerCustomer(\n      email: $email\n      password: $password\n      firstName: $firstName\n      lastName: $lastName\n    )\n  }\n": typeof types.RegisterCustomerDocument,
    "\n  mutation VerifyCustomerEmail($token: String!) {\n    verifyCustomerEmail(token: $token)\n  }\n": typeof types.VerifyCustomerEmailDocument,
    "\n  query StorefrontSignInProviders {\n    storefrontSignInProviders\n  }\n": typeof types.StorefrontSignInProvidersDocument,
    "\n  mutation CustomerProviderSignIn($code: String!) {\n    customerProviderSignIn(code: $code) {\n      token\n      expiresAt\n    }\n  }\n": typeof types.CustomerProviderSignInDocument,
    "\n  mutation CustomerLogin($email: String!, $password: String!) {\n    customerLogin(email: $email, password: $password) {\n      token\n      expiresAt\n    }\n  }\n": typeof types.CustomerLoginDocument,
    "\n  mutation CustomerLogout {\n    customerLogout\n  }\n": typeof types.CustomerLogoutDocument,
    "\n  mutation RequestCustomerPasswordReset($email: String!) {\n    requestCustomerPasswordReset(email: $email)\n  }\n": typeof types.RequestCustomerPasswordResetDocument,
    "\n  mutation ResetCustomerPassword($token: String!, $password: String!) {\n    resetCustomerPassword(token: $token, password: $password)\n  }\n": typeof types.ResetCustomerPasswordDocument,
    "\n  query CustomerAccount {\n    customerAccount {\n      email\n      firstName\n      lastName\n      phone\n      createdAt\n    }\n    customerOrders {\n      orderNumber\n      status\n      paymentStatus\n      fulfillmentStatus\n      currency\n      total\n      itemCount\n      placedAt\n    }\n  }\n": typeof types.CustomerAccountDocument,
    "\n  query CustomerOrderHistory($page: PageInput) {\n    customerOrderHistory(page: $page) {\n      items {\n        orderNumber\n        status\n        paymentStatus\n        fulfillmentStatus\n        currency\n        total\n        itemCount\n        placedAt\n      }\n      pageInfo {\n        nextCursor\n        hasMore\n      }\n    }\n  }\n": typeof types.CustomerOrderHistoryDocument,
    "\n  query CustomerOrder($orderNumber: Int!) {\n    customerOrder(orderNumber: $orderNumber) {\n      orderNumber\n      status\n      paymentStatus\n      fulfillmentStatus\n      placedAt\n      currency\n      subtotal\n      discountTotal\n      shippingTotal\n      taxTotal\n      total\n      note\n      paymentMethod\n      shippingMethodName\n      shippingAddress {\n        recipientName\n        phone\n        line1\n        line2\n        city\n        stateRegion\n        postalCode\n        countryCode\n      }\n      lines {\n        productTitle\n        variantTitle\n        sku\n        quantity\n        unitPrice\n        lineTotal\n        productSlug\n        propertySlug\n        imageUrl\n      }\n      instalments {\n        id\n        title\n        sequence\n        count\n        dueDate\n        amount\n        currency\n        status\n        paidAt\n        canPay\n      }\n      events {\n        kind\n        at\n      }\n      canPay\n    }\n  }\n": typeof types.CustomerOrderDocument,
    "\n  mutation ResumeCustomerOrderPayment($orderNumber: Int!) {\n    resumeCustomerOrderPayment(orderNumber: $orderNumber)\n  }\n": typeof types.ResumeCustomerOrderPaymentDocument,
    "\n  mutation PayCustomerInstalment(\n    $orderNumber: Int!\n    $instalmentId: ID!\n    $paymentMethod: CheckoutPaymentMethod\n  ) {\n    payCustomerInstalment(\n      orderNumber: $orderNumber\n      instalmentId: $instalmentId\n      paymentMethod: $paymentMethod\n    )\n  }\n": typeof types.PayCustomerInstalmentDocument,
    "\n  fragment ShopperAddressFields on CustomerAddress {\n    id\n    label\n    recipientName\n    phone\n    line1\n    line2\n    city\n    stateRegion\n    postalCode\n    countryCode\n    isDefaultShipping\n    isDefaultBilling\n  }\n": typeof types.ShopperAddressFieldsFragmentDoc,
    "\n  query ShopperAddresses {\n    shopperAddresses {\n      ...ShopperAddressFields\n    }\n  }\n": typeof types.ShopperAddressesDocument,
    "\n  mutation SaveShopperAddress($input: CustomerAddressInput!, $id: ID) {\n    saveShopperAddress(input: $input, id: $id) {\n      ...ShopperAddressFields\n    }\n  }\n": typeof types.SaveShopperAddressDocument,
    "\n  mutation DeleteShopperAddress($id: ID!) {\n    deleteShopperAddress(id: $id)\n  }\n": typeof types.DeleteShopperAddressDocument,
    "\n  query CustomerReviews($page: PageInput) {\n    customerReviews(page: $page) {\n      items {\n        id\n        rating\n        title\n        body\n        status\n        verifiedPurchase\n        reply\n        createdAt\n        product {\n          slug\n          title\n          imageUrl\n        }\n      }\n      pageInfo {\n        nextCursor\n        hasMore\n      }\n    }\n  }\n": typeof types.CustomerReviewsDocument,
    "\n  query SavedItems($page: PageInput) {\n    savedItems(page: $page) {\n      items {\n        kind\n        slug\n        title\n        imageUrl\n        price\n        currency\n        available\n        savedAt\n      }\n      pageInfo {\n        nextCursor\n        hasMore\n      }\n    }\n  }\n": typeof types.SavedItemsDocument,
    "\n  mutation SaveItem($kind: SavedItemKind!, $slug: String!) {\n    saveItem(kind: $kind, slug: $slug) {\n      kind\n      slug\n      saved\n    }\n  }\n": typeof types.SaveItemDocument,
    "\n  mutation UnsaveItem($kind: SavedItemKind!, $slug: String!) {\n    unsaveItem(kind: $kind, slug: $slug) {\n      kind\n      slug\n      saved\n    }\n  }\n": typeof types.UnsaveItemDocument,
    "\n  mutation RequestCustomerEmailChange($newEmail: String!, $password: String!) {\n    requestCustomerEmailChange(newEmail: $newEmail, password: $password)\n  }\n": typeof types.RequestCustomerEmailChangeDocument,
    "\n  mutation UpdateCustomerAccount(\n    $firstName: String\n    $lastName: String\n    $phone: String\n  ) {\n    updateCustomerAccount(\n      firstName: $firstName\n      lastName: $lastName\n      phone: $phone\n    ) {\n      firstName\n      lastName\n      phone\n    }\n  }\n": typeof types.UpdateCustomerAccountDocument,
    "\n  mutation ChangeCustomerPassword(\n    $currentPassword: String!\n    $newPassword: String!\n  ) {\n    changeCustomerPassword(\n      currentPassword: $currentPassword\n      newPassword: $newPassword\n    )\n  }\n": typeof types.ChangeCustomerPasswordDocument,
    "\n  query StorefrontCollections {\n    storefrontCollections {\n      id\n      title\n      slug\n      description\n      imageUrl\n      productCount\n    }\n  }\n": typeof types.StorefrontCollectionsDocument,
    "\n  query StorefrontCollection($slug: String!) {\n    storefrontCollection(slug: $slug) {\n      id\n      title\n      slug\n      description\n      imageUrl\n      productCount\n      products {\n        ...StorefrontProductCardFields\n      }\n    }\n  }\n": typeof types.StorefrontCollectionDocument,
    "\n  query StorefrontProductReviews($slug: String!, $page: PageInput) {\n    storefrontProductReviews(slug: $slug, page: $page) {\n      averageRating\n      reviewCount\n      distribution {\n        rating\n        count\n      }\n      page {\n        items {\n          id\n          authorName\n          rating\n          title\n          body\n          verifiedPurchase\n          reply\n          createdAt\n        }\n        pageInfo {\n          ...PageInfoFields\n        }\n      }\n    }\n  }\n": typeof types.StorefrontProductReviewsDocument,
    "\n  mutation SubmitProductReview($slug: String!, $input: ProductReviewInput!) {\n    submitProductReview(slug: $slug, input: $input) {\n      id\n      status\n    }\n  }\n": typeof types.SubmitProductReviewDocument,
    "\n  query StorefrontBrand($slug: String!) {\n    publicBusinessBrand(slug: $slug) {\n      businessName\n      description\n      primaryColor\n      secondaryColor\n      accentColor\n      headingFont\n      bodyFont\n      logo {\n        deliveryUrl\n      }\n    }\n  }\n": typeof types.StorefrontBrandDocument,
    "\n  query StorefrontProfile {\n    storefrontProfile {\n      name\n      tagline\n      description\n      logoUrl\n      contactEmail\n      contactPhone\n      whatsappPhone\n      openingHours\n      serviceArea\n      address {\n        line1\n        line2\n        city\n        stateRegion\n        postalCode\n        countryCode\n      }\n      socialLinks {\n        network\n        url\n      }\n    }\n  }\n": typeof types.StorefrontProfileDocument,
    "\n  query StorefrontFeatures {\n    storefrontFeatures {\n      currency\n      countryCode\n      capabilities\n      businessTypes {\n        key\n        name\n        categoryKey\n      }\n    }\n  }\n": typeof types.StorefrontFeaturesDocument,
    "\n  fragment StorefrontImageFields on StorefrontImage {\n    assetId\n    url\n    alt\n  }\n": typeof types.StorefrontImageFieldsFragmentDoc,
    "\n  fragment StorefrontHomePageFields on StorefrontHomePage {\n    announcement\n    hero {\n      layout\n      slides {\n        image {\n          ...StorefrontImageFields\n        }\n        eyebrow\n        headline\n        subheading\n        action {\n          label\n          href\n        }\n      }\n      eyebrow\n      headline\n      highlight\n      subheading\n      primaryAction {\n        label\n        href\n      }\n      secondaryAction {\n        label\n        href\n      }\n      images {\n        ...StorefrontImageFields\n      }\n      video {\n        assetId\n        url\n      }\n      badge {\n        value\n        label\n      }\n      showRating\n    }\n    stats {\n      value\n      label\n    }\n    sections {\n      id\n      kind\n      layout\n      visible\n      eyebrow\n      title\n      body\n      images {\n        ...StorefrontImageFields\n      }\n      video {\n        assetId\n        url\n      }\n      link {\n        label\n        href\n      }\n      collectionSlug\n      recordType\n      itemLimit\n    }\n    updatedAt\n  }\n": typeof types.StorefrontHomePageFieldsFragmentDoc,
    "\n  query StorefrontHomePage {\n    storefrontHomePage {\n      ...StorefrontHomePageFields\n    }\n  }\n": typeof types.StorefrontHomePageDocument,
    "\n  query StorefrontPage($path: String!) {\n    storefrontPage(path: $path) {\n      path\n      kind\n      title\n      summary\n      body\n      images {\n        ...StorefrontImageFields\n      }\n      faq {\n        question\n        answer\n      }\n      updatedAt\n    }\n  }\n": typeof types.StorefrontPageDocument,
    "\n  query StorefrontPages($filter: StorefrontPageFilter, $page: PageInput) {\n    storefrontPages(filter: $filter, page: $page) {\n      items {\n        path\n        kind\n        title\n        summary\n        authorName\n        publishedAt\n        image {\n          ...StorefrontImageFields\n        }\n      }\n      pageInfo {\n        hasMore\n        nextCursor\n      }\n    }\n  }\n": typeof types.StorefrontPagesDocument,
    "\n  query StorefrontReviews($page: PageInput) {\n    storefrontReviews(page: $page) {\n      items {\n        id\n        authorName\n        rating\n        title\n        body\n        reply\n        verifiedPurchase\n        createdAt\n        product {\n          slug\n          title\n          imageUrl\n        }\n      }\n      pageInfo {\n        ...PageInfoFields\n      }\n    }\n    storefrontRatingSummary {\n      averageRating\n      reviewCount\n      distribution {\n        rating\n        count\n      }\n    }\n  }\n": typeof types.StorefrontReviewsDocument,
    "\n  query StorefrontRecordTypes {\n    storefrontRecordTypes {\n      key\n      name\n      description\n      access\n      fields {\n        key\n        label\n        type\n        description\n        required\n        filterable\n        searchable\n        options {\n          value\n          label\n        }\n        min\n        max\n        referenceTo\n      }\n    }\n  }\n": typeof types.StorefrontRecordTypesDocument,
    "\n  query StorefrontRecords(\n    $type: String!\n    $filters: [EntityRecordFilterInput!]\n    $q: String\n    $page: PageInput\n  ) {\n    storefrontRecords(type: $type, filters: $filters, q: $q, page: $page) {\n      items {\n        id\n        type\n        data\n        createdAt\n        updatedAt\n      }\n      pageInfo {\n        ...PageInfoFields\n      }\n    }\n  }\n": typeof types.StorefrontRecordsDocument,
    "\n  query StorefrontRecord($type: String!, $id: ID!) {\n    storefrontRecord(type: $type, id: $id) {\n      id\n      type\n      data\n      createdAt\n      updatedAt\n    }\n  }\n": typeof types.StorefrontRecordDocument,
    "\n  mutation SubmitStorefrontRecord($type: String!, $data: JSON!) {\n    submitStorefrontRecord(type: $type, data: $data) {\n      id\n      type\n      createdAt\n    }\n  }\n": typeof types.SubmitStorefrontRecordDocument,
    "\n  subscription PaymentSessionActivity($token: String!) {\n    paymentSessionActivity(token: $token) {\n      kind\n      at\n    }\n  }\n": typeof types.PaymentSessionActivityDocument,
    "\n  query MyStorefrontRecords($type: String) {\n    myStorefrontRecords(type: $type) {\n      id\n      type\n      typeName\n      data\n      progress {\n        field\n        label\n        value\n        valueLabel\n      }\n      archived\n      createdAt\n      updatedAt\n    }\n  }\n": typeof types.MyStorefrontRecordsDocument,
    "\n  fragment StorefrontBookableFields on StorefrontBookable {\n    id\n    slug\n    name\n    description\n    unit\n    slotMinutes\n    minUnits\n    maxUnits\n    maxQuantity\n    checkInTime\n    checkOutTime\n    eventStartsAt\n    eventEndsAt\n    timezone\n    payment\n    confirmation\n    cancellationHours\n    depositPercent\n    maxOccurrences\n    price {\n      amount\n      currency\n      per\n    }\n    priceRules {\n      label\n      weekdays\n      startDate\n      endDate\n      amount\n      currency\n    }\n    images {\n      ...StorefrontImageFields\n    }\n    media {\n      assetId\n      kind\n      url\n      poster\n    }\n    rules {\n      weekday\n      startTime\n      endTime\n    }\n  }\n": typeof types.StorefrontBookableFieldsFragmentDoc,
    "\n  query StorefrontBookables {\n    storefrontBookables {\n      ...StorefrontBookableFields\n    }\n  }\n": typeof types.StorefrontBookablesDocument,
    "\n  query StorefrontBookable($slug: String!) {\n    storefrontBookable(slug: $slug) {\n      ...StorefrontBookableFields\n    }\n  }\n": typeof types.StorefrontBookableDocument,
    "\n  query BookableAvailability($slug: String!, $from: String!, $to: String!) {\n    bookableAvailability(slug: $slug, from: $from, to: $to) {\n      unit\n      days {\n        date\n        remaining\n      }\n      slots {\n        startsAt\n        endsAt\n        remaining\n      }\n    }\n  }\n": typeof types.BookableAvailabilityDocument,
    "\n  query QuoteBooking($input: BookingRequestInput!) {\n    quoteBooking(input: $input) {\n      startsAt\n      endsAt\n      units\n      quantity\n      occurrences {\n        startsAt\n        endsAt\n        available\n      }\n      lines {\n        label\n        unitPrice\n        quantity\n        amount\n      }\n      subtotal\n      discount\n      total\n      deposit\n      dueNow\n      balance\n      currency\n      payment\n      available\n    }\n  }\n": typeof types.QuoteBookingDocument,
    "\n  fragment ShopperBookingFields on ShopperBooking {\n    reference\n    status\n    bookable {\n      slug\n      name\n      unit\n    }\n    startsAt\n    endsAt\n    units\n    quantity\n    guestName\n    occurrences {\n      reference\n      startsAt\n      endsAt\n      status\n    }\n    subtotal\n    discountTotal\n    couponCode\n    total\n    currency\n    depositAmount\n    balanceDue\n    balancePaid\n    paid\n    holdExpiresAt\n    canCancel\n    canPayBalance\n    createdAt\n  }\n": typeof types.ShopperBookingFieldsFragmentDoc,
    "\n  mutation CreateBooking($input: CreateBookingInput!) {\n    createBooking(input: $input) {\n      accessToken\n      sessionToken\n      booking {\n        ...ShopperBookingFields\n      }\n      payment {\n        method\n        reference\n        checkoutUrl\n        bankTransfer {\n          bankName\n          accountName\n          accountNumber\n          instructions\n          amount\n          currency\n          reference\n          expiresAt\n        }\n      }\n    }\n  }\n": typeof types.CreateBookingDocument,
    "\n  query MyBooking($token: String!) {\n    myBooking(token: $token) {\n      ...ShopperBookingFields\n    }\n  }\n": typeof types.MyBookingDocument,
    "\n  mutation CancelMyBooking($token: String!) {\n    cancelMyBooking(token: $token) {\n      ...ShopperBookingFields\n    }\n  }\n": typeof types.CancelMyBookingDocument,
    "\n  query CustomerBookings {\n    customerBookings {\n      ...ShopperBookingFields\n    }\n  }\n": typeof types.CustomerBookingsDocument,
    "\n  mutation PayBookingBalance($token: String!, $paymentMethod: String) {\n    payBookingBalance(token: $token, paymentMethod: $paymentMethod) {\n      sessionToken\n      payment {\n        method\n        reference\n        checkoutUrl\n        bankTransfer {\n          bankName\n          accountName\n          accountNumber\n          instructions\n          amount\n          currency\n          reference\n          expiresAt\n        }\n      }\n    }\n  }\n": typeof types.PayBookingBalanceDocument,
    "\n  query StorefrontPaymentMethods {\n    storefrontPaymentMethods {\n      online\n      bankTransfer\n    }\n  }\n": typeof types.StorefrontPaymentMethodsDocument,
    "\n  query StorefrontFontCatalog {\n    brandingCatalog {\n      fonts {\n        key\n        family\n        googleFamily\n      }\n    }\n  }\n": typeof types.StorefrontFontCatalogDocument,
    "\n  mutation SubscribeToNewsletter($input: NewsletterSignupInput!) {\n    subscribeToNewsletter(input: $input)\n  }\n": typeof types.SubscribeToNewsletterDocument,
    "\n  mutation SubmitReport($input: SubmitReportInput!) {\n    submitReport(input: $input)\n  }\n": typeof types.SubmitReportDocument,
};
const documents: Documents = {
    "query CartlySdkTypeAnchors($homePage: StorefrontHomePageInput) {\n  __typename\n}": types.CartlySdkTypeAnchorsDocument,
    "\n  query Viewer {\n    viewer {\n      id\n      email\n      displayName\n      emailVerified\n      mfaEnabled\n      businesses {\n        id\n        name\n        slug\n        status\n        verticals\n        roles {\n          key\n          name\n        }\n      }\n    }\n  }\n": types.ViewerDocument,
    "\n  fragment PaymentSessionFields on PaymentSessionView {\n    status\n    resourceType\n    amount\n    currency\n    methods\n    method\n    paymentReference\n    expiresAt\n    completedAt\n    title\n    merchant {\n      name\n      logoUrl\n      primaryColor\n      accentColor\n      headingFont\n      bodyFont\n    }\n    lines {\n      description\n      quantity\n      amount\n    }\n    bankTransfer {\n      bankName\n      accountName\n      accountNumber\n      instructions\n      reference\n      submittedAt\n      rejectionReason\n    }\n    cashOnDeliveryInstructions\n  }\n": types.PaymentSessionFieldsFragmentDoc,
    "\n  query PaymentSession($token: String!) {\n    paymentSession(token: $token) {\n      ...PaymentSessionFields\n    }\n  }\n": types.PaymentSessionDocument,
    "\n  mutation RefreshPaymentSession($token: String!) {\n    refreshPaymentSession(token: $token) {\n      ...PaymentSessionFields\n    }\n  }\n": types.RefreshPaymentSessionDocument,
    "\n  mutation StartPaymentSession($token: String!, $method: String!) {\n    startPaymentSession(token: $token, method: $method) {\n      checkoutUrl\n    }\n  }\n": types.StartPaymentSessionDocument,
    "\n  mutation SubmitBankTransferProof(\n    $token: String!\n    $input: BankTransferProofInput!\n  ) {\n    submitBankTransferProof(token: $token, input: $input) {\n      ...PaymentSessionFields\n    }\n  }\n": types.SubmitBankTransferProofDocument,
    "\n  fragment ListingCardFields on PublicProperty {\n    id\n    slug\n    title\n    referenceCode\n    category\n    listingType\n    status\n    price\n    priceOnRequest\n    pricePeriod\n    currency\n    bedrooms\n    bathrooms\n    city\n    stateRegion\n    media {\n      id\n      url\n      caption\n      kind\n      isFloorPlan\n    }\n  }\n": types.ListingCardFieldsFragmentDoc,
    "\n  query Listings($filter: PublicPropertyFilter, $page: PageInput) {\n    listings(filter: $filter, page: $page) {\n      items {\n        ...ListingCardFields\n      }\n      pageInfo {\n        ...PageInfoFields\n      }\n    }\n  }\n": types.ListingsDocument,
    "\n  query Listing($slug: String!) {\n    listing(slug: $slug) {\n      ...ListingCardFields\n      description\n      seoTitle\n      seoDescription\n      availableFrom\n      condition\n      furnishing\n      floorAreaSqm\n      landAreaSqm\n      parkingSpaces\n      toilets\n      serviceCharge\n      yearBuilt\n      publishedAt\n      propertyType {\n        name\n        slug\n      }\n      sellOnline\n      purchasable\n      paymentOptions {\n        planId\n        kind\n        label\n        description\n        dueNow\n        balance\n        schedule {\n          sequence\n          dueDate\n          amount\n        }\n      }\n      documents {\n        id\n        title\n        kind\n        mimeType\n        url\n      }\n      collectionIds\n      categoryIds\n    }\n  }\n": types.ListingDocument,
    "\n  mutation SubmitPropertyEnquiry($input: PublicEnquiryInput!) {\n    submitPropertyEnquiry(input: $input) {\n      id\n      status\n    }\n  }\n": types.SubmitPropertyEnquiryDocument,
    "\n  mutation RequestPropertyViewing($input: PublicViewingInput!) {\n    requestPropertyViewing(input: $input) {\n      id\n      status\n    }\n  }\n": types.RequestPropertyViewingDocument,
    "\n  query NearbyListings($near: GeoNearInput!, $limit: Int) {\n    nearbyListings(near: $near, limit: $limit) {\n      distanceMeters\n      listing {\n        ...ListingCardFields\n      }\n    }\n  }\n": types.NearbyListingsDocument,
    "\n  query StorefrontSeo($input: SeoDocumentInput!) {\n    storefrontSeo(input: $input) {\n      title\n      description\n      canonicalUrl\n      robots\n      indexing\n      jsonLdScript\n      lastModified\n      openGraph {\n        type\n        title\n        description\n        url\n        siteName\n        locale\n        images {\n          url\n          width\n          height\n          alt\n        }\n      }\n      twitter {\n        card\n        title\n        description\n        site\n        image\n        imageAlt\n      }\n      breadcrumbs {\n        name\n        url\n      }\n      verification {\n        google\n        bing\n      }\n    }\n  }\n": types.StorefrontSeoDocument,
    "\n  query StorefrontSitemap($name: String) {\n    storefrontSitemap(name: $name) {\n      contentType\n      body\n    }\n  }\n": types.StorefrontSitemapDocument,
    "\n  query StorefrontRobotsTxt {\n    storefrontRobotsTxt {\n      contentType\n      body\n    }\n  }\n": types.StorefrontRobotsTxtDocument,
    "\n  query StorefrontLlmsTxt {\n    storefrontLlmsTxt {\n      contentType\n      body\n    }\n  }\n": types.StorefrontLlmsTxtDocument,
    "\n  query StorefrontCanonicalHost($requestHost: String) {\n    storefrontCanonicalHost(requestHost: $requestHost) {\n      canonicalHost\n      redirectTo\n    }\n  }\n": types.StorefrontCanonicalHostDocument,
    "\n  query StorefrontRouting($requestHost: String) {\n    storefrontCanonicalHost(requestHost: $requestHost) {\n      businessSlug\n      appKey\n      canonicalHost\n      redirectTo\n      selfBuilt\n    }\n  }\n": types.StorefrontRoutingDocument,
    "\n  query StorefrontRoute {\n    storefrontRoute {\n      renderer\n      live\n    }\n  }\n": types.StorefrontRouteDocument,
    "\n  query StorefrontIndexNowKey($key: String!) {\n    storefrontIndexNowKey(key: $key) {\n      contentType\n      body\n    }\n  }\n": types.StorefrontIndexNowKeyDocument,
    "\n  query StorefrontRedirect($path: String!) {\n    storefrontRedirect(path: $path) {\n      location\n      permanent\n    }\n  }\n": types.StorefrontRedirectDocument,
    "\n  query StorefrontVisualPage($path: String!) {\n    storefrontVisualPage(path: $path) {\n      page {\n        id\n        kind\n        path\n        title\n        seoTitle\n        seoDescription\n        noIndex\n        socialImageUrl\n      }\n      document\n      theme\n      navigation {\n        label\n        href\n      }\n      data\n      preview\n    }\n  }\n": types.StorefrontVisualPageDocument,
    "\n  query StorefrontVisualChrome {\n    storefrontVisualChrome {\n      header\n      footer\n      theme\n      navigation {\n        label\n        href\n      }\n      data\n    }\n  }\n": types.StorefrontVisualChromeDocument,
    "\n  query StorefrontPagePreview($token: String!) {\n    storefrontPagePreview(token: $token) {\n      page {\n        id\n        kind\n        path\n        title\n        seoTitle\n        seoDescription\n        noIndex\n        socialImageUrl\n      }\n      document\n      header\n      footer\n      theme\n      navigation {\n        label\n        href\n      }\n      data\n      preview\n    }\n  }\n": types.StorefrontPagePreviewDocument,
    "\n  fragment PageInfoFields on PageInfo {\n    nextCursor\n    hasMore\n    limit\n  }\n": types.PageInfoFieldsFragmentDoc,
    "\n  fragment StorefrontProductCardFields on StorefrontProduct {\n    id\n    slug\n    title\n    description\n    media {\n      id\n      url\n      altText\n      kind\n    }\n    variants {\n      id\n      price\n      compareAtPrice\n      currency\n      inStock\n      lowStock\n    }\n  }\n": types.StorefrontProductCardFieldsFragmentDoc,
    "\n  query StorefrontProducts(\n    $filter: StorefrontProductFilter\n    $sort: StorefrontProductSort\n    $page: PageInput\n  ) {\n    storefrontProducts(filter: $filter, sort: $sort, page: $page) {\n      items {\n        ...StorefrontProductCardFields\n      }\n      pageInfo {\n        ...PageInfoFields\n      }\n    }\n  }\n": types.StorefrontProductsDocument,
    "\n  query StorefrontProduct($slug: String!) {\n    storefrontProduct(slug: $slug) {\n      ...StorefrontProductCardFields\n      description\n      seoTitle\n      seoDescription\n      tags\n      categoryIds\n      attributes {\n        code\n        name\n        value\n      }\n      variants {\n        sku\n        title\n        options {\n          name\n          value\n        }\n      }\n      options {\n        name\n        values\n      }\n      media {\n        variantId\n      }\n    }\n  }\n": types.StorefrontProductDocument,
    "\n  query StorefrontCategories {\n    storefrontCategories {\n      id\n      name\n      slug\n      parentId\n      description\n      imageUrl\n      productCount\n    }\n  }\n": types.StorefrontCategoriesDocument,
    "\n  fragment CartFields on Cart {\n    currency\n    propertyItems {\n      propertyId\n      slug\n      title\n      referenceCode\n      imageUrl\n      planId\n      planKind\n      planLabel\n      dueNow\n      balance\n      schedule {\n        sequence\n        dueDate\n        amount\n      }\n    }\n    items {\n      variantId\n      sku\n      productTitle\n      productSlug\n      imageUrl\n      variantTitle\n      quantity\n      unitPrice\n      lineTotal\n    }\n    subtotal\n    discountTotal\n    shippingTotal\n    taxTotal\n    total\n  }\n": types.CartFieldsFragmentDoc,
    "\n  mutation CreateCart {\n    createCart {\n      cartId\n      cartToken\n      currency\n    }\n  }\n": types.CreateCartDocument,
    "\n  query Cart {\n    cart {\n      ...CartFields\n    }\n  }\n": types.CartDocument,
    "\n  query PreviewCartCoupon($code: String!, $email: String) {\n    previewCartCoupon(code: $code, email: $email) {\n      ...CartFields\n    }\n  }\n": types.PreviewCartCouponDocument,
    "\n  mutation SetCartItem($variantId: ID!, $quantity: Int!) {\n    setCartItem(variantId: $variantId, quantity: $quantity) {\n      ...CartFields\n    }\n  }\n": types.SetCartItemDocument,
    "\n  mutation RemoveCartItem($variantId: ID!) {\n    removeCartItem(variantId: $variantId) {\n      ...CartFields\n    }\n  }\n": types.RemoveCartItemDocument,
    "\n  mutation SetCartProperty($propertyId: ID!, $planId: ID) {\n    setCartProperty(propertyId: $propertyId, planId: $planId) {\n      ...CartFields\n    }\n  }\n": types.SetCartPropertyDocument,
    "\n  mutation RemoveCartProperty($propertyId: ID!) {\n    removeCartProperty(propertyId: $propertyId) {\n      ...CartFields\n    }\n  }\n": types.RemoveCartPropertyDocument,
    "\n  query StorefrontServiceCoverage($latitude: Float!, $longitude: Float!) {\n    storefrontServiceCoverage(latitude: $latitude, longitude: $longitude) {\n      enabled\n      covered\n      areas {\n        id\n        name\n      }\n    }\n  }\n": types.StorefrontServiceCoverageDocument,
    "\n  query IntroductoryOffer {\n    introductoryOffer {\n      available\n      durationMonths\n      package {\n        key\n        name\n      }\n    }\n  }\n": types.IntroductoryOfferDocument,
    "\n  query StorefrontCheckoutOptions {\n    storefrontShippingMethods {\n      id\n      name\n      description\n      price\n      currency\n      rateType\n      minOrderSubtotal\n      estimatedMinDays\n      estimatedMaxDays\n      countryCodes\n    }\n    storefrontPaymentMethods {\n      online\n      bankTransfer\n      cashOnDelivery\n      cashOnDeliveryCountries\n    }\n  }\n": types.StorefrontCheckoutOptionsDocument,
    "\n  mutation Checkout($input: CheckoutInput!) {\n    checkout(input: $input) {\n      orderId\n      orderNumber\n      total\n      currency\n      sessionToken\n      payment {\n        method\n        checkoutUrl\n        reference\n        bankTransfer {\n          bankName\n          accountName\n          accountNumber\n          amount\n          currency\n          reference\n          instructions\n          expiresAt\n        }\n      }\n    }\n  }\n": types.CheckoutDocument,
    "\n  mutation ContactBusiness($input: CustomerConversationInput!) {\n    contactBusiness(input: $input) {\n      conversationId\n      accessToken\n    }\n  }\n": types.ContactBusinessDocument,
    "\n  query MyConversation {\n    myConversation {\n      id\n      subject\n      status\n      messages {\n        id\n        body\n        createdAt\n        senderType\n        senderName\n      }\n    }\n  }\n": types.MyConversationDocument,
    "\n  mutation ReplyAsCustomer($body: String!) {\n    replyAsCustomer(body: $body) {\n      id\n    }\n  }\n": types.ReplyAsCustomerDocument,
    "\n  mutation RegisterCustomer(\n    $email: String!\n    $password: String!\n    $firstName: String\n    $lastName: String\n  ) {\n    registerCustomer(\n      email: $email\n      password: $password\n      firstName: $firstName\n      lastName: $lastName\n    )\n  }\n": types.RegisterCustomerDocument,
    "\n  mutation VerifyCustomerEmail($token: String!) {\n    verifyCustomerEmail(token: $token)\n  }\n": types.VerifyCustomerEmailDocument,
    "\n  query StorefrontSignInProviders {\n    storefrontSignInProviders\n  }\n": types.StorefrontSignInProvidersDocument,
    "\n  mutation CustomerProviderSignIn($code: String!) {\n    customerProviderSignIn(code: $code) {\n      token\n      expiresAt\n    }\n  }\n": types.CustomerProviderSignInDocument,
    "\n  mutation CustomerLogin($email: String!, $password: String!) {\n    customerLogin(email: $email, password: $password) {\n      token\n      expiresAt\n    }\n  }\n": types.CustomerLoginDocument,
    "\n  mutation CustomerLogout {\n    customerLogout\n  }\n": types.CustomerLogoutDocument,
    "\n  mutation RequestCustomerPasswordReset($email: String!) {\n    requestCustomerPasswordReset(email: $email)\n  }\n": types.RequestCustomerPasswordResetDocument,
    "\n  mutation ResetCustomerPassword($token: String!, $password: String!) {\n    resetCustomerPassword(token: $token, password: $password)\n  }\n": types.ResetCustomerPasswordDocument,
    "\n  query CustomerAccount {\n    customerAccount {\n      email\n      firstName\n      lastName\n      phone\n      createdAt\n    }\n    customerOrders {\n      orderNumber\n      status\n      paymentStatus\n      fulfillmentStatus\n      currency\n      total\n      itemCount\n      placedAt\n    }\n  }\n": types.CustomerAccountDocument,
    "\n  query CustomerOrderHistory($page: PageInput) {\n    customerOrderHistory(page: $page) {\n      items {\n        orderNumber\n        status\n        paymentStatus\n        fulfillmentStatus\n        currency\n        total\n        itemCount\n        placedAt\n      }\n      pageInfo {\n        nextCursor\n        hasMore\n      }\n    }\n  }\n": types.CustomerOrderHistoryDocument,
    "\n  query CustomerOrder($orderNumber: Int!) {\n    customerOrder(orderNumber: $orderNumber) {\n      orderNumber\n      status\n      paymentStatus\n      fulfillmentStatus\n      placedAt\n      currency\n      subtotal\n      discountTotal\n      shippingTotal\n      taxTotal\n      total\n      note\n      paymentMethod\n      shippingMethodName\n      shippingAddress {\n        recipientName\n        phone\n        line1\n        line2\n        city\n        stateRegion\n        postalCode\n        countryCode\n      }\n      lines {\n        productTitle\n        variantTitle\n        sku\n        quantity\n        unitPrice\n        lineTotal\n        productSlug\n        propertySlug\n        imageUrl\n      }\n      instalments {\n        id\n        title\n        sequence\n        count\n        dueDate\n        amount\n        currency\n        status\n        paidAt\n        canPay\n      }\n      events {\n        kind\n        at\n      }\n      canPay\n    }\n  }\n": types.CustomerOrderDocument,
    "\n  mutation ResumeCustomerOrderPayment($orderNumber: Int!) {\n    resumeCustomerOrderPayment(orderNumber: $orderNumber)\n  }\n": types.ResumeCustomerOrderPaymentDocument,
    "\n  mutation PayCustomerInstalment(\n    $orderNumber: Int!\n    $instalmentId: ID!\n    $paymentMethod: CheckoutPaymentMethod\n  ) {\n    payCustomerInstalment(\n      orderNumber: $orderNumber\n      instalmentId: $instalmentId\n      paymentMethod: $paymentMethod\n    )\n  }\n": types.PayCustomerInstalmentDocument,
    "\n  fragment ShopperAddressFields on CustomerAddress {\n    id\n    label\n    recipientName\n    phone\n    line1\n    line2\n    city\n    stateRegion\n    postalCode\n    countryCode\n    isDefaultShipping\n    isDefaultBilling\n  }\n": types.ShopperAddressFieldsFragmentDoc,
    "\n  query ShopperAddresses {\n    shopperAddresses {\n      ...ShopperAddressFields\n    }\n  }\n": types.ShopperAddressesDocument,
    "\n  mutation SaveShopperAddress($input: CustomerAddressInput!, $id: ID) {\n    saveShopperAddress(input: $input, id: $id) {\n      ...ShopperAddressFields\n    }\n  }\n": types.SaveShopperAddressDocument,
    "\n  mutation DeleteShopperAddress($id: ID!) {\n    deleteShopperAddress(id: $id)\n  }\n": types.DeleteShopperAddressDocument,
    "\n  query CustomerReviews($page: PageInput) {\n    customerReviews(page: $page) {\n      items {\n        id\n        rating\n        title\n        body\n        status\n        verifiedPurchase\n        reply\n        createdAt\n        product {\n          slug\n          title\n          imageUrl\n        }\n      }\n      pageInfo {\n        nextCursor\n        hasMore\n      }\n    }\n  }\n": types.CustomerReviewsDocument,
    "\n  query SavedItems($page: PageInput) {\n    savedItems(page: $page) {\n      items {\n        kind\n        slug\n        title\n        imageUrl\n        price\n        currency\n        available\n        savedAt\n      }\n      pageInfo {\n        nextCursor\n        hasMore\n      }\n    }\n  }\n": types.SavedItemsDocument,
    "\n  mutation SaveItem($kind: SavedItemKind!, $slug: String!) {\n    saveItem(kind: $kind, slug: $slug) {\n      kind\n      slug\n      saved\n    }\n  }\n": types.SaveItemDocument,
    "\n  mutation UnsaveItem($kind: SavedItemKind!, $slug: String!) {\n    unsaveItem(kind: $kind, slug: $slug) {\n      kind\n      slug\n      saved\n    }\n  }\n": types.UnsaveItemDocument,
    "\n  mutation RequestCustomerEmailChange($newEmail: String!, $password: String!) {\n    requestCustomerEmailChange(newEmail: $newEmail, password: $password)\n  }\n": types.RequestCustomerEmailChangeDocument,
    "\n  mutation UpdateCustomerAccount(\n    $firstName: String\n    $lastName: String\n    $phone: String\n  ) {\n    updateCustomerAccount(\n      firstName: $firstName\n      lastName: $lastName\n      phone: $phone\n    ) {\n      firstName\n      lastName\n      phone\n    }\n  }\n": types.UpdateCustomerAccountDocument,
    "\n  mutation ChangeCustomerPassword(\n    $currentPassword: String!\n    $newPassword: String!\n  ) {\n    changeCustomerPassword(\n      currentPassword: $currentPassword\n      newPassword: $newPassword\n    )\n  }\n": types.ChangeCustomerPasswordDocument,
    "\n  query StorefrontCollections {\n    storefrontCollections {\n      id\n      title\n      slug\n      description\n      imageUrl\n      productCount\n    }\n  }\n": types.StorefrontCollectionsDocument,
    "\n  query StorefrontCollection($slug: String!) {\n    storefrontCollection(slug: $slug) {\n      id\n      title\n      slug\n      description\n      imageUrl\n      productCount\n      products {\n        ...StorefrontProductCardFields\n      }\n    }\n  }\n": types.StorefrontCollectionDocument,
    "\n  query StorefrontProductReviews($slug: String!, $page: PageInput) {\n    storefrontProductReviews(slug: $slug, page: $page) {\n      averageRating\n      reviewCount\n      distribution {\n        rating\n        count\n      }\n      page {\n        items {\n          id\n          authorName\n          rating\n          title\n          body\n          verifiedPurchase\n          reply\n          createdAt\n        }\n        pageInfo {\n          ...PageInfoFields\n        }\n      }\n    }\n  }\n": types.StorefrontProductReviewsDocument,
    "\n  mutation SubmitProductReview($slug: String!, $input: ProductReviewInput!) {\n    submitProductReview(slug: $slug, input: $input) {\n      id\n      status\n    }\n  }\n": types.SubmitProductReviewDocument,
    "\n  query StorefrontBrand($slug: String!) {\n    publicBusinessBrand(slug: $slug) {\n      businessName\n      description\n      primaryColor\n      secondaryColor\n      accentColor\n      headingFont\n      bodyFont\n      logo {\n        deliveryUrl\n      }\n    }\n  }\n": types.StorefrontBrandDocument,
    "\n  query StorefrontProfile {\n    storefrontProfile {\n      name\n      tagline\n      description\n      logoUrl\n      contactEmail\n      contactPhone\n      whatsappPhone\n      openingHours\n      serviceArea\n      address {\n        line1\n        line2\n        city\n        stateRegion\n        postalCode\n        countryCode\n      }\n      socialLinks {\n        network\n        url\n      }\n    }\n  }\n": types.StorefrontProfileDocument,
    "\n  query StorefrontFeatures {\n    storefrontFeatures {\n      currency\n      countryCode\n      capabilities\n      businessTypes {\n        key\n        name\n        categoryKey\n      }\n    }\n  }\n": types.StorefrontFeaturesDocument,
    "\n  fragment StorefrontImageFields on StorefrontImage {\n    assetId\n    url\n    alt\n  }\n": types.StorefrontImageFieldsFragmentDoc,
    "\n  fragment StorefrontHomePageFields on StorefrontHomePage {\n    announcement\n    hero {\n      layout\n      slides {\n        image {\n          ...StorefrontImageFields\n        }\n        eyebrow\n        headline\n        subheading\n        action {\n          label\n          href\n        }\n      }\n      eyebrow\n      headline\n      highlight\n      subheading\n      primaryAction {\n        label\n        href\n      }\n      secondaryAction {\n        label\n        href\n      }\n      images {\n        ...StorefrontImageFields\n      }\n      video {\n        assetId\n        url\n      }\n      badge {\n        value\n        label\n      }\n      showRating\n    }\n    stats {\n      value\n      label\n    }\n    sections {\n      id\n      kind\n      layout\n      visible\n      eyebrow\n      title\n      body\n      images {\n        ...StorefrontImageFields\n      }\n      video {\n        assetId\n        url\n      }\n      link {\n        label\n        href\n      }\n      collectionSlug\n      recordType\n      itemLimit\n    }\n    updatedAt\n  }\n": types.StorefrontHomePageFieldsFragmentDoc,
    "\n  query StorefrontHomePage {\n    storefrontHomePage {\n      ...StorefrontHomePageFields\n    }\n  }\n": types.StorefrontHomePageDocument,
    "\n  query StorefrontPage($path: String!) {\n    storefrontPage(path: $path) {\n      path\n      kind\n      title\n      summary\n      body\n      images {\n        ...StorefrontImageFields\n      }\n      faq {\n        question\n        answer\n      }\n      updatedAt\n    }\n  }\n": types.StorefrontPageDocument,
    "\n  query StorefrontPages($filter: StorefrontPageFilter, $page: PageInput) {\n    storefrontPages(filter: $filter, page: $page) {\n      items {\n        path\n        kind\n        title\n        summary\n        authorName\n        publishedAt\n        image {\n          ...StorefrontImageFields\n        }\n      }\n      pageInfo {\n        hasMore\n        nextCursor\n      }\n    }\n  }\n": types.StorefrontPagesDocument,
    "\n  query StorefrontReviews($page: PageInput) {\n    storefrontReviews(page: $page) {\n      items {\n        id\n        authorName\n        rating\n        title\n        body\n        reply\n        verifiedPurchase\n        createdAt\n        product {\n          slug\n          title\n          imageUrl\n        }\n      }\n      pageInfo {\n        ...PageInfoFields\n      }\n    }\n    storefrontRatingSummary {\n      averageRating\n      reviewCount\n      distribution {\n        rating\n        count\n      }\n    }\n  }\n": types.StorefrontReviewsDocument,
    "\n  query StorefrontRecordTypes {\n    storefrontRecordTypes {\n      key\n      name\n      description\n      access\n      fields {\n        key\n        label\n        type\n        description\n        required\n        filterable\n        searchable\n        options {\n          value\n          label\n        }\n        min\n        max\n        referenceTo\n      }\n    }\n  }\n": types.StorefrontRecordTypesDocument,
    "\n  query StorefrontRecords(\n    $type: String!\n    $filters: [EntityRecordFilterInput!]\n    $q: String\n    $page: PageInput\n  ) {\n    storefrontRecords(type: $type, filters: $filters, q: $q, page: $page) {\n      items {\n        id\n        type\n        data\n        createdAt\n        updatedAt\n      }\n      pageInfo {\n        ...PageInfoFields\n      }\n    }\n  }\n": types.StorefrontRecordsDocument,
    "\n  query StorefrontRecord($type: String!, $id: ID!) {\n    storefrontRecord(type: $type, id: $id) {\n      id\n      type\n      data\n      createdAt\n      updatedAt\n    }\n  }\n": types.StorefrontRecordDocument,
    "\n  mutation SubmitStorefrontRecord($type: String!, $data: JSON!) {\n    submitStorefrontRecord(type: $type, data: $data) {\n      id\n      type\n      createdAt\n    }\n  }\n": types.SubmitStorefrontRecordDocument,
    "\n  subscription PaymentSessionActivity($token: String!) {\n    paymentSessionActivity(token: $token) {\n      kind\n      at\n    }\n  }\n": types.PaymentSessionActivityDocument,
    "\n  query MyStorefrontRecords($type: String) {\n    myStorefrontRecords(type: $type) {\n      id\n      type\n      typeName\n      data\n      progress {\n        field\n        label\n        value\n        valueLabel\n      }\n      archived\n      createdAt\n      updatedAt\n    }\n  }\n": types.MyStorefrontRecordsDocument,
    "\n  fragment StorefrontBookableFields on StorefrontBookable {\n    id\n    slug\n    name\n    description\n    unit\n    slotMinutes\n    minUnits\n    maxUnits\n    maxQuantity\n    checkInTime\n    checkOutTime\n    eventStartsAt\n    eventEndsAt\n    timezone\n    payment\n    confirmation\n    cancellationHours\n    depositPercent\n    maxOccurrences\n    price {\n      amount\n      currency\n      per\n    }\n    priceRules {\n      label\n      weekdays\n      startDate\n      endDate\n      amount\n      currency\n    }\n    images {\n      ...StorefrontImageFields\n    }\n    media {\n      assetId\n      kind\n      url\n      poster\n    }\n    rules {\n      weekday\n      startTime\n      endTime\n    }\n  }\n": types.StorefrontBookableFieldsFragmentDoc,
    "\n  query StorefrontBookables {\n    storefrontBookables {\n      ...StorefrontBookableFields\n    }\n  }\n": types.StorefrontBookablesDocument,
    "\n  query StorefrontBookable($slug: String!) {\n    storefrontBookable(slug: $slug) {\n      ...StorefrontBookableFields\n    }\n  }\n": types.StorefrontBookableDocument,
    "\n  query BookableAvailability($slug: String!, $from: String!, $to: String!) {\n    bookableAvailability(slug: $slug, from: $from, to: $to) {\n      unit\n      days {\n        date\n        remaining\n      }\n      slots {\n        startsAt\n        endsAt\n        remaining\n      }\n    }\n  }\n": types.BookableAvailabilityDocument,
    "\n  query QuoteBooking($input: BookingRequestInput!) {\n    quoteBooking(input: $input) {\n      startsAt\n      endsAt\n      units\n      quantity\n      occurrences {\n        startsAt\n        endsAt\n        available\n      }\n      lines {\n        label\n        unitPrice\n        quantity\n        amount\n      }\n      subtotal\n      discount\n      total\n      deposit\n      dueNow\n      balance\n      currency\n      payment\n      available\n    }\n  }\n": types.QuoteBookingDocument,
    "\n  fragment ShopperBookingFields on ShopperBooking {\n    reference\n    status\n    bookable {\n      slug\n      name\n      unit\n    }\n    startsAt\n    endsAt\n    units\n    quantity\n    guestName\n    occurrences {\n      reference\n      startsAt\n      endsAt\n      status\n    }\n    subtotal\n    discountTotal\n    couponCode\n    total\n    currency\n    depositAmount\n    balanceDue\n    balancePaid\n    paid\n    holdExpiresAt\n    canCancel\n    canPayBalance\n    createdAt\n  }\n": types.ShopperBookingFieldsFragmentDoc,
    "\n  mutation CreateBooking($input: CreateBookingInput!) {\n    createBooking(input: $input) {\n      accessToken\n      sessionToken\n      booking {\n        ...ShopperBookingFields\n      }\n      payment {\n        method\n        reference\n        checkoutUrl\n        bankTransfer {\n          bankName\n          accountName\n          accountNumber\n          instructions\n          amount\n          currency\n          reference\n          expiresAt\n        }\n      }\n    }\n  }\n": types.CreateBookingDocument,
    "\n  query MyBooking($token: String!) {\n    myBooking(token: $token) {\n      ...ShopperBookingFields\n    }\n  }\n": types.MyBookingDocument,
    "\n  mutation CancelMyBooking($token: String!) {\n    cancelMyBooking(token: $token) {\n      ...ShopperBookingFields\n    }\n  }\n": types.CancelMyBookingDocument,
    "\n  query CustomerBookings {\n    customerBookings {\n      ...ShopperBookingFields\n    }\n  }\n": types.CustomerBookingsDocument,
    "\n  mutation PayBookingBalance($token: String!, $paymentMethod: String) {\n    payBookingBalance(token: $token, paymentMethod: $paymentMethod) {\n      sessionToken\n      payment {\n        method\n        reference\n        checkoutUrl\n        bankTransfer {\n          bankName\n          accountName\n          accountNumber\n          instructions\n          amount\n          currency\n          reference\n          expiresAt\n        }\n      }\n    }\n  }\n": types.PayBookingBalanceDocument,
    "\n  query StorefrontPaymentMethods {\n    storefrontPaymentMethods {\n      online\n      bankTransfer\n    }\n  }\n": types.StorefrontPaymentMethodsDocument,
    "\n  query StorefrontFontCatalog {\n    brandingCatalog {\n      fonts {\n        key\n        family\n        googleFamily\n      }\n    }\n  }\n": types.StorefrontFontCatalogDocument,
    "\n  mutation SubscribeToNewsletter($input: NewsletterSignupInput!) {\n    subscribeToNewsletter(input: $input)\n  }\n": types.SubscribeToNewsletterDocument,
    "\n  mutation SubmitReport($input: SubmitReportInput!) {\n    submitReport(input: $input)\n  }\n": types.SubmitReportDocument,
};

/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query CartlySdkTypeAnchors($homePage: StorefrontHomePageInput) {\n  __typename\n}"): typeof import('./graphql').CartlySdkTypeAnchorsDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query Viewer {\n    viewer {\n      id\n      email\n      displayName\n      emailVerified\n      mfaEnabled\n      businesses {\n        id\n        name\n        slug\n        status\n        verticals\n        roles {\n          key\n          name\n        }\n      }\n    }\n  }\n"): typeof import('./graphql').ViewerDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment PaymentSessionFields on PaymentSessionView {\n    status\n    resourceType\n    amount\n    currency\n    methods\n    method\n    paymentReference\n    expiresAt\n    completedAt\n    title\n    merchant {\n      name\n      logoUrl\n      primaryColor\n      accentColor\n      headingFont\n      bodyFont\n    }\n    lines {\n      description\n      quantity\n      amount\n    }\n    bankTransfer {\n      bankName\n      accountName\n      accountNumber\n      instructions\n      reference\n      submittedAt\n      rejectionReason\n    }\n    cashOnDeliveryInstructions\n  }\n"): typeof import('./graphql').PaymentSessionFieldsFragmentDoc;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query PaymentSession($token: String!) {\n    paymentSession(token: $token) {\n      ...PaymentSessionFields\n    }\n  }\n"): typeof import('./graphql').PaymentSessionDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation RefreshPaymentSession($token: String!) {\n    refreshPaymentSession(token: $token) {\n      ...PaymentSessionFields\n    }\n  }\n"): typeof import('./graphql').RefreshPaymentSessionDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation StartPaymentSession($token: String!, $method: String!) {\n    startPaymentSession(token: $token, method: $method) {\n      checkoutUrl\n    }\n  }\n"): typeof import('./graphql').StartPaymentSessionDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation SubmitBankTransferProof(\n    $token: String!\n    $input: BankTransferProofInput!\n  ) {\n    submitBankTransferProof(token: $token, input: $input) {\n      ...PaymentSessionFields\n    }\n  }\n"): typeof import('./graphql').SubmitBankTransferProofDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment ListingCardFields on PublicProperty {\n    id\n    slug\n    title\n    referenceCode\n    category\n    listingType\n    status\n    price\n    priceOnRequest\n    pricePeriod\n    currency\n    bedrooms\n    bathrooms\n    city\n    stateRegion\n    media {\n      id\n      url\n      caption\n      kind\n      isFloorPlan\n    }\n  }\n"): typeof import('./graphql').ListingCardFieldsFragmentDoc;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query Listings($filter: PublicPropertyFilter, $page: PageInput) {\n    listings(filter: $filter, page: $page) {\n      items {\n        ...ListingCardFields\n      }\n      pageInfo {\n        ...PageInfoFields\n      }\n    }\n  }\n"): typeof import('./graphql').ListingsDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query Listing($slug: String!) {\n    listing(slug: $slug) {\n      ...ListingCardFields\n      description\n      seoTitle\n      seoDescription\n      availableFrom\n      condition\n      furnishing\n      floorAreaSqm\n      landAreaSqm\n      parkingSpaces\n      toilets\n      serviceCharge\n      yearBuilt\n      publishedAt\n      propertyType {\n        name\n        slug\n      }\n      sellOnline\n      purchasable\n      paymentOptions {\n        planId\n        kind\n        label\n        description\n        dueNow\n        balance\n        schedule {\n          sequence\n          dueDate\n          amount\n        }\n      }\n      documents {\n        id\n        title\n        kind\n        mimeType\n        url\n      }\n      collectionIds\n      categoryIds\n    }\n  }\n"): typeof import('./graphql').ListingDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation SubmitPropertyEnquiry($input: PublicEnquiryInput!) {\n    submitPropertyEnquiry(input: $input) {\n      id\n      status\n    }\n  }\n"): typeof import('./graphql').SubmitPropertyEnquiryDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation RequestPropertyViewing($input: PublicViewingInput!) {\n    requestPropertyViewing(input: $input) {\n      id\n      status\n    }\n  }\n"): typeof import('./graphql').RequestPropertyViewingDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query NearbyListings($near: GeoNearInput!, $limit: Int) {\n    nearbyListings(near: $near, limit: $limit) {\n      distanceMeters\n      listing {\n        ...ListingCardFields\n      }\n    }\n  }\n"): typeof import('./graphql').NearbyListingsDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query StorefrontSeo($input: SeoDocumentInput!) {\n    storefrontSeo(input: $input) {\n      title\n      description\n      canonicalUrl\n      robots\n      indexing\n      jsonLdScript\n      lastModified\n      openGraph {\n        type\n        title\n        description\n        url\n        siteName\n        locale\n        images {\n          url\n          width\n          height\n          alt\n        }\n      }\n      twitter {\n        card\n        title\n        description\n        site\n        image\n        imageAlt\n      }\n      breadcrumbs {\n        name\n        url\n      }\n      verification {\n        google\n        bing\n      }\n    }\n  }\n"): typeof import('./graphql').StorefrontSeoDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query StorefrontSitemap($name: String) {\n    storefrontSitemap(name: $name) {\n      contentType\n      body\n    }\n  }\n"): typeof import('./graphql').StorefrontSitemapDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query StorefrontRobotsTxt {\n    storefrontRobotsTxt {\n      contentType\n      body\n    }\n  }\n"): typeof import('./graphql').StorefrontRobotsTxtDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query StorefrontLlmsTxt {\n    storefrontLlmsTxt {\n      contentType\n      body\n    }\n  }\n"): typeof import('./graphql').StorefrontLlmsTxtDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query StorefrontCanonicalHost($requestHost: String) {\n    storefrontCanonicalHost(requestHost: $requestHost) {\n      canonicalHost\n      redirectTo\n    }\n  }\n"): typeof import('./graphql').StorefrontCanonicalHostDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query StorefrontRouting($requestHost: String) {\n    storefrontCanonicalHost(requestHost: $requestHost) {\n      businessSlug\n      appKey\n      canonicalHost\n      redirectTo\n      selfBuilt\n    }\n  }\n"): typeof import('./graphql').StorefrontRoutingDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query StorefrontRoute {\n    storefrontRoute {\n      renderer\n      live\n    }\n  }\n"): typeof import('./graphql').StorefrontRouteDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query StorefrontIndexNowKey($key: String!) {\n    storefrontIndexNowKey(key: $key) {\n      contentType\n      body\n    }\n  }\n"): typeof import('./graphql').StorefrontIndexNowKeyDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query StorefrontRedirect($path: String!) {\n    storefrontRedirect(path: $path) {\n      location\n      permanent\n    }\n  }\n"): typeof import('./graphql').StorefrontRedirectDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query StorefrontVisualPage($path: String!) {\n    storefrontVisualPage(path: $path) {\n      page {\n        id\n        kind\n        path\n        title\n        seoTitle\n        seoDescription\n        noIndex\n        socialImageUrl\n      }\n      document\n      theme\n      navigation {\n        label\n        href\n      }\n      data\n      preview\n    }\n  }\n"): typeof import('./graphql').StorefrontVisualPageDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query StorefrontVisualChrome {\n    storefrontVisualChrome {\n      header\n      footer\n      theme\n      navigation {\n        label\n        href\n      }\n      data\n    }\n  }\n"): typeof import('./graphql').StorefrontVisualChromeDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query StorefrontPagePreview($token: String!) {\n    storefrontPagePreview(token: $token) {\n      page {\n        id\n        kind\n        path\n        title\n        seoTitle\n        seoDescription\n        noIndex\n        socialImageUrl\n      }\n      document\n      header\n      footer\n      theme\n      navigation {\n        label\n        href\n      }\n      data\n      preview\n    }\n  }\n"): typeof import('./graphql').StorefrontPagePreviewDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment PageInfoFields on PageInfo {\n    nextCursor\n    hasMore\n    limit\n  }\n"): typeof import('./graphql').PageInfoFieldsFragmentDoc;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment StorefrontProductCardFields on StorefrontProduct {\n    id\n    slug\n    title\n    description\n    media {\n      id\n      url\n      altText\n      kind\n    }\n    variants {\n      id\n      price\n      compareAtPrice\n      currency\n      inStock\n      lowStock\n    }\n  }\n"): typeof import('./graphql').StorefrontProductCardFieldsFragmentDoc;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query StorefrontProducts(\n    $filter: StorefrontProductFilter\n    $sort: StorefrontProductSort\n    $page: PageInput\n  ) {\n    storefrontProducts(filter: $filter, sort: $sort, page: $page) {\n      items {\n        ...StorefrontProductCardFields\n      }\n      pageInfo {\n        ...PageInfoFields\n      }\n    }\n  }\n"): typeof import('./graphql').StorefrontProductsDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query StorefrontProduct($slug: String!) {\n    storefrontProduct(slug: $slug) {\n      ...StorefrontProductCardFields\n      description\n      seoTitle\n      seoDescription\n      tags\n      categoryIds\n      attributes {\n        code\n        name\n        value\n      }\n      variants {\n        sku\n        title\n        options {\n          name\n          value\n        }\n      }\n      options {\n        name\n        values\n      }\n      media {\n        variantId\n      }\n    }\n  }\n"): typeof import('./graphql').StorefrontProductDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query StorefrontCategories {\n    storefrontCategories {\n      id\n      name\n      slug\n      parentId\n      description\n      imageUrl\n      productCount\n    }\n  }\n"): typeof import('./graphql').StorefrontCategoriesDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment CartFields on Cart {\n    currency\n    propertyItems {\n      propertyId\n      slug\n      title\n      referenceCode\n      imageUrl\n      planId\n      planKind\n      planLabel\n      dueNow\n      balance\n      schedule {\n        sequence\n        dueDate\n        amount\n      }\n    }\n    items {\n      variantId\n      sku\n      productTitle\n      productSlug\n      imageUrl\n      variantTitle\n      quantity\n      unitPrice\n      lineTotal\n    }\n    subtotal\n    discountTotal\n    shippingTotal\n    taxTotal\n    total\n  }\n"): typeof import('./graphql').CartFieldsFragmentDoc;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CreateCart {\n    createCart {\n      cartId\n      cartToken\n      currency\n    }\n  }\n"): typeof import('./graphql').CreateCartDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query Cart {\n    cart {\n      ...CartFields\n    }\n  }\n"): typeof import('./graphql').CartDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query PreviewCartCoupon($code: String!, $email: String) {\n    previewCartCoupon(code: $code, email: $email) {\n      ...CartFields\n    }\n  }\n"): typeof import('./graphql').PreviewCartCouponDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation SetCartItem($variantId: ID!, $quantity: Int!) {\n    setCartItem(variantId: $variantId, quantity: $quantity) {\n      ...CartFields\n    }\n  }\n"): typeof import('./graphql').SetCartItemDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation RemoveCartItem($variantId: ID!) {\n    removeCartItem(variantId: $variantId) {\n      ...CartFields\n    }\n  }\n"): typeof import('./graphql').RemoveCartItemDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation SetCartProperty($propertyId: ID!, $planId: ID) {\n    setCartProperty(propertyId: $propertyId, planId: $planId) {\n      ...CartFields\n    }\n  }\n"): typeof import('./graphql').SetCartPropertyDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation RemoveCartProperty($propertyId: ID!) {\n    removeCartProperty(propertyId: $propertyId) {\n      ...CartFields\n    }\n  }\n"): typeof import('./graphql').RemoveCartPropertyDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query StorefrontServiceCoverage($latitude: Float!, $longitude: Float!) {\n    storefrontServiceCoverage(latitude: $latitude, longitude: $longitude) {\n      enabled\n      covered\n      areas {\n        id\n        name\n      }\n    }\n  }\n"): typeof import('./graphql').StorefrontServiceCoverageDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query IntroductoryOffer {\n    introductoryOffer {\n      available\n      durationMonths\n      package {\n        key\n        name\n      }\n    }\n  }\n"): typeof import('./graphql').IntroductoryOfferDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query StorefrontCheckoutOptions {\n    storefrontShippingMethods {\n      id\n      name\n      description\n      price\n      currency\n      rateType\n      minOrderSubtotal\n      estimatedMinDays\n      estimatedMaxDays\n      countryCodes\n    }\n    storefrontPaymentMethods {\n      online\n      bankTransfer\n      cashOnDelivery\n      cashOnDeliveryCountries\n    }\n  }\n"): typeof import('./graphql').StorefrontCheckoutOptionsDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation Checkout($input: CheckoutInput!) {\n    checkout(input: $input) {\n      orderId\n      orderNumber\n      total\n      currency\n      sessionToken\n      payment {\n        method\n        checkoutUrl\n        reference\n        bankTransfer {\n          bankName\n          accountName\n          accountNumber\n          amount\n          currency\n          reference\n          instructions\n          expiresAt\n        }\n      }\n    }\n  }\n"): typeof import('./graphql').CheckoutDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation ContactBusiness($input: CustomerConversationInput!) {\n    contactBusiness(input: $input) {\n      conversationId\n      accessToken\n    }\n  }\n"): typeof import('./graphql').ContactBusinessDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query MyConversation {\n    myConversation {\n      id\n      subject\n      status\n      messages {\n        id\n        body\n        createdAt\n        senderType\n        senderName\n      }\n    }\n  }\n"): typeof import('./graphql').MyConversationDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation ReplyAsCustomer($body: String!) {\n    replyAsCustomer(body: $body) {\n      id\n    }\n  }\n"): typeof import('./graphql').ReplyAsCustomerDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation RegisterCustomer(\n    $email: String!\n    $password: String!\n    $firstName: String\n    $lastName: String\n  ) {\n    registerCustomer(\n      email: $email\n      password: $password\n      firstName: $firstName\n      lastName: $lastName\n    )\n  }\n"): typeof import('./graphql').RegisterCustomerDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation VerifyCustomerEmail($token: String!) {\n    verifyCustomerEmail(token: $token)\n  }\n"): typeof import('./graphql').VerifyCustomerEmailDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query StorefrontSignInProviders {\n    storefrontSignInProviders\n  }\n"): typeof import('./graphql').StorefrontSignInProvidersDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CustomerProviderSignIn($code: String!) {\n    customerProviderSignIn(code: $code) {\n      token\n      expiresAt\n    }\n  }\n"): typeof import('./graphql').CustomerProviderSignInDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CustomerLogin($email: String!, $password: String!) {\n    customerLogin(email: $email, password: $password) {\n      token\n      expiresAt\n    }\n  }\n"): typeof import('./graphql').CustomerLoginDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CustomerLogout {\n    customerLogout\n  }\n"): typeof import('./graphql').CustomerLogoutDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation RequestCustomerPasswordReset($email: String!) {\n    requestCustomerPasswordReset(email: $email)\n  }\n"): typeof import('./graphql').RequestCustomerPasswordResetDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation ResetCustomerPassword($token: String!, $password: String!) {\n    resetCustomerPassword(token: $token, password: $password)\n  }\n"): typeof import('./graphql').ResetCustomerPasswordDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CustomerAccount {\n    customerAccount {\n      email\n      firstName\n      lastName\n      phone\n      createdAt\n    }\n    customerOrders {\n      orderNumber\n      status\n      paymentStatus\n      fulfillmentStatus\n      currency\n      total\n      itemCount\n      placedAt\n    }\n  }\n"): typeof import('./graphql').CustomerAccountDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CustomerOrderHistory($page: PageInput) {\n    customerOrderHistory(page: $page) {\n      items {\n        orderNumber\n        status\n        paymentStatus\n        fulfillmentStatus\n        currency\n        total\n        itemCount\n        placedAt\n      }\n      pageInfo {\n        nextCursor\n        hasMore\n      }\n    }\n  }\n"): typeof import('./graphql').CustomerOrderHistoryDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CustomerOrder($orderNumber: Int!) {\n    customerOrder(orderNumber: $orderNumber) {\n      orderNumber\n      status\n      paymentStatus\n      fulfillmentStatus\n      placedAt\n      currency\n      subtotal\n      discountTotal\n      shippingTotal\n      taxTotal\n      total\n      note\n      paymentMethod\n      shippingMethodName\n      shippingAddress {\n        recipientName\n        phone\n        line1\n        line2\n        city\n        stateRegion\n        postalCode\n        countryCode\n      }\n      lines {\n        productTitle\n        variantTitle\n        sku\n        quantity\n        unitPrice\n        lineTotal\n        productSlug\n        propertySlug\n        imageUrl\n      }\n      instalments {\n        id\n        title\n        sequence\n        count\n        dueDate\n        amount\n        currency\n        status\n        paidAt\n        canPay\n      }\n      events {\n        kind\n        at\n      }\n      canPay\n    }\n  }\n"): typeof import('./graphql').CustomerOrderDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation ResumeCustomerOrderPayment($orderNumber: Int!) {\n    resumeCustomerOrderPayment(orderNumber: $orderNumber)\n  }\n"): typeof import('./graphql').ResumeCustomerOrderPaymentDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation PayCustomerInstalment(\n    $orderNumber: Int!\n    $instalmentId: ID!\n    $paymentMethod: CheckoutPaymentMethod\n  ) {\n    payCustomerInstalment(\n      orderNumber: $orderNumber\n      instalmentId: $instalmentId\n      paymentMethod: $paymentMethod\n    )\n  }\n"): typeof import('./graphql').PayCustomerInstalmentDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment ShopperAddressFields on CustomerAddress {\n    id\n    label\n    recipientName\n    phone\n    line1\n    line2\n    city\n    stateRegion\n    postalCode\n    countryCode\n    isDefaultShipping\n    isDefaultBilling\n  }\n"): typeof import('./graphql').ShopperAddressFieldsFragmentDoc;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query ShopperAddresses {\n    shopperAddresses {\n      ...ShopperAddressFields\n    }\n  }\n"): typeof import('./graphql').ShopperAddressesDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation SaveShopperAddress($input: CustomerAddressInput!, $id: ID) {\n    saveShopperAddress(input: $input, id: $id) {\n      ...ShopperAddressFields\n    }\n  }\n"): typeof import('./graphql').SaveShopperAddressDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation DeleteShopperAddress($id: ID!) {\n    deleteShopperAddress(id: $id)\n  }\n"): typeof import('./graphql').DeleteShopperAddressDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CustomerReviews($page: PageInput) {\n    customerReviews(page: $page) {\n      items {\n        id\n        rating\n        title\n        body\n        status\n        verifiedPurchase\n        reply\n        createdAt\n        product {\n          slug\n          title\n          imageUrl\n        }\n      }\n      pageInfo {\n        nextCursor\n        hasMore\n      }\n    }\n  }\n"): typeof import('./graphql').CustomerReviewsDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query SavedItems($page: PageInput) {\n    savedItems(page: $page) {\n      items {\n        kind\n        slug\n        title\n        imageUrl\n        price\n        currency\n        available\n        savedAt\n      }\n      pageInfo {\n        nextCursor\n        hasMore\n      }\n    }\n  }\n"): typeof import('./graphql').SavedItemsDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation SaveItem($kind: SavedItemKind!, $slug: String!) {\n    saveItem(kind: $kind, slug: $slug) {\n      kind\n      slug\n      saved\n    }\n  }\n"): typeof import('./graphql').SaveItemDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation UnsaveItem($kind: SavedItemKind!, $slug: String!) {\n    unsaveItem(kind: $kind, slug: $slug) {\n      kind\n      slug\n      saved\n    }\n  }\n"): typeof import('./graphql').UnsaveItemDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation RequestCustomerEmailChange($newEmail: String!, $password: String!) {\n    requestCustomerEmailChange(newEmail: $newEmail, password: $password)\n  }\n"): typeof import('./graphql').RequestCustomerEmailChangeDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation UpdateCustomerAccount(\n    $firstName: String\n    $lastName: String\n    $phone: String\n  ) {\n    updateCustomerAccount(\n      firstName: $firstName\n      lastName: $lastName\n      phone: $phone\n    ) {\n      firstName\n      lastName\n      phone\n    }\n  }\n"): typeof import('./graphql').UpdateCustomerAccountDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation ChangeCustomerPassword(\n    $currentPassword: String!\n    $newPassword: String!\n  ) {\n    changeCustomerPassword(\n      currentPassword: $currentPassword\n      newPassword: $newPassword\n    )\n  }\n"): typeof import('./graphql').ChangeCustomerPasswordDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query StorefrontCollections {\n    storefrontCollections {\n      id\n      title\n      slug\n      description\n      imageUrl\n      productCount\n    }\n  }\n"): typeof import('./graphql').StorefrontCollectionsDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query StorefrontCollection($slug: String!) {\n    storefrontCollection(slug: $slug) {\n      id\n      title\n      slug\n      description\n      imageUrl\n      productCount\n      products {\n        ...StorefrontProductCardFields\n      }\n    }\n  }\n"): typeof import('./graphql').StorefrontCollectionDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query StorefrontProductReviews($slug: String!, $page: PageInput) {\n    storefrontProductReviews(slug: $slug, page: $page) {\n      averageRating\n      reviewCount\n      distribution {\n        rating\n        count\n      }\n      page {\n        items {\n          id\n          authorName\n          rating\n          title\n          body\n          verifiedPurchase\n          reply\n          createdAt\n        }\n        pageInfo {\n          ...PageInfoFields\n        }\n      }\n    }\n  }\n"): typeof import('./graphql').StorefrontProductReviewsDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation SubmitProductReview($slug: String!, $input: ProductReviewInput!) {\n    submitProductReview(slug: $slug, input: $input) {\n      id\n      status\n    }\n  }\n"): typeof import('./graphql').SubmitProductReviewDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query StorefrontBrand($slug: String!) {\n    publicBusinessBrand(slug: $slug) {\n      businessName\n      description\n      primaryColor\n      secondaryColor\n      accentColor\n      headingFont\n      bodyFont\n      logo {\n        deliveryUrl\n      }\n    }\n  }\n"): typeof import('./graphql').StorefrontBrandDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query StorefrontProfile {\n    storefrontProfile {\n      name\n      tagline\n      description\n      logoUrl\n      contactEmail\n      contactPhone\n      whatsappPhone\n      openingHours\n      serviceArea\n      address {\n        line1\n        line2\n        city\n        stateRegion\n        postalCode\n        countryCode\n      }\n      socialLinks {\n        network\n        url\n      }\n    }\n  }\n"): typeof import('./graphql').StorefrontProfileDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query StorefrontFeatures {\n    storefrontFeatures {\n      currency\n      countryCode\n      capabilities\n      businessTypes {\n        key\n        name\n        categoryKey\n      }\n    }\n  }\n"): typeof import('./graphql').StorefrontFeaturesDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment StorefrontImageFields on StorefrontImage {\n    assetId\n    url\n    alt\n  }\n"): typeof import('./graphql').StorefrontImageFieldsFragmentDoc;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment StorefrontHomePageFields on StorefrontHomePage {\n    announcement\n    hero {\n      layout\n      slides {\n        image {\n          ...StorefrontImageFields\n        }\n        eyebrow\n        headline\n        subheading\n        action {\n          label\n          href\n        }\n      }\n      eyebrow\n      headline\n      highlight\n      subheading\n      primaryAction {\n        label\n        href\n      }\n      secondaryAction {\n        label\n        href\n      }\n      images {\n        ...StorefrontImageFields\n      }\n      video {\n        assetId\n        url\n      }\n      badge {\n        value\n        label\n      }\n      showRating\n    }\n    stats {\n      value\n      label\n    }\n    sections {\n      id\n      kind\n      layout\n      visible\n      eyebrow\n      title\n      body\n      images {\n        ...StorefrontImageFields\n      }\n      video {\n        assetId\n        url\n      }\n      link {\n        label\n        href\n      }\n      collectionSlug\n      recordType\n      itemLimit\n    }\n    updatedAt\n  }\n"): typeof import('./graphql').StorefrontHomePageFieldsFragmentDoc;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query StorefrontHomePage {\n    storefrontHomePage {\n      ...StorefrontHomePageFields\n    }\n  }\n"): typeof import('./graphql').StorefrontHomePageDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query StorefrontPage($path: String!) {\n    storefrontPage(path: $path) {\n      path\n      kind\n      title\n      summary\n      body\n      images {\n        ...StorefrontImageFields\n      }\n      faq {\n        question\n        answer\n      }\n      updatedAt\n    }\n  }\n"): typeof import('./graphql').StorefrontPageDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query StorefrontPages($filter: StorefrontPageFilter, $page: PageInput) {\n    storefrontPages(filter: $filter, page: $page) {\n      items {\n        path\n        kind\n        title\n        summary\n        authorName\n        publishedAt\n        image {\n          ...StorefrontImageFields\n        }\n      }\n      pageInfo {\n        hasMore\n        nextCursor\n      }\n    }\n  }\n"): typeof import('./graphql').StorefrontPagesDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query StorefrontReviews($page: PageInput) {\n    storefrontReviews(page: $page) {\n      items {\n        id\n        authorName\n        rating\n        title\n        body\n        reply\n        verifiedPurchase\n        createdAt\n        product {\n          slug\n          title\n          imageUrl\n        }\n      }\n      pageInfo {\n        ...PageInfoFields\n      }\n    }\n    storefrontRatingSummary {\n      averageRating\n      reviewCount\n      distribution {\n        rating\n        count\n      }\n    }\n  }\n"): typeof import('./graphql').StorefrontReviewsDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query StorefrontRecordTypes {\n    storefrontRecordTypes {\n      key\n      name\n      description\n      access\n      fields {\n        key\n        label\n        type\n        description\n        required\n        filterable\n        searchable\n        options {\n          value\n          label\n        }\n        min\n        max\n        referenceTo\n      }\n    }\n  }\n"): typeof import('./graphql').StorefrontRecordTypesDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query StorefrontRecords(\n    $type: String!\n    $filters: [EntityRecordFilterInput!]\n    $q: String\n    $page: PageInput\n  ) {\n    storefrontRecords(type: $type, filters: $filters, q: $q, page: $page) {\n      items {\n        id\n        type\n        data\n        createdAt\n        updatedAt\n      }\n      pageInfo {\n        ...PageInfoFields\n      }\n    }\n  }\n"): typeof import('./graphql').StorefrontRecordsDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query StorefrontRecord($type: String!, $id: ID!) {\n    storefrontRecord(type: $type, id: $id) {\n      id\n      type\n      data\n      createdAt\n      updatedAt\n    }\n  }\n"): typeof import('./graphql').StorefrontRecordDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation SubmitStorefrontRecord($type: String!, $data: JSON!) {\n    submitStorefrontRecord(type: $type, data: $data) {\n      id\n      type\n      createdAt\n    }\n  }\n"): typeof import('./graphql').SubmitStorefrontRecordDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  subscription PaymentSessionActivity($token: String!) {\n    paymentSessionActivity(token: $token) {\n      kind\n      at\n    }\n  }\n"): typeof import('./graphql').PaymentSessionActivityDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query MyStorefrontRecords($type: String) {\n    myStorefrontRecords(type: $type) {\n      id\n      type\n      typeName\n      data\n      progress {\n        field\n        label\n        value\n        valueLabel\n      }\n      archived\n      createdAt\n      updatedAt\n    }\n  }\n"): typeof import('./graphql').MyStorefrontRecordsDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment StorefrontBookableFields on StorefrontBookable {\n    id\n    slug\n    name\n    description\n    unit\n    slotMinutes\n    minUnits\n    maxUnits\n    maxQuantity\n    checkInTime\n    checkOutTime\n    eventStartsAt\n    eventEndsAt\n    timezone\n    payment\n    confirmation\n    cancellationHours\n    depositPercent\n    maxOccurrences\n    price {\n      amount\n      currency\n      per\n    }\n    priceRules {\n      label\n      weekdays\n      startDate\n      endDate\n      amount\n      currency\n    }\n    images {\n      ...StorefrontImageFields\n    }\n    media {\n      assetId\n      kind\n      url\n      poster\n    }\n    rules {\n      weekday\n      startTime\n      endTime\n    }\n  }\n"): typeof import('./graphql').StorefrontBookableFieldsFragmentDoc;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query StorefrontBookables {\n    storefrontBookables {\n      ...StorefrontBookableFields\n    }\n  }\n"): typeof import('./graphql').StorefrontBookablesDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query StorefrontBookable($slug: String!) {\n    storefrontBookable(slug: $slug) {\n      ...StorefrontBookableFields\n    }\n  }\n"): typeof import('./graphql').StorefrontBookableDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query BookableAvailability($slug: String!, $from: String!, $to: String!) {\n    bookableAvailability(slug: $slug, from: $from, to: $to) {\n      unit\n      days {\n        date\n        remaining\n      }\n      slots {\n        startsAt\n        endsAt\n        remaining\n      }\n    }\n  }\n"): typeof import('./graphql').BookableAvailabilityDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query QuoteBooking($input: BookingRequestInput!) {\n    quoteBooking(input: $input) {\n      startsAt\n      endsAt\n      units\n      quantity\n      occurrences {\n        startsAt\n        endsAt\n        available\n      }\n      lines {\n        label\n        unitPrice\n        quantity\n        amount\n      }\n      subtotal\n      discount\n      total\n      deposit\n      dueNow\n      balance\n      currency\n      payment\n      available\n    }\n  }\n"): typeof import('./graphql').QuoteBookingDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment ShopperBookingFields on ShopperBooking {\n    reference\n    status\n    bookable {\n      slug\n      name\n      unit\n    }\n    startsAt\n    endsAt\n    units\n    quantity\n    guestName\n    occurrences {\n      reference\n      startsAt\n      endsAt\n      status\n    }\n    subtotal\n    discountTotal\n    couponCode\n    total\n    currency\n    depositAmount\n    balanceDue\n    balancePaid\n    paid\n    holdExpiresAt\n    canCancel\n    canPayBalance\n    createdAt\n  }\n"): typeof import('./graphql').ShopperBookingFieldsFragmentDoc;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CreateBooking($input: CreateBookingInput!) {\n    createBooking(input: $input) {\n      accessToken\n      sessionToken\n      booking {\n        ...ShopperBookingFields\n      }\n      payment {\n        method\n        reference\n        checkoutUrl\n        bankTransfer {\n          bankName\n          accountName\n          accountNumber\n          instructions\n          amount\n          currency\n          reference\n          expiresAt\n        }\n      }\n    }\n  }\n"): typeof import('./graphql').CreateBookingDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query MyBooking($token: String!) {\n    myBooking(token: $token) {\n      ...ShopperBookingFields\n    }\n  }\n"): typeof import('./graphql').MyBookingDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CancelMyBooking($token: String!) {\n    cancelMyBooking(token: $token) {\n      ...ShopperBookingFields\n    }\n  }\n"): typeof import('./graphql').CancelMyBookingDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CustomerBookings {\n    customerBookings {\n      ...ShopperBookingFields\n    }\n  }\n"): typeof import('./graphql').CustomerBookingsDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation PayBookingBalance($token: String!, $paymentMethod: String) {\n    payBookingBalance(token: $token, paymentMethod: $paymentMethod) {\n      sessionToken\n      payment {\n        method\n        reference\n        checkoutUrl\n        bankTransfer {\n          bankName\n          accountName\n          accountNumber\n          instructions\n          amount\n          currency\n          reference\n          expiresAt\n        }\n      }\n    }\n  }\n"): typeof import('./graphql').PayBookingBalanceDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query StorefrontPaymentMethods {\n    storefrontPaymentMethods {\n      online\n      bankTransfer\n    }\n  }\n"): typeof import('./graphql').StorefrontPaymentMethodsDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query StorefrontFontCatalog {\n    brandingCatalog {\n      fonts {\n        key\n        family\n        googleFamily\n      }\n    }\n  }\n"): typeof import('./graphql').StorefrontFontCatalogDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation SubscribeToNewsletter($input: NewsletterSignupInput!) {\n    subscribeToNewsletter(input: $input)\n  }\n"): typeof import('./graphql').SubscribeToNewsletterDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation SubmitReport($input: SubmitReportInput!) {\n    submitReport(input: $input)\n  }\n"): typeof import('./graphql').SubmitReportDocument;


export function graphql(source: string) {
  return (documents as any)[source] ?? {};
}
