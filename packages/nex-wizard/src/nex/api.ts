import { WizardError } from "../core/errors";

/** The production API. Override with --api-url or NEX_API_URL (self-hosted, staging). */
export const DEFAULT_API_URL = "https://nerdstackgrp.com/api/v1/monitoring";

export type Fetch = typeof fetch;

export type TokenPair = {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
  user: { id: string; email: string; name?: string | null };
};

export type Organization = { id: string; name: string; slug: string; role: string; permissions: string[] };
export type Environment = { id: string; name: string; slug: string; kind?: string };
export type ApplicationSummary = { id: string; name: string; slug: string };
export type Application = ApplicationSummary & { environments: Environment[]; services: { id: string; name: string; slug: string }[] };
export type ApiIndex = { web?: { url: string | null }; version?: string };
export type SdkConfig = { application: { id: string; name: string; slug: string }; environment: { id: string; name: string; slug: string } };

/** The API answered with an error status. */
export class ApiError extends WizardError {
  constructor(
    readonly status: number,
    readonly detail: string,
    hint?: string,
  ) {
    super(detail, hint);
    this.name = "ApiError";
  }
}

/** The API could not be reached at all. */
export class NetworkError extends WizardError {
  constructor(apiUrl: string, cause: unknown) {
    super(`Could not reach Nex at ${apiUrl}.`, `Check your internet connection${cause instanceof Error && cause.message ? ` (${cause.message})` : ""}, or set NEX_API_URL if you use another Nex server.`);
    this.name = "NetworkError";
  }
}

function hintFor(status: number): string | undefined {
  if (status === 401) return "Your sign-in has expired. Run the wizard again to sign in.";
  if (status === 403) return "Your Nex account doesn't have permission for this. Ask an owner or admin of the organization.";
  if (status === 429) return "Too many requests. Wait a minute and try again.";
  if (status >= 500) return "Nex is having trouble right now. Try again in a minute.";
  return undefined;
}

/**
 * The parts of the Nex API the wizard uses, with the person's access token
 * (`bearer`) or an SDK token. Nothing else about the project is sent.
 */
export class NexApi {
  constructor(
    readonly apiUrl: string,
    private readonly fetchImpl: Fetch = fetch,
    private bearer: string | null = null,
  ) {}

  withToken(token: string | null): NexApi {
    return new NexApi(this.apiUrl, this.fetchImpl, token);
  }

  async request<T>(method: string, path: string, body?: unknown, extra: { query?: Record<string, string>; headers?: Record<string, string> } = {}): Promise<T> {
    const url = new URL(this.apiUrl.replace(/\/+$/, "") + path);
    for (const [key, value] of Object.entries(extra.query ?? {})) url.searchParams.set(key, value);
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers: {
          Accept: "application/json",
          "User-Agent": "nex-wizard",
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...(this.bearer ? { Authorization: `Bearer ${this.bearer}` } : {}),
          ...extra.headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      throw new NetworkError(this.apiUrl, error);
    }
    const text = await response.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!response.ok) {
      const detail = (data as { detail?: string; title?: string } | null)?.detail ?? (data as { title?: string } | null)?.title ?? `Nex answered ${response.status}.`;
      throw new ApiError(response.status, detail, hintFor(response.status));
    }
    return data as T;
  }

  index(): Promise<ApiIndex> {
    return this.request("GET", "/");
  }

  async health(): Promise<boolean> {
    try {
      await this.request("GET", "/health");
      return true;
    } catch {
      return false;
    }
  }

  exchangeCode(input: { code: string; codeVerifier: string; redirectUri: string }): Promise<TokenPair> {
    return this.request("POST", "/auth/token", { grantType: "authorization_code", client: "cli", ...input });
  }

  refresh(refreshToken: string): Promise<TokenPair> {
    return this.request("POST", "/auth/refresh", { refreshToken });
  }

  logout(refreshToken: string): Promise<unknown> {
    return this.request("POST", "/auth/logout", { refreshToken });
  }

  organizations(): Promise<Organization[]> {
    return this.request<Organization[] | { organizations: Organization[] }>("GET", "/organizations").then((r) => (Array.isArray(r) ? r : r.organizations));
  }

  applications(org: string): Promise<ApplicationSummary[]> {
    return this.request<ApplicationSummary[] | { applications: ApplicationSummary[] }>("GET", `/organizations/${encodeURIComponent(org)}/applications`).then((r) => (Array.isArray(r) ? r : r.applications));
  }

  application(org: string, app: string): Promise<Application> {
    return this.request("GET", `/organizations/${encodeURIComponent(org)}/applications/${encodeURIComponent(app)}`);
  }

  createApplication(org: string, input: { name: string; slug: string; environments: string[] }): Promise<Application> {
    return this.request("POST", `/organizations/${encodeURIComponent(org)}/applications`, { ...input, ownership: "OWNED", monitorWebsite: false });
  }

  /** An SDK token: shown once, report-only, for one environment. */
  createToken(org: string, app: string, input: { name: string; environmentId: string }): Promise<{ token: string }> {
    return this.request("POST", `/organizations/${encodeURIComponent(org)}/applications/${encodeURIComponent(app)}/tokens`, input);
  }

  /** A browser key: public, error events only, for one frontend service. */
  createBrowserKey(org: string, app: string, input: { name: string; environmentId: string; service: string }): Promise<{ key: string }> {
    return this.request<{ key?: string; record?: { key: string } }>("POST", `/organizations/${encodeURIComponent(org)}/applications/${encodeURIComponent(app)}/client-keys`, { ...input, allowedOrigins: [] }).then((r) => ({
      key: r.key ?? r.record?.key ?? "",
    }));
  }

  /** With an SDK token: which application and environment it reports to. */
  sdkConfig(): Promise<SdkConfig> {
    return this.request("GET", "/config");
  }

  /** With an SDK token: one event, marked as the wizard's test. */
  sendTestEvent(service: string, environment?: string): Promise<{ accepted?: number }> {
    return this.request("POST", "/events", {
      type: "custom",
      severity: "INFO",
      message: "Nex wizard test event: this application is connected",
      service,
      ...(environment ? { environment } : {}),
      tags: { source: "nex-wizard" },
      timestamp: new Date().toISOString(),
    });
  }

  /** With a browser key: the same, as the browser SDK sends it. */
  sendBrowserTestEvent(key: string): Promise<{ accepted?: number }> {
    return this.request(
      "POST",
      "/browser/events",
      { type: "custom", severity: "INFO", message: "Nex wizard test event: this web app is connected", tags: { source: "nex-wizard" }, timestamp: new Date().toISOString() },
      { query: { key } },
    );
  }
}
