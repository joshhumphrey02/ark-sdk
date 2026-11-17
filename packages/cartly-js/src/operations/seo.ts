import { graphql } from "../gql"

/*
 * Storefront SEO (public; need `storefrontHost`). Call them from the server so
 * every tag is in the initial HTML. See the backend's docs/SEO.md.
 */

export const StorefrontSeoQuery = graphql(`
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
`)

export const StorefrontSitemapQuery = graphql(`
  query StorefrontSitemap($name: String) {
    storefrontSitemap(name: $name) {
      contentType
      body
    }
  }
`)

export const StorefrontRobotsTxtQuery = graphql(`
  query StorefrontRobotsTxt {
    storefrontRobotsTxt {
      contentType
      body
    }
  }
`)

export const StorefrontLlmsTxtQuery = graphql(`
  query StorefrontLlmsTxt {
    storefrontLlmsTxt {
      contentType
      body
    }
  }
`)

export const StorefrontCanonicalHostQuery = graphql(`
  query StorefrontCanonicalHost($requestHost: String) {
    storefrontCanonicalHost(requestHost: $requestHost) {
      canonicalHost
      redirectTo
    }
  }
`)

/**
 * How a storefront request routes (send the request's host as
 * X-Storefront-Host): the business, the custom storefront app that renders
 * it (none when the merchant runs it themselves: selfBuilt), and a redirect
 * to its primary domain. NOT_FOUND for any hostname that
 * isn't an ACTIVE domain of a published store. Domains live only in Cartly.
 */
export const StorefrontRoutingQuery = graphql(`
  query StorefrontRouting($requestHost: String) {
    storefrontCanonicalHost(requestHost: $requestHost) {
      businessSlug
      appKey
      canonicalHost
      redirectTo
      selfBuilt
    }
  }
`)

/**
 * Which front-end draws the store at X-Storefront-Host and whether it is
 * online, answered for offline stores too (NOT_FOUND for a host no store
 * uses). The storefront engine serves only ENGINE hosts with it: the store
 * when live, else its "not online" page and draft previews.
 */
export const StorefrontRouteQuery = graphql(`
  query StorefrontRoute {
    storefrontRoute {
      renderer
      live
    }
  }
`)

export const StorefrontIndexNowKeyQuery = graphql(`
  query StorefrontIndexNowKey($key: String!) {
    storefrontIndexNowKey(key: $key) {
      contentType
      body
    }
  }
`)

/** Ask before answering 404: a renamed item's or the business's own redirect (permanent). */
export const StorefrontRedirectQuery = graphql(`
  query StorefrontRedirect($path: String!) {
    storefrontRedirect(path: $path) {
      location
      permanent
    }
  }
`)
