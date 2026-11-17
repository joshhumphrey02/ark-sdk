import { graphql } from "../gql"

/*
 * Cartly Checkout: one payment session per thing being paid for (a store
 * order from `checkout.sessionToken`, or a Cartly invoice from the
 * `paymentSessionToken` its flow returns). Public operations that take only
 * the session's token; amounts, methods and gateway are the server's.
 */

export const PaymentSessionFields = graphql(`
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
`)

/** A checkout by its token. */
export const PaymentSessionQuery = graphql(`
  query PaymentSession($token: String!) {
    paymentSession(token: $token) {
      ...PaymentSessionFields
    }
  }
`)

/** The checkout after asking the provider about its online payment: call it when the payer comes back. */
export const RefreshPaymentSessionMutation = graphql(`
  mutation RefreshPaymentSession($token: String!) {
    refreshPaymentSession(token: $token) {
      ...PaymentSessionFields
    }
  }
`)

/** Starts paying with one of the session's methods; ONLINE returns the provider page. */
export const StartPaymentSessionMutation = graphql(`
  mutation StartPaymentSession($token: String!, $method: String!) {
    startPaymentSession(token: $token, method: $method) {
      checkoutUrl
    }
  }
`)

/** The payer reports their bank transfer: evidence only, the business confirms it. */
export const SubmitBankTransferProofMutation = graphql(`
  mutation SubmitBankTransferProof(
    $token: String!
    $input: BankTransferProofInput!
  ) {
    submitBankTransferProof(token: $token, input: $input) {
      ...PaymentSessionFields
    }
  }
`)
