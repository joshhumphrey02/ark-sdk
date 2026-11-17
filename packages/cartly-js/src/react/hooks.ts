"use client"

import {
  useMutation,
  useQuery,
  type QueryKey,
  type UseMutationOptions,
  type UseQueryOptions,
} from "@tanstack/react-query"

import type { CartlyApiError } from "../errors"
import {
  operationName,
  type GraphQLClient,
  type TypedDocument,
} from "../graphql/client"
import { useGraphQLClient } from "./provider"

type VariablesOption<TVariables> =
  Record<string, never> extends TVariables
    ? { variables?: TVariables }
    : { variables: TVariables }

export type GraphQLQueryOptions<TResult, TVariables, TData> =
  VariablesOption<TVariables> &
    Omit<
      UseQueryOptions<TResult, CartlyApiError, TData>,
      "queryKey" | "queryFn"
    >

type OptionsArgs<TOptions, TVariables> =
  Record<string, never> extends TVariables
    ? [options?: TOptions]
    : [options: TOptions]

/**
 * `[operation, scope, variables]`. The scope holds only the tenant and
 * storefront host (never tokens), so cached data cannot leak across
 * businesses. Use it to invalidate: `queryClient.invalidateQueries({
 * queryKey: [operationName(OrdersQuery)] })`.
 */
export function graphQLQueryKey(
  document: { toString(): string },
  client: GraphQLClient,
  variables: unknown
): QueryKey {
  // Only non-secret scope values: ids and hostnames never include tokens.
  const {
    tenantId = null,
    accountId = null,
    storefrontHost = null,
  } = client.scope
  return [
    operationName(document),
    { tenantId, accountId, storefrontHost },
    variables ?? null,
  ]
}

function run<TResult, TVariables>(
  client: GraphQLClient,
  document: TypedDocument<TResult, TVariables>,
  variables: TVariables | undefined,
  signal?: AbortSignal
): Promise<TResult> {
  const scoped = signal ? client.with({}, { signal }) : client
  // The public signature enforces required variables at the call site.
  const request = scoped.request as (
    document: TypedDocument<TResult, TVariables>,
    variables?: TVariables
  ) => Promise<TResult>
  return request(document, variables)
}

export function useGraphQLQuery<TResult, TVariables, TData = TResult>(
  document: TypedDocument<TResult, TVariables>,
  ...[options]: OptionsArgs<
    GraphQLQueryOptions<TResult, TVariables, TData>,
    TVariables
  >
) {
  const client = useGraphQLClient()
  const { variables, ...queryOptions } = (options ?? {}) as {
    variables?: TVariables
  } & Omit<UseQueryOptions<TResult, CartlyApiError, TData>, "queryKey">
  return useQuery<TResult, CartlyApiError, TData>({
    ...queryOptions,
    queryKey: graphQLQueryKey(document, client, variables),
    queryFn: ({ signal }) => run(client, document, variables, signal),
  })
}

export function useGraphQLMutation<TResult, TVariables, TContext = unknown>(
  document: TypedDocument<TResult, TVariables>,
  options?: Omit<
    UseMutationOptions<TResult, CartlyApiError, TVariables, TContext>,
    "mutationFn"
  >
) {
  const client = useGraphQLClient()
  return useMutation<TResult, CartlyApiError, TVariables, TContext>({
    ...options,
    mutationFn: (variables) => run(client, document, variables),
  })
}
