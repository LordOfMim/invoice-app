import { ReminderClient } from "./ReminderClient";

export default async function ReminderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ReminderClient id={id} />;
}
