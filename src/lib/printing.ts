/** Wait for the single invoice DOM, its local fonts and every rendered logo before either PDF flow. */
export async function waitForInvoicePrintReady(timeoutMs = 7000): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const frames = new Set<number>();
  const frame = () => new Promise<void>((resolve) => {
    const id = requestAnimationFrame(() => { frames.delete(id); resolve(); });
    frames.add(id);
  });
  const ready = async () => {
    await frame();
    await frame();
    await document.fonts.ready;
    const preview = document.getElementById("invoice-preview");
    if (!preview) throw new Error("Die Rechnungsvorschau ist noch nicht verfügbar. Bitte erneut versuchen.");
    await Promise.all(Array.from(preview.querySelectorAll("img")).map(async (image) => {
      try {
        await image.decode();
        if (!image.complete || image.naturalWidth <= 0) throw new Error("Image is incomplete");
      } catch {
        throw new Error("Ein Logo oder Bild der Rechnung konnte nicht geladen werden. Bitte die Bilddatei prüfen oder das Logo entfernen. Es wurde keine PDF erstellt.");
      }
    }));
  };
  try {
    await Promise.race([
      ready(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Die Schrift oder ein Bild der Rechnung konnte nicht rechtzeitig geladen werden. Es wurde keine PDF erstellt. Bitte erneut versuchen oder das Logo prüfen.")), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    for (const id of frames) cancelAnimationFrame(id);
  }
}
