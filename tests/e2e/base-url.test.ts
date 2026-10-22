import { describe, expect, it } from "vitest";
import { assertLocalBaseUrl } from "./base-url";

describe("E2E base URL guard: localhost only", () => {
  it.each([
    "http://localhost:3000",
    "http://localhost:3100/",
    "http://127.0.0.1:3000",
    "http://[::1]:3000",
    "https://localhost:3000",
  ])("accepts %s", (url) => {
    expect(() => assertLocalBaseUrl(url)).not.toThrow();
  });

  it.each([
    "https://askedfor.app",
    "https://askedfor-git-x-buzz542s-projects.vercel.app",
    "http://localhost.evil.example:3000",
    "http://evil.example/localhost",
    "http://user@evil.example",
    "http://localhost@evil.example",
    "http://127.0.0.2:3000",
    "http://10.0.0.1:3000",
    "http://0.0.0.0:3000",
    "file:///etc/passwd",
    "ftp://localhost",
    "",
    "not a url",
  ])("refuses %j", (url) => {
    expect(() => assertLocalBaseUrl(url)).toThrow(/localhost/);
  });
});
