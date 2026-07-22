// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LoadingState } from "./LoadingState";

afterEach(cleanup);

describe("loading state", () => {
  it("announces a branded full-screen loading message", () => {
    const { container } = render(<LoadingState label="Loading board…" fullScreen />);

    expect(screen.getByRole("status").textContent).toContain("Facet");
    expect(screen.getByRole("status").textContent).toContain("Loading board…");
    expect(container.firstElementChild?.classList.contains("min-h-screen")).toBe(true);
  });

  it("uses a compact region for lazy route loading", () => {
    const { container } = render(<LoadingState label="Loading view…" />);

    expect(screen.getByRole("status").textContent).toContain("Loading view…");
    expect(container.firstElementChild?.classList.contains("min-h-52")).toBe(true);
  });
});
