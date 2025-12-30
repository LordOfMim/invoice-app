"use client";

import Link from "next/link";
import { use, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Surface, PageHeader, Stack, Grid, Section } from "@/components/ui/Surface";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { t } from "@/lib/i18n";
import { usePersistedData } from "@/lib/storage/useStore";
import { deleteCustomer, upsertCustomer } from "@/lib/storage/store";
import type { Customer } from "@/lib/domain";

export default function CustomerEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { adapter, data } = usePersistedData();
  const language = data?.settings.language ?? "de";
  const [showDelete, setShowDelete] = useState(false);

  const customer = useMemo(() => {
    return data?.customers.find((c) => c.id === id) ?? null;
  }, [data?.customers, id]);

  if (!adapter) {
    return (
      <main className="p-6 lg:p-8">
        <div className="mx-auto max-w-(--content-max-width)">
          <Surface className="p-6 text-sm text-(--color-ink-muted)">
            {t(language, "common.loading")}
          </Surface>
        </div>
      </main>
    );
  }

  if (!customer) {
    return (
      <main className="p-6 lg:p-8">
        <div className="mx-auto max-w-(--content-max-width)">
          <Stack gap="sm">
            <p className="text-sm text-(--color-ink-muted)">Customer not found.</p>
            <Link href="/customers" className="text-sm text-(--color-accent) hover:underline">
              ← Back to customers
            </Link>
          </Stack>
        </div>
      </main>
    );
  }

  const save = (next: Customer) => {
    upsertCustomer(adapter, next);
  };

  const handleDelete = () => {
    deleteCustomer(adapter, id);
    window.location.assign("/customers");
  };

  return (
    <main className="p-6 lg:p-8">
      <div className="mx-auto max-w-(--content-max-width)">
        <PageHeader
          title={customer.name || t(language, "customers.new")}
          breadcrumb={
            <Link href="/customers" className="text-(--color-ink-subtle) hover:text-(--color-accent) transition-colors">
              ← {t(language, "nav.customers")}
            </Link>
          }
          actions={
            <Button variant="danger" onClick={() => setShowDelete(true)}>
              {t(language, "actions.delete")}
            </Button>
          }
        />

        <Surface className="mt-6">
          <Stack gap="lg" className="p-6">
            <Section title="Basic Information">
              <Grid cols={2} gap="md">
                <Field label="Anrede">
                  <Input
                    value={customer.salutation || ""}
                    onChange={(e) => save({ ...customer, salutation: e.target.value })}
                    placeholder="z.B. Sehr geehrte Damen und Herren"
                  />
                </Field>

                <Field label={t(language, "customers.name")}>
                  <Input
                    value={customer.name}
                    onChange={(e) => save({ ...customer, name: e.target.value })}
                    placeholder="Company or Person Name"
                  />
                </Field>

                <Field label={t(language, "customers.email")}>
                  <Input
                    type="email"
                    value={customer.email || ""}
                    onChange={(e) => save({ ...customer, email: e.target.value })}
                    placeholder="email@example.com"
                  />
                </Field>

                <Field label={t(language, "customers.phone")}>
                  <Input
                    type="tel"
                    value={customer.phone || ""}
                    onChange={(e) => save({ ...customer, phone: e.target.value })}
                    placeholder="+49 123 456789"
                  />
                </Field>

                <Field label={t(language, "customers.taxId")}>
                  <Input
                    value={customer.taxId || ""}
                    onChange={(e) => save({ ...customer, taxId: e.target.value })}
                    placeholder="DE123456789"
                  />
                </Field>
              </Grid>
            </Section>

            <Section title="Address & Contact">
              <Grid cols={1} gap="md">
                <Field label={t(language, "customers.address")}>
                  <Textarea
                    rows={3}
                    value={customer.address}
                    onChange={(e) => save({ ...customer, address: e.target.value })}
                    placeholder="Street, City, Country"
                  />
                </Field>

                <Field label={t(language, "customers.contact")}>
                  <Textarea
                    rows={2}
                    value={customer.contact}
                    onChange={(e) => save({ ...customer, contact: e.target.value })}
                    placeholder="Contact person, department, etc."
                  />
                </Field>
              </Grid>
            </Section>

            <Section title="Notes">
              <Field label={t(language, "customers.notes")}>
                <Textarea
                  rows={3}
                  value={customer.notes || ""}
                  onChange={(e) => save({ ...customer, notes: e.target.value })}
                  placeholder="Internal notes about this customer..."
                />
              </Field>
            </Section>

            <div className="text-xs text-(--color-ink-subtle) pt-2 border-t border-(--glass-border)">
              Created: {new Date(customer.createdAt).toLocaleString()}
              {" · "}
              Updated: {new Date(customer.updatedAt).toLocaleString()}
            </div>
          </Stack>
        </Surface>
      </div>

      <ConfirmDialog
        open={showDelete}
        onClose={() => setShowDelete(false)}
        onConfirm={handleDelete}
        title="Delete Customer"
        description="Are you sure you want to delete this customer? This action cannot be undone."
        confirmLabel={t(language, "actions.delete")}
        variant="danger"
      />
    </main>
  );
}
