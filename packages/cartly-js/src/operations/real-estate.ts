import { graphql } from "../gql"

/*
 * Public real-estate listing operations. They need `storefrontHost` in the
 * request context; call them from the server.
 */

export const ListingCardFields = graphql(`
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
`)

export const ListingsQuery = graphql(`
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
`)

export const ListingQuery = graphql(`
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
`)

export const SubmitPropertyEnquiryMutation = graphql(`
  mutation SubmitPropertyEnquiry($input: PublicEnquiryInput!) {
    submitPropertyEnquiry(input: $input) {
      id
      status
    }
  }
`)

export const RequestPropertyViewingMutation = graphql(`
  mutation RequestPropertyViewing($input: PublicViewingInput!) {
    requestPropertyViewing(input: $input) {
      id
      status
    }
  }
`)

export const NearbyListingsQuery = graphql(`
  query NearbyListings($near: GeoNearInput!, $limit: Int) {
    nearbyListings(near: $near, limit: $limit) {
      distanceMeters
      listing {
        ...ListingCardFields
      }
    }
  }
`)
