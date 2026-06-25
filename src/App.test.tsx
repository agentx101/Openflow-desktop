import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";

afterEach(() => {
  vi.restoreAllMocks();
  if (typeof window.localStorage?.clear === "function") {
    window.localStorage.clear();
  }
});

describe("App", () => {
  it("renders login heading for unauthenticated users", async () => {
    vi.spyOn(window, "fetch").mockRejectedValue(new Error("network disabled in test"));
    window.history.replaceState({}, "", "/instances");

    render(<App />);

    expect(await screen.findByRole("heading", { name: /log in to your account/i })).toBeInTheDocument();
  });
});
