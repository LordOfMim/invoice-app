import { DeclarationClient } from "./DeclarationClient";

export default async function DeclarationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <DeclarationClient id={id} />;
}
