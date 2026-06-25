import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";

afterEach(() => {
  vi.restoreAllMocks();
  if (typeof window.localStorage?.clear === "function") {
    window.localStorage.clear();
  }
});

describe("App", () => {
  it("renders app shell without crashing", () => {
    vi.spyOn(window, "fetch").mockRejectedValue(new Error("network disabled in test"));
    window.history.replaceState({}, "", "/");

    const { container } = render(<App />);

    expect(container.firstChild).not.toBeNull();
  });
});
