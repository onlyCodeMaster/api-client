import { describe, it, expect } from "vitest";
import {
  REFRESH_SKEW_MS,
  shouldRefreshOAuth2,
  buildRefreshRequest,
  applyRefreshResult,
  updateFolderAuth,
} from "./oauth2Refresh";
import type { AuthConfig, Collection } from "../types";

const oauthBase: AuthConfig = {
  auth_type: "oauth2",
  oauth2_grant_type: "authorization_code",
  oauth2_token_url: "https://example.test/token",
  oauth2_client_id: "cid",
  oauth2_client_secret: "secret",
  oauth2_access_token: "old-access",
  oauth2_refresh_token: "old-refresh",
  oauth2_token_expires_at: 0,
};

describe("shouldRefreshOAuth2", () => {
  const now = 10_000_000;

  it("returns false for non-oauth2 auth", () => {
    expect(shouldRefreshOAuth2({ auth_type: "bearer", bearer_token: "x" }, now)).toBe(false);
    expect(shouldRefreshOAuth2(undefined, now)).toBe(false);
  });

  it("returns false when there is no refresh_token to use", () => {
    expect(
      shouldRefreshOAuth2(
        { ...oauthBase, oauth2_refresh_token: undefined, oauth2_token_expires_at: now - 1000 },
        now
      )
    ).toBe(false);
  });

  it("returns true when access_token is missing entirely (re-auth needed)", () => {
    expect(
      shouldRefreshOAuth2({ ...oauthBase, oauth2_access_token: undefined }, now)
    ).toBe(true);
  });

  it("returns false when expires_at is unknown — don't speculate", () => {
    expect(
      shouldRefreshOAuth2({ ...oauthBase, oauth2_token_expires_at: undefined }, now)
    ).toBe(false);
  });

  it("returns false when the token has comfortable headroom", () => {
    expect(
      shouldRefreshOAuth2(
        { ...oauthBase, oauth2_token_expires_at: now + REFRESH_SKEW_MS * 5 },
        now
      )
    ).toBe(false);
  });

  it("returns true inside the skew window", () => {
    expect(
      shouldRefreshOAuth2(
        { ...oauthBase, oauth2_token_expires_at: now + REFRESH_SKEW_MS - 1 },
        now
      )
    ).toBe(true);
  });

  it("returns true when the token has already expired", () => {
    expect(
      shouldRefreshOAuth2({ ...oauthBase, oauth2_token_expires_at: now - 1000 }, now)
    ).toBe(true);
  });
});

describe("buildRefreshRequest", () => {
  it("plumbs the OAuth2 fields into the IPC payload shape", () => {
    const req = buildRefreshRequest({
      ...oauthBase,
      oauth2_scope: "read write",
      oauth2_client_auth: "body",
    });
    expect(req).toEqual({
      grant_type: "refresh_token",
      token_url: "https://example.test/token",
      client_id: "cid",
      client_secret: "secret",
      scope: "read write",
      client_auth: "body",
      refresh_token: "old-refresh",
      insecure: false,
    });
  });

  it("defaults client_auth to basic and sends null scope when unset", () => {
    const req = buildRefreshRequest({
      ...oauthBase,
      oauth2_scope: undefined,
      oauth2_client_auth: undefined,
    });
    expect(req.client_auth).toBe("basic");
    expect(req.scope).toBeNull();
  });
});

describe("applyRefreshResult", () => {
  it("overwrites access_token and expires_at", () => {
    const next = applyRefreshResult(oauthBase, {
      access_token: "new-access",
      expires_at: 42,
      refresh_token: null,
    });
    expect(next.oauth2_access_token).toBe("new-access");
    expect(next.oauth2_token_expires_at).toBe(42);
    // refresh_token unchanged when provider didn't return one
    expect(next.oauth2_refresh_token).toBe("old-refresh");
  });

  it("rotates the refresh_token when the provider returns one", () => {
    const next = applyRefreshResult(oauthBase, {
      access_token: "a",
      expires_at: 1,
      refresh_token: "new-refresh",
    });
    expect(next.oauth2_refresh_token).toBe("new-refresh");
  });

  it("clears expires_at when the provider omits it", () => {
    const next = applyRefreshResult(oauthBase, {
      access_token: "a",
      expires_at: null,
      refresh_token: null,
    });
    expect(next.oauth2_token_expires_at).toBeUndefined();
  });
});

describe("updateFolderAuth", () => {
  const newAuth: AuthConfig = { ...oauthBase, oauth2_access_token: "fresh" };

  const collection: Collection = {
    id: "c1",
    name: "Demo",
    description: "",
    requests: [],
    created_at: 0,
    folders: [
      {
        id: "fA",
        name: "outer",
        requests: [],
        auth: { ...oauthBase, oauth2_access_token: "old-a" },
        folders: [
          {
            id: "fAA",
            name: "inner",
            requests: [],
            auth: { ...oauthBase, oauth2_access_token: "old-aa" },
            folders: [],
          },
        ],
      },
      {
        id: "fB",
        name: "sibling",
        requests: [],
        folders: [],
      },
    ],
    variables: [],
    updated_at: 0,
  };

  it("updates the auth on a root-level folder without touching siblings", () => {
    const out = updateFolderAuth(collection, "fA", newAuth);
    expect(out.folders[0].auth).toBe(newAuth);
    // The sibling's content is unchanged (we don't compare by reference
    // because the walker rebuilds the shape).
    expect(out.folders[1].id).toBe("fB");
    expect(out.folders[1].auth).toBeUndefined();
  });

  it("walks into nested folders to update deep auth", () => {
    const out = updateFolderAuth(collection, "fAA", newAuth);
    expect(out.folders[0].folders[0].auth).toBe(newAuth);
    // Parent auth must remain unchanged.
    expect(out.folders[0].auth?.oauth2_access_token).toBe("old-a");
  });

  it("returns a new object even when the folder isn't found (idempotent)", () => {
    const out = updateFolderAuth(collection, "does-not-exist", newAuth);
    expect(out).not.toBe(collection);
    expect(out.folders[0].auth?.oauth2_access_token).toBe("old-a");
  });
});
