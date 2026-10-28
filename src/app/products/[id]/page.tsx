"use client";

import Link from "next/link";
import { use, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { DecimalInput } from "@/components/ui/DecimalInput";
import { Field } from "@/components/ui/Field";
import { FormPage, FormSection } from "@/components/ui/FormLayout";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Page, PageHeader, RecordStamp, initialsOf } from "@/components/ui/Layout";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { usePageCrumb } from "@/components/shell/AppShell";
import { t } from "@/lib/i18n";
import { roundMoney } from "@/lib/money";
import { usePersistedData } from "@/lib/storage/useStore";
import { deleteProduct, upsertProduct } from "@/lib/storage/store";
import type { Product } from "@/lib/domain";

export default function ProductEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { adapter, data } = usePersistedData();
  const language = data?.settings.language ?? "de";
  const de = language === "de";
  const [showDelete, setShowDelete] = useState(false);
  const product = useMemo(() => data?.products.find((p) => p.id === id) ?? null, [data?.products, id]);
  usePageCrumb(product ? product.name || t(language, "common.unnamed") : null);

  if (!adapter) return <p className="font-sans text-lg tracking-snug text-ink-muted">{t(language, "common.loading")}</p>;

  if (!product) {
    return (
      <Page>
        <PageHeader title={t(language, "products.notFound")} />
        <div><Link href="/products" className="font-sans text-lg font-medium tracking-snug text-link underline-offset-3 hover:underline">{t(language, "products.back")}</Link></div>
      </Page>
    );
  }

  const save = (next: Product) => upsertProduct(adapter, next);

  return (
    <Page>
      <PageHeader
        variant="entity"
        title={product.name || t(language, "products.new")}
        initials={initialsOf(product.name) || "P"}
        description={de ? "Wird beim Übernehmen als Position in die Rechnung eingesetzt. Änderungen werden automatisch lokal gespeichert." : "Filled into an invoice as a line item. Changes are saved locally automatically."}
        actions={<Button variant="ghost" className="text-danger hover:bg-danger/5" onClick={() => setShowDelete(true)}>{de ? "Produkt löschen …" : "Delete product …"}</Button>}
      />

      <FormPage>
        <FormSection title={t(language, "products.basicInfo")}>
          <Field label={t(language, "products.name")}>
            <Input value={product.name} onChange={(e) => save({ ...product, name: e.target.value })} placeholder={de ? "Produkt- oder Leistungsname" : "Product or service name"} />
          </Field>
          <Field label={`${t(language, "products.category")} ${de ? "(optional)" : "(optional)"}`}>
            <Input value={product.category || ""} onChange={(e) => save({ ...product, category: e.target.value })} placeholder={de ? "z. B. Montage, Material" : "e.g. Consulting, Development"} />
          </Field>
          <Field label={t(language, "products.description")} hint={de ? "Steht so in der Rechnungsposition." : "Appears like this in the line item."} className="@md:col-span-2">
            <Textarea rows={3} value={product.description} onChange={(e) => save({ ...product, description: e.target.value })} />
          </Field>
        </FormSection>

        <FormSection title={t(language, "products.pricing")} columns={3}>
          <Field label={t(language, "products.unit")}>
            <Input value={product.unit || ""} onChange={(e) => save({ ...product, unit: e.target.value })} placeholder={de ? "z. B. Stunde, Stück" : "e.g. hour, unit"} />
          </Field>
          <Field label={t(language, "products.unitPrice")} hint={de ? "Mit Komma, z. B. 85,50" : "e.g. 85.50"}>
            <DecimalInput value={product.unitPrice} onValueChange={(unitPrice) => save({ ...product, unitPrice: unitPrice ?? 0 })} />
          </Field>
          <Field label={`${t(language, "products.taxRate")} %`} hint={de ? "z. B. 19. Leer lassen für ohne Steuer." : "e.g. 19. Leave empty for no tax."}>
            <DecimalInput allowEmpty value={product.taxRate === undefined ? undefined : roundMoney(product.taxRate * 100)} onValueChange={(percent) => save({ ...product, taxRate: percent === undefined ? undefined : percent / 100 })} />
          </Field>
        </FormSection>

        <RecordStamp>
          {t(language, "common.created")}: {new Date(product.createdAt).toLocaleString(de ? "de-DE" : "en-US")} · {t(language, "common.updated")}: {new Date(product.updatedAt).toLocaleString(de ? "de-DE" : "en-US")}
        </RecordStamp>
      </FormPage>

      <ConfirmDialog
        open={showDelete}
        onClose={() => setShowDelete(false)}
        onConfirm={() => { deleteProduct(adapter, id); window.location.assign("/products"); }}
        title={t(language, "products.deleteTitle")}
        description={t(language, "products.deleteDescriptionLong")}
        confirmLabel={t(language, "actions.delete")}
        cancelLabel={t(language, "common.cancel")}
        warningLabel={t(language, "common.cannotUndo")}
        variant="danger"
      />
    </Page>
  );
}
