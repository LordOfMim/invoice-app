"use client";

import Link from "next/link";
import { use, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { Surface, PageHeader, Stack, Section, Grid } from "@/components/ui/Surface";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { t } from "@/lib/i18n";
import { usePersistedData } from "@/lib/storage/useStore";
import { 
  deleteRecurringInvoice, 
  upsertRecurringInvoice,
  generateInvoiceFromRecurring,
  listCustomers,
} from "@/lib/storage/store";
import { createDefaultLineItem } from "@/lib/defaults";
import type { RecurringInvoice, RecurringFrequency } from "@/lib/domain";

function parseNumber(input: string): number {
  const normalized = input.replace(",", ".");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}

export default function RecurringEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { adapter, data } = usePersistedData();
  const language = data?.settings.language ?? "de";
  const [showDelete, setShowDelete] = useState(false);

  const recurring = useMemo(() => {
    return data?.recurringInvoices.find((ri) => ri.id === id) ?? null;
  }, [data?.recurringInvoices, id]);

  const customers = useMemo(() => {
    if (!adapter) return [];
    return listCustomers(adapter);
  }, [adapter, data?.customers]);

  if (!adapter) {
    return (
      <main className="p-6 lg:p-8">
        <div className="mx-auto max-w-4xl">
          <Surface className="p-6 text-sm text-(--color-ink-muted)">
            {t(language, "common.loading")}
          </Surface>
        </div>
      </main>
    );
  }

  if (!recurring) {
    return (
      <main className="p-6 lg:p-8">
        <div className="mx-auto max-w-4xl">
          <Stack gap="sm">
            <p className="text-sm text-(--color-ink-muted)">Recurring invoice not found.</p>
            <Link href="/recurring" className="text-sm text-(--color-accent) hover:underline">
              ← Back to recurring invoices
            </Link>
          </Stack>
        </div>
      </main>
    );
  }

  const save = (next: RecurringInvoice) => {
    upsertRecurringInvoice(adapter, next);
  };

  const handleDelete = () => {
    deleteRecurringInvoice(adapter, id);
    window.location.assign("/recurring");
  };

  const handleGenerate = () => {
    const invoice = generateInvoiceFromRecurring(adapter, id);
    if (invoice) {
      window.location.assign(`/invoices/${invoice.id}`);
    }
  };

  const handleSelectCustomer = (customerId: string) => {
    const customer = customers.find((c) => c.id === customerId);
    if (!customer) return;
    save({
      ...recurring,
      customerId,
      recipient: {
        name: customer.name,
        address: customer.address,
        contact: customer.contact,
      },
    });
  };

  return (
    <main className="p-6 lg:p-8">
      <div className="mx-auto max-w-4xl">
        <PageHeader
          title={recurring.name || t(language, "recurring.new")}
          breadcrumb={
            <Link href="/recurring" className="text-(--color-ink-subtle) hover:text-(--color-accent) transition-colors">
              ← {t(language, "nav.recurring")}
            </Link>
          }
          actions={
            <div className="flex items-center gap-2">
              <Button variant="primary" onClick={handleGenerate}>
                {t(language, "actions.generate")} Invoice
              </Button>
              <Button variant="danger" onClick={() => setShowDelete(true)}>
                {t(language, "actions.delete")}
              </Button>
            </div>
          }
        />

        <Stack gap="md" className="mt-6">
          {/* Basic Settings */}
          <Surface>
            <Stack gap="md" className="p-5">
              <Section title="Settings">
                <Grid cols={2} gap="md">
                  <Field label={t(language, "recurring.name")}>
                    <Input
                      value={recurring.name}
                      onChange={(e) => save({ ...recurring, name: e.target.value })}
                      placeholder="e.g., Monthly Retainer - Client A"
                    />
                  </Field>

                  <Field label={t(language, "recurring.frequency")}>
                    <Select
                      value={recurring.frequency}
                      onChange={(e) => save({ ...recurring, frequency: e.target.value as RecurringFrequency })}
                    >
                      <option value="monthly">{t(language, "recurring.monthly")}</option>
                      <option value="quarterly">{t(language, "recurring.quarterly")}</option>
                      <option value="yearly">{t(language, "recurring.yearly")}</option>
                    </Select>
                  </Field>

                  <Field label={t(language, "recurring.nextRun")}>
                    <Input
                      type="date"
                      value={recurring.nextRunDate}
                      onChange={(e) => save({ ...recurring, nextRunDate: e.target.value })}
                    />
                  </Field>

                  <Field label={t(language, "recurring.reminder")} hint="Days before next run">
                    <Input
                      type="number"
                      min="0"
                      value={String(recurring.reminderDays)}
                      onChange={(e) => save({ ...recurring, reminderDays: parseInt(e.target.value) || 0 })}
                    />
                  </Field>
                </Grid>

                <div className="mt-4 flex flex-wrap gap-4">
                  <label className="flex items-center gap-2.5 text-sm text-(--color-ink-muted) cursor-pointer">
                    <input
                      type="checkbox"
                      checked={recurring.active}
                      onChange={(e) => save({ ...recurring, active: e.target.checked })}
                      className="h-4 w-4 rounded border-(--glass-border) text-(--color-accent) focus:ring-(--color-accent)"
                    />
                    {t(language, "recurring.active")}
                  </label>

                  <label className="flex items-center gap-2.5 text-sm text-(--color-ink-muted) cursor-pointer">
                    <input
                      type="checkbox"
                      checked={recurring.autoGenerate}
                      onChange={(e) => save({ ...recurring, autoGenerate: e.target.checked })}
                      className="h-4 w-4 rounded border-(--glass-border) text-(--color-accent) focus:ring-(--color-accent)"
                    />
                    {t(language, "recurring.autoGenerate")}
                  </label>
                </div>
              </Section>
            </Stack>
          </Surface>

          {/* Recipient */}
          <Surface>
            <Stack gap="md" className="p-5">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-(--color-ink)">{recurring.texts.recipientHeading}</h2>
                {customers.length > 0 && (
                  <Select
                    value={recurring.customerId || ""}
                    onChange={(e) => handleSelectCustomer(e.target.value)}
                    className="w-auto"
                  >
                    <option value="">{t(language, "actions.selectCustomer")}...</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </Select>
                )}
              </div>
              <Grid cols={1} gap="md">
                <Field label="Name">
                  <Input
                    value={recurring.recipient.name}
                    onChange={(e) => save({ ...recurring, recipient: { ...recurring.recipient, name: e.target.value } })}
                  />
                </Field>
                <Field label="Address">
                  <Textarea
                    rows={3}
                    value={recurring.recipient.address}
                    onChange={(e) => save({ ...recurring, recipient: { ...recurring.recipient, address: e.target.value } })}
                  />
                </Field>
                <Field label="Contact">
                  <Textarea
                    rows={2}
                    value={recurring.recipient.contact}
                    onChange={(e) => save({ ...recurring, recipient: { ...recurring.recipient, contact: e.target.value } })}
                  />
                </Field>
              </Grid>
            </Stack>
          </Surface>

          {/* Line Items */}
          <Surface>
            <Stack gap="md" className="p-5">
              <Section title="Line Items">
                <Stack gap="sm">
                  {recurring.lineItems.map((li, idx) => (
                    <Surface key={li.id} variant="soft" padding="sm" radius="md">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-xs font-medium text-(--color-ink-muted)">#{idx + 1}</span>
                        <Button
                          variant="danger"
                          onClick={() => {
                            save({
                              ...recurring,
                              lineItems: recurring.lineItems.filter((x) => x.id !== li.id),
                            });
                          }}
                        >
                          Remove
                        </Button>
                      </div>

                      <Grid cols={2} gap="sm">
                        <Field label="Description">
                          <Textarea
                            rows={2}
                            value={li.description}
                            onChange={(e) => {
                              save({
                                ...recurring,
                                lineItems: recurring.lineItems.map((x) =>
                                  x.id === li.id ? { ...x, description: e.target.value } : x
                                ),
                              });
                            }}
                          />
                        </Field>
                        <Grid cols={2} gap="sm">
                          <Field label="Quantity">
                            <Input
                              inputMode="decimal"
                              value={String(li.quantity)}
                              onChange={(e) => {
                                save({
                                  ...recurring,
                                  lineItems: recurring.lineItems.map((x) =>
                                    x.id === li.id ? { ...x, quantity: parseNumber(e.target.value) } : x
                                  ),
                                });
                              }}
                            />
                          </Field>
                          <Field label="Unit Price">
                            <Input
                              inputMode="decimal"
                              value={String(li.unitPrice)}
                              onChange={(e) => {
                                save({
                                  ...recurring,
                                  lineItems: recurring.lineItems.map((x) =>
                                    x.id === li.id ? { ...x, unitPrice: parseNumber(e.target.value) } : x
                                  ),
                                });
                              }}
                            />
                          </Field>
                          <Field label="Tax Rate" hint="e.g., 0.19">
                            <Input
                              inputMode="decimal"
                              placeholder="0.19"
                              value={li.taxRate === undefined ? "" : String(li.taxRate)}
                              onChange={(e) => {
                                const value = e.target.value.trim();
                                const nextRate = value === "" ? undefined : parseNumber(value);
                                save({
                                  ...recurring,
                                  lineItems: recurring.lineItems.map((x) =>
                                    x.id === li.id ? { ...x, taxRate: nextRate } : x
                                  ),
                                });
                              }}
                            />
                          </Field>
                        </Grid>
                      </Grid>
                    </Surface>
                  ))}

                  <Button
                    variant="secondary"
                    onClick={() => {
                      save({
                        ...recurring,
                        lineItems: [...recurring.lineItems, createDefaultLineItem(data?.settings.defaultTaxRate)],
                      });
                    }}
                  >
                    + Add Item
                  </Button>
                </Stack>
              </Section>
            </Stack>
          </Surface>

          {/* Footer */}
          <Surface>
            <Stack gap="md" className="p-5">
              <Section title={recurring.texts.footerHeading}>
                <Textarea
                  rows={4}
                  value={recurring.footerText}
                  onChange={(e) => save({ ...recurring, footerText: e.target.value })}
                />
              </Section>
            </Stack>
          </Surface>

          <div className="text-xs text-(--color-ink-subtle)">
            Created: {new Date(recurring.createdAt).toLocaleString()}
            {" · "}
            Updated: {new Date(recurring.updatedAt).toLocaleString()}
          </div>
        </Stack>
      </div>

      <ConfirmDialog
        open={showDelete}
        onClose={() => setShowDelete(false)}
        onConfirm={handleDelete}
        title="Delete Recurring Invoice"
        description="Are you sure you want to delete this recurring invoice? This action cannot be undone."
        confirmLabel={t(language, "actions.delete")}
        variant="danger"
      />
    </main>
  );
}
