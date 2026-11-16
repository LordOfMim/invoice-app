import { InvoiceEditorClient } from "@/app/invoices/[id]/InvoiceEditorClient";

export default async function QuoteEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <InvoiceEditorClient id={id} kind="quote" />;
}
