import { graphql } from "../gql"

/**
 * Website-builder pages for stores (X-Storefront-Host), from the server only.
 * Null answers mean the store doesn't use the builder (or nothing is
 * published at that path): draw the classic page. Previews (a token from the
 * dashboard) show drafts: never cache or index them.
 */

export const StorefrontVisualPageQuery = graphql(`
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
`)

export const StorefrontVisualChromeQuery = graphql(`
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
`)

export const StorefrontPagePreviewQuery = graphql(`
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
`)
