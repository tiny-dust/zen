import { runInNewContext } from "node:vm";

import { describe, expect, it, vi } from "vitest";

import { autoFillPasswordForPage, fillPasswordScript, matchingPasswords, securePageOrigin } from "./autofill";

import type { StoredPasswordEntry } from "@zen/shared";

const entry: StoredPasswordEntry = {
  id: "one",
  origin: "https://example.com",
  title: "Example",
  username: "person@example.com",
  createdAt: 1,
};

function runFill(options: {
  pageUrl?: string;
  passwordValue?: string;
  usernameValue?: string;
  autocomplete?: string;
  passwordFields?: number;
  subframe?: boolean;
} = {}) {
  class Input {
    value = "";
    disabled = false;
    readOnly = false;
    autocomplete = "";
    type = "text";
    form: { querySelectorAll: () => Input[] } | null = null;
    getClientRects() { return [{}]; }
    dispatchEvent = vi.fn();
  }
  const username = new Input();
  username.value = options.usernameValue ?? "";
  const password = new Input();
  password.type = "password";
  password.value = options.passwordValue ?? "";
  password.autocomplete = options.autocomplete ?? "current-password";
  password.form = { querySelectorAll: () => [username] };
  const pageUrl = options.pageUrl ?? "https://example.com/login";
  const location = new URL(pageUrl);
  const window = { getComputedStyle: () => ({ display: "block", visibility: "visible" }) } as {
    top?: unknown;
    getComputedStyle: () => { display: string; visibility: string };
  };
  window.top = options.subframe ? {} : window;
  const document = {
    querySelectorAll: () => Array.from({ length: options.passwordFields ?? 1 }, () => password),
  };
  const script = fillPasswordScript({
    expectedUrl: "https://example.com/login",
    origin: "https://example.com",
    username: "person@example.com",
    password: "secret-value",
  });
  const filled = runInNewContext(script, { window, document, location, HTMLInputElement: Input, Event: class {} });
  return { filled, username, password };
}

describe("browser password autofill", () => {
  it("matches only the exact HTTPS origin", () => {
    expect(securePageOrigin("https://example.com:443/login")).toBe("https://example.com");
    expect(matchingPasswords([entry], "https://example.com/login")).toEqual([entry]);
    expect(matchingPasswords([entry], "https://other.example.com/login")).toEqual([]);
    expect(matchingPasswords([entry], "http://example.com/login")).toEqual([]);
  });

  it("does not auto-fill hidden pages, disabled mode, or ambiguous accounts", () => {
    expect(autoFillPasswordForPage([entry], "https://example.com/login", false, true)).toBeNull();
    expect(autoFillPasswordForPage([entry], "https://example.com/login", true, false)).toBeNull();
    expect(autoFillPasswordForPage([entry, { ...entry, id: "two" }], "https://example.com/login", true, true)).toBeNull();
    expect(autoFillPasswordForPage([entry], "https://example.com/login", true, true)).toEqual(entry);
  });

  it("fills a visible login form without submitting it", () => {
    const { filled, username, password } = runFill();
    expect(filled).toBe(true);
    expect(username.value).toBe("person@example.com");
    expect(password.value).toBe("secret-value");
    expect(password.dispatchEvent).toHaveBeenCalledTimes(2);
  });

  it("rejects navigation changes, existing values, and new-password forms", () => {
    expect(runFill({ pageUrl: "https://example.com/other" }).filled).toBe(false);
    expect(runFill({ pageUrl: "http://example.com/login" }).filled).toBe(false);
    expect(runFill({ subframe: true }).filled).toBe(false);
    expect(runFill({ passwordValue: "typed" }).filled).toBe(false);
    expect(runFill({ usernameValue: "another@example.com" }).filled).toBe(false);
    expect(runFill({ autocomplete: "new-password" }).filled).toBe(false);
    expect(runFill({ passwordFields: 2 }).filled).toBe(false);
  });
});
