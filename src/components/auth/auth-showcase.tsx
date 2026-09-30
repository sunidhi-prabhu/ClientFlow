"use client";

import {
  FolderKanban,
  KanbanSquare,
  LayoutDashboard,
  type LucideIcon,
  Receipt,
  Users,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

import { ClientStatusBadge } from "@/components/clients/client-status-badge";
import { InvoiceStatusBadge } from "@/components/invoices/invoice-status-badge";
import { PriorityIndicator } from "@/components/shared/priority-indicator";
import { ProgressBar } from "@/components/shared/progress-bar";
import { cn } from "@/lib/utils";

/** How long each step stays on screen while the walkthrough plays. */
export const SHOWCASE_STEP_MS = 1700;

function Window({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl bg-card text-card-foreground shadow-xl ring-1 ring-foreground/10">
      <div className="flex items-center gap-1.5 border-b px-3 py-2">
        <span className="size-2 rounded-full bg-muted-foreground/30" />
        <span className="size-2 rounded-full bg-muted-foreground/30" />
        <span className="size-2 rounded-full bg-muted-foreground/30" />
        <span className="ml-2 text-xs text-muted-foreground">{title}</span>
      </div>
      <div className="flex-1 p-4">{children}</div>
    </div>
  );
}

function ClientsScene() {
  const clients = [
    { name: "Northwind Studio", company: "Brand & web", status: "ACTIVE" as const },
    { name: "Bluebird Café", company: "Hospitality", status: "ACTIVE" as const },
    { name: "Atlas Legal", company: "Law firm", status: "INACTIVE" as const },
  ];
  return (
    <Window title="Clients">
      <ul className="divide-y">
        {clients.map((client, index) => (
          <li
            key={client.name}
            className={cn(
              "flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0",
              "motion-safe:animate-in motion-safe:duration-500 motion-safe:fill-mode-backwards motion-safe:fade-in motion-safe:slide-in-from-bottom-2",
              ["", "motion-safe:delay-150", "motion-safe:delay-300"][index],
            )}
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{client.name}</p>
              <p className="truncate text-xs text-muted-foreground">{client.company}</p>
            </div>
            <ClientStatusBadge status={client.status} />
          </li>
        ))}
      </ul>
    </Window>
  );
}

function ProjectScene() {
  return (
    <Window title="Projects">
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Website redesign</p>
            <p className="text-xs text-muted-foreground">Northwind Studio · due 14 Nov</p>
          </div>
          <PriorityIndicator priority="HIGH" />
        </div>
        <ProgressBar value={65} label="Website redesign progress" />
        <div className="flex items-center gap-2">
          {["AK", "MR", "JS"].map((initials) => (
            <span
              key={initials}
              className="flex size-7 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary"
            >
              {initials}
            </span>
          ))}
          <span className="text-xs text-muted-foreground">3 members</span>
        </div>
      </div>
    </Window>
  );
}

function BoardScene() {
  const card = (title: string, className?: string) => (
    <div className={cn("rounded-lg bg-card p-2 text-xs ring-1 ring-foreground/10", className)}>
      {title}
    </div>
  );
  return (
    <Window title="Website redesign · Board">
      <div className="grid grid-cols-3 gap-2">
        <div className="space-y-2 rounded-lg bg-muted/60 p-2">
          <p className="text-xs font-medium text-muted-foreground">To do</p>
          {card("Write homepage copy")}
        </div>
        <div className="space-y-2 rounded-lg bg-muted/60 p-2">
          <p className="text-xs font-medium text-muted-foreground">In progress</p>
          {card(
            "Design mockups",
            "ring-2 ring-primary motion-safe:animate-in motion-safe:slide-in-from-left-24 motion-safe:fade-in motion-safe:fill-mode-backwards motion-safe:delay-150 motion-safe:duration-500",
          )}
        </div>
        <div className="space-y-2 rounded-lg bg-muted/60 p-2">
          <p className="text-xs font-medium text-muted-foreground">Done</p>
          {card("Kick-off call", "text-muted-foreground line-through")}
        </div>
      </div>
    </Window>
  );
}

function InvoiceScene() {
  return (
    <Window title="Invoice INV-0042">
      <div className="space-y-3 text-sm">
        <div className="flex items-center justify-between">
          <span className="font-medium">Northwind Studio</span>
          <span className="motion-safe:animate-in motion-safe:delay-300 motion-safe:duration-300 motion-safe:fill-mode-backwards motion-safe:zoom-in-75 motion-safe:fade-in">
            <InvoiceStatusBadge status="PAID" />
          </span>
        </div>
        <div className="space-y-1.5 text-xs text-muted-foreground">
          <div className="flex justify-between">
            <span>Design · 24 h × $120.00</span>
            <span className="tabular-nums">$2,880.00</span>
          </div>
          <div className="flex justify-between">
            <span>Development · 16 h × $120.00</span>
            <span className="tabular-nums">$1,920.00</span>
          </div>
        </div>
        <div className="flex justify-between border-t pt-2 font-medium">
          <span>Total</span>
          <span className="tabular-nums">$4,800.00</span>
        </div>
      </div>
    </Window>
  );
}

function DashboardScene() {
  const metrics = [
    ["Total clients", "12"],
    ["Active projects", "5"],
    ["Open tasks", "18"],
    ["Outstanding", "$6,250"],
  ];
  return (
    <Window title="Overview">
      <div className="grid grid-cols-2 gap-2">
        {metrics.map(([label, value], index) => (
          <div
            key={label}
            className={cn(
              "rounded-lg p-2.5 ring-1 ring-foreground/10",
              "motion-safe:animate-in motion-safe:duration-500 motion-safe:fill-mode-backwards motion-safe:zoom-in-95 motion-safe:fade-in",
              ["", "motion-safe:delay-100", "motion-safe:delay-200", "motion-safe:delay-300"][
                index
              ],
            )}
          >
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-lg font-semibold tabular-nums">{value}</p>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Maya</span> moved “Design mockups” to In
        progress · 2 min ago
      </p>
    </Window>
  );
}

type Step = { title: string; description: string; icon: LucideIcon; scene: () => ReactNode };

export const SHOWCASE_STEPS: Step[] = [
  {
    title: "Add your clients",
    description: "Keep contacts, notes and history for every client in one place.",
    icon: Users,
    scene: ClientsScene,
  },
  {
    title: "Plan projects",
    description: "Link work to a client, set a due date, add your team and track progress.",
    icon: FolderKanban,
    scene: ProjectScene,
  },
  {
    title: "Move tasks on the board",
    description: "Take work from To do to Done on a Kanban board everyone shares.",
    icon: KanbanSquare,
    scene: BoardScene,
  },
  {
    title: "Invoice and get paid",
    description: "Itemized invoices with exact totals and a clear status until they are paid.",
    icon: Receipt,
    scene: InvoiceScene,
  },
  {
    title: "See everything at a glance",
    description: "Your dashboard shows clients, projects, open tasks and recent activity.",
    icon: LayoutDashboard,
    scene: DashboardScene,
  },
];

/**
 * "How ClientFlow works" panel beside the sign-in and sign-up forms: a short
 * walkthrough of the main features with example previews. It plays through
 * once, comes back to the first step and stops; after that, or as soon as
 * someone picks a step (which is also how to stop it early), it only changes
 * on click. Scene animations respect reduced motion.
 */
export function AuthShowcase({ className }: { className?: string }) {
  // `plays[i]` counts how often step i was shown: it keys the scene so its
  // entrance animation replays each time, while the scene fading out keeps
  // its key (and its finished state) during the cross-fade.
  const [view, setView] = useState(() => ({
    active: 0,
    plays: SHOWCASE_STEPS.map(() => 0),
  }));
  const { active, plays } = view;
  const goTo = (next: (current: number) => number) =>
    setView((state) => {
      const target = next(state.active);
      if (target === state.active) return state;
      return {
        active: target,
        plays: state.plays.map((count, index) => (index === target ? count + 1 : count)),
      };
    });
  const [autoplay, setAutoplay] = useState(true);

  useEffect(() => {
    if (!autoplay) return;
    const timer = window.setTimeout(() => {
      const last = active === SHOWCASE_STEPS.length - 1;
      goTo(() => (last ? 0 : active + 1));
      if (last) setAutoplay(false);
    }, SHOWCASE_STEP_MS);
    return () => window.clearTimeout(timer);
  }, [active, autoplay]);

  return (
    <aside
      aria-labelledby="showcase-heading"
      className={cn(
        "relative overflow-hidden bg-primary text-primary-foreground",
        "bg-linear-to-br from-primary to-[color-mix(in_oklch,var(--primary),var(--foreground)_25%)]",
        className,
      )}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 -right-24 size-80 rounded-full bg-primary-foreground/10"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-32 -left-20 size-96 rounded-full bg-primary-foreground/5"
      />

      <div className="relative mx-auto flex w-full max-w-lg flex-col justify-center gap-8 px-10 py-12">
        <div>
          <h2 id="showcase-heading" className="text-2xl font-semibold tracking-tight">
            How ClientFlow works
          </h2>
          <p className="mt-2 text-sm text-primary-foreground/85">
            From the first client conversation to the final invoice, in one workspace.
          </p>
        </div>

        <div className="space-y-4">
          {/* All scenes share one grid cell, so the old one fades out while the new one fades in. */}
          <div aria-hidden data-testid="showcase-preview" className="grid h-60">
            {SHOWCASE_STEPS.map(({ title, scene: Scene }, index) => {
              const current = index === active;
              return (
                <div
                  key={title}
                  data-testid="showcase-scene"
                  data-active={current}
                  className={cn(
                    "col-start-1 row-start-1 transition-[opacity,translate] duration-300 ease-out motion-reduce:transition-none",
                    current
                      ? "translate-y-0 opacity-100"
                      : "pointer-events-none translate-y-3 opacity-0",
                  )}
                >
                  <div key={plays[index]} className="h-full">
                    <Scene />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Description of the current step, cross-fading like the scenes. */}
          <div aria-hidden data-testid="showcase-caption" className="grid min-h-10">
            {SHOWCASE_STEPS.map(({ title, description }, index) => (
              <p
                key={title}
                className={cn(
                  "col-start-1 row-start-1 text-sm text-primary-foreground/85 transition-opacity duration-300 motion-reduce:transition-none",
                  index === active ? "opacity-100" : "opacity-0",
                )}
              >
                {description}
              </p>
            ))}
          </div>
        </div>

        {/* Every step is one line tall, so switching steps never moves the layout. */}
        <ol className="space-y-1" aria-label="Steps">
          {SHOWCASE_STEPS.map(({ title, description, icon: Icon }, index) => {
            const current = index === active;
            return (
              <li key={title}>
                <button
                  type="button"
                  aria-current={current ? "step" : undefined}
                  onClick={() => {
                    setAutoplay(false);
                    goTo(() => index);
                  }}
                  className={cn(
                    "relative flex w-full items-center gap-3 overflow-hidden rounded-lg px-3 py-2 text-left transition-colors outline-none",
                    "focus-visible:ring-2 focus-visible:ring-primary-foreground/70",
                    "duration-300",
                    current ? "bg-primary-foreground/15" : "hover:bg-primary-foreground/10",
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "flex size-7 shrink-0 items-center justify-center rounded-md transition-colors duration-300",
                      current
                        ? "bg-primary-foreground text-primary"
                        : "bg-primary-foreground/15 text-primary-foreground",
                    )}
                  >
                    <Icon className="size-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{title}</span>
                    {/* The visible description is the caption above; announce it here. */}
                    {current && <span className="sr-only">{description}</span>}
                  </span>
                  {current && autoplay && (
                    <span
                      key={active}
                      aria-hidden
                      data-testid="step-progress"
                      className="absolute inset-x-0 bottom-0 h-0.5 origin-left animate-[showcase-progress_linear_forwards] bg-primary-foreground/70"
                      style={{ animationDuration: `${SHOWCASE_STEP_MS}ms` }}
                    />
                  )}
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    </aside>
  );
}
