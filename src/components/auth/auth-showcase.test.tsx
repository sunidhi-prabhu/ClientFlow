// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthShowcase, SHOWCASE_STEP_MS, SHOWCASE_STEPS } from "./auth-showcase";

const steps = () => within(screen.getByRole("list", { name: "Steps" })).getAllByRole("button");
const currentStep = () => steps().find((step) => step.getAttribute("aria-current") === "step");
const visibleScenes = () =>
  screen.getAllByTestId("showcase-scene").filter((scene) => scene.dataset.active === "true");
/** Advance one step at a time: each step schedules the next after it renders. */
const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("AuthShowcase", () => {
  it("explains how ClientFlow works, starting with the first step", () => {
    render(<AuthShowcase />);
    expect(screen.getByRole("complementary", { name: "How ClientFlow works" })).toBeVisible();
    // Only the current step's description is announced (the caption shows it visually).
    SHOWCASE_STEPS.forEach((step, index) => {
      expect(steps()[index]).toHaveAccessibleName(
        index === 0 ? `${step.title}${step.description}` : step.title,
      );
    });
    expect(visibleScenes()).toHaveLength(1);
    expect(visibleScenes()[0]).toHaveTextContent("Northwind Studio");
    expect(screen.getByTestId("showcase-preview")).toHaveAttribute("aria-hidden", "true");
  });

  it("has no pause or play control", () => {
    render(<AuthShowcase />);
    expect(screen.queryByRole("button", { name: /pause|play/i })).not.toBeInTheDocument();
  });

  it("plays through every step once, then returns to the first step and stops", () => {
    render(<AuthShowcase />);
    for (const step of SHOWCASE_STEPS.slice(1)) {
      advance(SHOWCASE_STEP_MS);
      expect(currentStep()).toHaveTextContent(step.title);
    }
    advance(SHOWCASE_STEP_MS);
    expect(currentStep()).toHaveTextContent(SHOWCASE_STEPS[0].title);
    // Stopped: no further automatic changes, and the timer bar is gone.
    for (let i = 0; i < SHOWCASE_STEPS.length * 2; i++) advance(SHOWCASE_STEP_MS);
    expect(currentStep()).toHaveTextContent(SHOWCASE_STEPS[0].title);
    expect(screen.queryByTestId("step-progress")).not.toBeInTheDocument();
  });

  it("shows each step for 1.7 seconds", () => {
    render(<AuthShowcase />);
    advance(SHOWCASE_STEP_MS - 1);
    expect(currentStep()).toHaveTextContent("Add your clients");
    advance(1);
    expect(currentStep()).toHaveTextContent("Plan projects");
    expect(SHOWCASE_STEP_MS).toBe(1700);
  });

  it("lets visitors choose any step after the tour has stopped", () => {
    render(<AuthShowcase />);
    for (let i = 0; i < SHOWCASE_STEPS.length; i++) advance(SHOWCASE_STEP_MS);
    fireEvent.click(screen.getByRole("button", { name: /Invoice and get paid/ }));
    expect(currentStep()).toHaveAccessibleName(/Invoice and get paid.*exact totals/);
    expect(visibleScenes()[0]).toHaveTextContent("Invoice INV-0042");
    advance(SHOWCASE_STEP_MS * 3);
    expect(currentStep()).toHaveTextContent("Invoice and get paid");
  });

  it("stops the tour as soon as a visitor picks a step", () => {
    render(<AuthShowcase />);
    advance(SHOWCASE_STEP_MS);
    fireEvent.click(screen.getByRole("button", { name: /See everything at a glance/ }));
    advance(SHOWCASE_STEP_MS * 3);
    expect(currentStep()).toHaveTextContent("See everything at a glance");
    expect(screen.queryByTestId("step-progress")).not.toBeInTheDocument();
  });

  it("shows a timer bar on the current step while the tour plays", () => {
    render(<AuthShowcase />);
    const bar = screen.getByTestId("step-progress");
    expect(currentStep()).toContainElement(bar);
    expect(bar).toHaveStyle({ animationDuration: `${SHOWCASE_STEP_MS}ms` });
    advance(SHOWCASE_STEP_MS);
    expect(currentStep()).toContainElement(screen.getByTestId("step-progress"));
    expect(screen.getAllByTestId("step-progress")).toHaveLength(1);
  });
});

describe("AuthShowcase transitions", () => {
  it("cross-fades: every scene stays mounted and only the current one is shown", () => {
    render(<AuthShowcase />);
    const scenes = screen.getAllByTestId("showcase-scene");
    expect(scenes).toHaveLength(SHOWCASE_STEPS.length);
    expect(scenes[0]).toHaveClass("opacity-100");
    advance(SHOWCASE_STEP_MS);
    // The same elements, so the old scene can fade out instead of disappearing.
    expect(screen.getAllByTestId("showcase-scene")).toEqual(scenes);
    expect(scenes[0]).toHaveClass("opacity-0");
    expect(scenes[1]).toHaveClass("opacity-100");
  });

  it("replays a scene's entrance each time it is shown, but not while it fades out", () => {
    render(<AuthShowcase />);
    const firstRow = () =>
      within(screen.getAllByTestId("showcase-scene")[0]).getAllByRole("listitem", {
        hidden: true,
      })[0];
    const initial = firstRow();
    advance(SHOWCASE_STEP_MS);
    expect(firstRow()).toBe(initial); // fading out: left as it was
    fireEvent.click(screen.getByRole("button", { name: /Add your clients/ }));
    expect(firstRow()).not.toBe(initial); // shown again: remounted, so it animates in again
  });

  it("cross-fades the caption to the current step's description", () => {
    render(<AuthShowcase />);
    const caption = screen.getByTestId("showcase-caption");
    const lines = within(caption).getAllByText(/./);
    expect(lines.map((line) => line.textContent)).toEqual(SHOWCASE_STEPS.map((s) => s.description));
    expect(lines[0]).toHaveClass("opacity-100");
    expect(lines[1]).toHaveClass("opacity-0");
    advance(SHOWCASE_STEP_MS);
    expect(within(caption).getAllByText(/./)).toEqual(lines); // same elements: they fade
    expect(lines[0]).toHaveClass("opacity-0");
    expect(lines[1]).toHaveClass("opacity-100");
  });
});
