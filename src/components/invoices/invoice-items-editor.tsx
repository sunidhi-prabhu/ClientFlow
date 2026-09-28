"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type ActionResult } from "@/lib/errors";
import {
  centsToInput,
  formatMoney,
  formatQuantity,
  lineAmountCents,
  parseAmountToCents,
  parseQuantityToMilli,
} from "@/lib/money";

export type InvoiceItemRow = {
  id: string;
  description: string;
  quantityMilli: number;
  unitPriceCents: number;
  amountCents: number;
};

type Draft = { description: string; quantity: string; unitPrice: string };
type ItemAction = (
  organizationSlug: string,
  input: Record<string, string>,
) => Promise<ActionResult<unknown>>;

/** Display-only preview; the server recomputes every amount. */
function previewAmount(draft: Draft, currency: string): string {
  const quantity = parseQuantityToMilli(draft.quantity);
  const price = parseAmountToCents(draft.unitPrice);
  return quantity !== null && price !== null
    ? formatMoney(lineAmountCents(quantity, price), currency)
    : "—";
}

function ItemInputs({
  draft,
  onChange,
  disabled,
  label,
}: {
  draft: Draft;
  onChange: (draft: Draft) => void;
  disabled: boolean;
  label: string;
}) {
  return (
    <>
      <Input
        aria-label={`${label} description`}
        placeholder="Description"
        value={draft.description}
        maxLength={500}
        disabled={disabled}
        onChange={(event) => onChange({ ...draft, description: event.target.value })}
      />
      <Input
        aria-label={`${label} quantity`}
        placeholder="Qty"
        inputMode="decimal"
        value={draft.quantity}
        disabled={disabled}
        onChange={(event) => onChange({ ...draft, quantity: event.target.value })}
        className="text-right"
      />
      <Input
        aria-label={`${label} unit price`}
        placeholder="Unit price"
        inputMode="decimal"
        value={draft.unitPrice}
        disabled={disabled}
        onChange={(event) => onChange({ ...draft, unitPrice: event.target.value })}
        className="text-right"
      />
    </>
  );
}

const EMPTY: Draft = { description: "", quantity: "1", unitPrice: "" };

/**
 * Line items. Editable only for drafts (and roles with invoice:update); the
 * server enforces both, validates the values and recomputes all totals.
 */
export function InvoiceItemsEditor({
  organizationSlug,
  invoiceId,
  currency,
  items,
  editable,
  addAction,
  updateAction,
  removeAction,
}: {
  organizationSlug: string;
  invoiceId: string;
  currency: string;
  items: InvoiceItemRow[];
  editable: boolean;
  addAction: ItemAction;
  updateAction: ItemAction;
  removeAction: ItemAction;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [newItem, setNewItem] = useState<Draft>(EMPTY);
  const [editing, setEditing] = useState<{ id: string; draft: Draft } | null>(null);
  const [wasEditable, setWasEditable] = useState(editable);

  // When the invoice stops being editable (issued/cancelled) the component stays
  // mounted across the refresh: drop any stale error, edit row or typed item.
  if (editable !== wasEditable) {
    setWasEditable(editable);
    setError(null);
    setEditing(null);
    setNewItem(EMPTY);
  }

  function run(call: () => Promise<ActionResult<unknown>>, onSuccess: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await call();
      if (result.ok) {
        onSuccess();
        router.refresh();
      } else {
        const details = Array.isArray(result.error.details)
          ? (result.error.details as { message?: string }[])
              .map((detail) => detail.message)
              .filter(Boolean)
          : [];
        setError(details.length > 0 ? details.join(" · ") : result.error.message);
      }
    });
  }

  const columns = "grid grid-cols-[1fr_5rem_7rem_7rem_auto] items-center gap-2";

  return (
    <div className="grid gap-3">
      {/* Scrolls sideways on narrow screens; focusable so keyboard users can scroll it. */}
      <div
        role="region"
        aria-label="Line items table"
        tabIndex={0}
        className="overflow-x-auto rounded-md focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <div className="min-w-[36rem]">
          <div
            className={`${columns} border-b px-1 pb-2 text-xs font-medium text-muted-foreground`}
          >
            <span>Description</span>
            <span className="text-right">Qty</span>
            <span className="text-right">Unit price</span>
            <span className="text-right">Amount</span>
            <span className="w-16" />
          </div>
          <ul aria-label="Line items" className="divide-y">
            {items.length === 0 && (
              <li className="px-1 py-6 text-center text-sm text-muted-foreground">
                No line items yet.
              </li>
            )}
            {items.map((item) =>
              editing?.id === item.id ? (
                <li key={item.id} className={`${columns} px-1 py-2`}>
                  <ItemInputs
                    draft={editing.draft}
                    disabled={pending}
                    label="Edit item"
                    onChange={(draft) => setEditing({ id: item.id, draft })}
                  />
                  <span className="text-right text-sm tabular-nums">
                    {previewAmount(editing.draft, currency)}
                  </span>
                  <div className="flex w-16 justify-end gap-1">
                    <Button
                      size="sm"
                      disabled={pending}
                      onClick={() =>
                        run(
                          () => updateAction(organizationSlug, { id: item.id, ...editing.draft }),
                          () => setEditing(null),
                        )
                      }
                    >
                      Save
                    </Button>
                  </div>
                </li>
              ) : (
                <li key={item.id} className={`${columns} px-1 py-2.5 text-sm`}>
                  <span className="break-words">{item.description}</span>
                  <span className="text-right tabular-nums">
                    {formatQuantity(item.quantityMilli)}
                  </span>
                  <span className="text-right tabular-nums">
                    {formatMoney(item.unitPriceCents, currency)}
                  </span>
                  <span className="text-right font-medium tabular-nums">
                    {formatMoney(item.amountCents, currency)}
                  </span>
                  <div className="flex w-16 justify-end gap-1 print:hidden">
                    {editable && (
                      <>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Edit ${item.description}`}
                          disabled={pending}
                          onClick={() =>
                            setEditing({
                              id: item.id,
                              draft: {
                                description: item.description,
                                quantity: formatQuantity(item.quantityMilli),
                                unitPrice: centsToInput(item.unitPriceCents),
                              },
                            })
                          }
                        >
                          <Pencil aria-hidden />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Remove ${item.description}`}
                          disabled={pending}
                          onClick={() =>
                            run(
                              () => removeAction(organizationSlug, { id: item.id }),
                              () => {},
                            )
                          }
                        >
                          <Trash2 aria-hidden />
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              ),
            )}
          </ul>
          {editable && (
            <form
              className={`${columns} border-t px-1 pt-3 print:hidden`}
              onSubmit={(event) => {
                event.preventDefault();
                run(
                  () => addAction(organizationSlug, { invoiceId, ...newItem }),
                  () => setNewItem(EMPTY),
                );
              }}
            >
              <ItemInputs
                draft={newItem}
                disabled={pending}
                label="New item"
                onChange={setNewItem}
              />
              <span className="text-right text-sm text-muted-foreground tabular-nums">
                {previewAmount(newItem, currency)}
              </span>
              <div className="flex w-16 justify-end">
                <Button
                  type="submit"
                  size="sm"
                  variant="outline"
                  disabled={pending || !newItem.description.trim()}
                >
                  <Plus aria-hidden />
                  Add
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>
      {error && (
        <p
          role="alert"
          className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive print:hidden"
        >
          {error}
        </p>
      )}
    </div>
  );
}
