import {
  CheckCircle2,
  FolderKanban,
  KanbanSquare,
  LayoutDashboard,
  type LucideIcon,
  Receipt,
  ScrollText,
  Users,
} from "lucide-react";
import Link from "next/link";

import { Logo } from "@/components/layout/logo";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Feature = { title: string; description: string; icon: LucideIcon };

const FEATURES: Feature[] = [
  {
    title: "Clients",
    description: "Keep contact details, notes and history for every client in one searchable list.",
    icon: Users,
  },
  {
    title: "Projects",
    description: "Link projects to clients, set due dates, track progress and assign your team.",
    icon: FolderKanban,
  },
  {
    title: "Tasks",
    description: "Move work from To do to Done on a Kanban board, with priorities and assignees.",
    icon: KanbanSquare,
  },
  {
    title: "Invoices",
    description: "Create itemized invoices with exact totals and follow each one until it is paid.",
    icon: Receipt,
  },
  {
    title: "Dashboard & activity",
    description:
      "See active projects, open tasks, outstanding invoices and recent activity at a glance.",
    icon: LayoutDashboard,
  },
  {
    title: "Audit log",
    description:
      "An append-only record of sign-ins, changes and role updates for owners and admins.",
    icon: ScrollText,
  },
];

const VALUE_POINTS = [
  "One place for clients, projects, tasks and billing: no more scattered spreadsheets.",
  "Roles for owners, admins, managers and members, so everyone sees what they need.",
  "Every organization's data is kept separate and every important change is recorded.",
];

/** Decorative sketch of the task board for the hero; carries no information. */
function BoardIllustration() {
  const columns = [
    { title: "w-10", cards: ["w-4/5", "w-3/5", "w-2/3"] },
    { title: "w-14", cards: ["w-3/4", "w-1/2"] },
    { title: "w-9", cards: ["w-2/3"] },
    { title: "w-8", cards: ["w-4/5", "w-3/5"] },
  ];
  return (
    <div
      aria-hidden
      data-testid="board-illustration"
      className="mx-auto w-full max-w-3xl rounded-2xl bg-card p-3 shadow-lg ring-1 ring-foreground/10 sm:p-4"
    >
      <div className="mb-3 flex items-center gap-1.5">
        <span className="size-2.5 rounded-full bg-muted-foreground/30" />
        <span className="size-2.5 rounded-full bg-muted-foreground/30" />
        <span className="size-2.5 rounded-full bg-muted-foreground/30" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {columns.map((column, index) => (
          <div key={index} className="space-y-2 rounded-xl bg-muted/60 p-2.5">
            <div className={cn("h-2 rounded-full bg-muted-foreground/30", column.title)} />
            {column.cards.map((width, cardIndex) => (
              <div
                key={cardIndex}
                className="space-y-1.5 rounded-lg bg-card p-2.5 ring-1 ring-foreground/5"
              >
                <div className={cn("h-2 rounded-full bg-foreground/15", width)} />
                <div className="h-1.5 w-2/5 rounded-full bg-primary/40" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Public introduction shown at `/` to visitors who are not signed in. */
export function LandingPage() {
  const reveal =
    "motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-700";

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
          <Logo />
          <nav aria-label="Account" className="flex items-center gap-1 sm:gap-2">
            <Link href="/sign-in" className={buttonVariants({ variant: "ghost" })}>
              Sign in
            </Link>
            <Link href="/sign-up" className={buttonVariants()}>
              Create account
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <section
          aria-labelledby="hero-heading"
          className="relative overflow-hidden bg-linear-to-b from-primary/10 via-background to-background"
        >
          <div className="mx-auto w-full max-w-6xl px-4 pt-16 pb-12 sm:px-6 sm:pt-24 sm:pb-16">
            <div className={cn("mx-auto max-w-2xl text-center", reveal)}>
              <p className="mb-4 inline-flex items-center rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                CRM + project management for freelancers and small teams
              </p>
              <h1
                id="hero-heading"
                className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl"
              >
                Your clients, projects and invoices, finally in one place
              </h1>
              <p className="mt-5 text-base text-pretty text-muted-foreground sm:text-lg">
                ClientFlow keeps client relationships, project work, task boards and billing
                together, so you spend less time chasing details and more time doing the work.
              </p>
              <div className="mt-8 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
                <Link href="/sign-up" className={buttonVariants({ size: "lg", className: "px-5" })}>
                  Create account
                </Link>
                <Link
                  href="/sign-in"
                  className={buttonVariants({ size: "lg", variant: "outline", className: "px-5" })}
                >
                  Sign in
                </Link>
              </div>
            </div>
            <div className={cn("mt-14 sm:mt-16", reveal, "motion-safe:delay-150")}>
              <BoardIllustration />
            </div>
          </div>
        </section>

        <section aria-labelledby="features-heading" className="border-t bg-muted/40">
          <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <div className="mx-auto max-w-2xl text-center">
              <h2
                id="features-heading"
                className="text-2xl font-semibold tracking-tight sm:text-3xl"
              >
                Everything a small team needs to deliver
              </h2>
              <p className="mt-3 text-muted-foreground">
                From the first client conversation to the final invoice.
              </p>
            </div>
            <ul
              aria-label="Features"
              className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
            >
              {FEATURES.map(({ title, description, icon: Icon }) => (
                <li
                  key={title}
                  className="rounded-xl bg-card p-5 ring-1 ring-foreground/10 transition-shadow hover:shadow-md"
                >
                  <span
                    aria-hidden
                    className="mb-4 flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary"
                  >
                    <Icon className="size-5" />
                  </span>
                  <h3 className="font-medium">{title}</h3>
                  <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section aria-labelledby="value-heading" className="border-t">
          <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-2 lg:items-center">
            <div>
              <h2 id="value-heading" className="text-2xl font-semibold tracking-tight sm:text-3xl">
                Stay organized from first contact to final payment
              </h2>
              <p className="mt-3 text-muted-foreground">
                Stop switching between a contacts app, a to-do list and an invoicing tool.
                ClientFlow connects them, so every task and invoice is tied to the right client and
                project.
              </p>
            </div>
            <ul className="space-y-4">
              {VALUE_POINTS.map((point) => (
                <li key={point} className="flex gap-3">
                  <CheckCircle2 aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" />
                  <span className="text-sm sm:text-base">{point}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section aria-labelledby="cta-heading" className="border-t bg-muted/40">
          <div className="mx-auto w-full max-w-6xl px-4 py-14 text-center sm:px-6">
            <h2 id="cta-heading" className="text-xl font-semibold tracking-tight sm:text-2xl">
              Ready to bring your work together?
            </h2>
            <p className="mt-2 text-muted-foreground">
              Create an account and set up your organization in a minute.
            </p>
            <div className="mt-6 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
              <Link href="/sign-up" className={buttonVariants({ size: "lg", className: "px-5" })}>
                Get started
              </Link>
              <Link
                href="/sign-in"
                className={buttonVariants({ size: "lg", variant: "outline", className: "px-5" })}
              >
                I already have an account
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-2 px-4 py-6 text-center text-sm text-muted-foreground sm:flex-row sm:px-6 sm:text-left">
          <span>ClientFlow</span>
          <span>CRM and project management for freelancers and small teams.</span>
        </div>
      </footer>
    </div>
  );
}
