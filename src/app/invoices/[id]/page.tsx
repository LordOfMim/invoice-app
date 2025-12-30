import { InvoiceEditorClient } from "./InvoiceEditorClient";

export default async function InvoiceEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <InvoiceEditorClient id={id} />;
}

