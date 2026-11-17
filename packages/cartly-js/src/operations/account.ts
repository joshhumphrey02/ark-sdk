import { graphql } from "../gql"

/** The signed-in user and the businesses they can act for (`X-Tenant-Id`). */
export const ViewerQuery = graphql(`
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
`)
