"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Field } from "@/components/ui/Field";
import { Page, PageHeader, StatusNote } from "@/components/ui/Layout";
import { PrintStyles } from "@/components/PrintStyles";
import { usePersistedData } from "@/lib/storage/useStore";
import { STORAGE_KEY } from "@/lib/storage/keys";

type FachunternehmerData = {
  senderAddress: string;
  recipientName: string;
  recipientAddress: string;
  kommission: string;
  signatureName: string;
  signatureImage: string | null;
};

const DEFAULT_DATA: FachunternehmerData = {
  senderAddress: "Fa.Dembiany Schwirrammerweg 39 13129 Berlin",
  recipientName: "Fa.Germerott\nInnenausbau Gmbh & Co KG",
  recipientAddress: "Robert-Bosch-Strasse 3\n30989 Gehrden",
  kommission: "90105 Berlin, Pohlstraße 40,",
  signatureName: "Fa.Dembiany",
  signatureImage: null,
};

function getTodayDate(): string {
  const today = new Date();
  return today.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export default function FachunternehmerPage() {
  const { adapter } = usePersistedData();
  const [data, setData] = useState<FachunternehmerData>(() => {
    // Load initial data from storage if available
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("fachunternehmer-defaults");
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          return { ...DEFAULT_DATA, ...parsed };
        } catch {
          // ignore
        }
      }
    }
    return DEFAULT_DATA;
  });
  const [currentDate] = useState(getTodayDate());
  const [isEditing, setIsEditing] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "info"; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const saveDefaults = () => {
    if (!adapter) return;
    adapter.setItem("fachunternehmer-defaults", JSON.stringify(data));
    setNotice({ tone: "ok", text: "Standardwerte gespeichert." });
  };

  const loadDefaults = () => {
    if (!adapter) return;
    const stored = adapter.getItem("fachunternehmer-defaults");
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setData({ ...DEFAULT_DATA, ...parsed });
        setNotice({ tone: "ok", text: "Standardwerte geladen." });
      } catch {
        setNotice({ tone: "info", text: "Keine gespeicherten Standardwerte gefunden." });
      }
    } else {
      setNotice({ tone: "info", text: "Keine gespeicherten Standardwerte gefunden." });
    }
  };

  const resetToDefaults = () => {
    setData(DEFAULT_DATA);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      setData((prev) => ({ ...prev, signatureImage: dataUrl }));
    };
    reader.readAsDataURL(file);
  };

  const removeImage = () => {
    setData((prev) => ({ ...prev, signatureImage: null }));
  };

  const handlePrint = () => {
    window.print();
  };

  const updateField = (field: keyof FachunternehmerData, value: string) => {
    setData((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <Page>
      <PrintStyles />
      <PageHeader
        title="Fachunternehmererklärung"
        description="Übereinstimmungs- und Fachunternehmererklärung für ein Bauvorhaben ausfüllen und drucken. Die Angaben lassen sich als Standardwerte merken."
        actions={<>
          <Button variant="primary" onClick={handlePrint}>PDF / Drucken</Button>
          <Button aria-pressed={isEditing} onClick={() => setIsEditing(!isEditing)}>{isEditing ? "Fertig, Vorschau zeigen" : "Angaben bearbeiten"}</Button>
          <Button variant="ghost" onClick={saveDefaults}>Als Standard speichern</Button>
          <Button variant="ghost" onClick={loadDefaults}>Standard laden</Button>
          <Button variant="quiet" onClick={resetToDefaults}>Zurücksetzen</Button>
        </>}
      />
      {notice && <StatusNote tone={notice.tone} className="no-print">{notice.text}</StatusNote>}

      {/* Document: inner print layout unchanged; the screen frame is a ring (box-shadow), which print removes. */}
      <div className="print-area">
          <div className="invoice-paper mx-auto max-w-[210mm] rounded-card-sm bg-white p-10 ring-1 ring-line">
            <div className="flex min-h-[270mm] flex-col text-sm leading-relaxed text-zinc-800">
              {/* Sender */}
              <div className="mb-8">
                {isEditing ? (
                  <Field label="Absender">
                    <Input
                      value={data.senderAddress}
                      onChange={(e) => updateField("senderAddress", e.target.value)}
                    />
                  </Field>
                ) : (
                  <p className="text-xs text-zinc-500 underline underline-offset-2">
                    {data.senderAddress}
                  </p>
                )}
              </div>

              {/* Recipient */}
              <div className="mb-8">
                <p className="font-medium">An</p>
                {isEditing ? (
                  <div className="mt-2 space-y-2">
                    <Field label="Empfänger Name">
                      <Textarea
                        value={data.recipientName}
                        onChange={(e) => updateField("recipientName", e.target.value)}
                        rows={2}
                      />
                    </Field>
                    <Field label="Empfänger Adresse">
                      <Textarea
                        value={data.recipientAddress}
                        onChange={(e) => updateField("recipientAddress", e.target.value)}
                        rows={2}
                      />
                    </Field>
                  </div>
                ) : (
                  <div className="mt-1 whitespace-pre-line">
                    {data.recipientName}
                    {"\n"}
                    {data.recipientAddress}
                  </div>
                )}
              </div>

              {/* Kommission */}
              <div className="mb-6">
                <p className="font-medium">Kommission und BV</p>
                {isEditing ? (
                  <Field label="Kommission">
                    <Input
                      value={data.kommission}
                      onChange={(e) => updateField("kommission", e.target.value)}
                    />
                  </Field>
                ) : (
                  <p className="mt-1">{data.kommission}</p>
                )}
              </div>

              {/* Date */}
              <div className="mb-8">
                <p>
                  <span className="font-medium">Datum</span> {currentDate}
                </p>
              </div>

              {/* Title */}
              <div className="mb-6">
                <h2 className="text-lg font-semibold">
                  Übereistimmungs / Fachunternehmererklärung
                </h2>
              </div>

              {/* Body */}
              <div className="mb-8 space-y-4">
                <p>Sehr geehrte Damen und Herren</p>
                <p>
                  Die von uns ausgeführten Arbeiten an den oben genannten Bauvorhaben wurden
                  nach den anerkannten Regeln der Technik, sowie nach den DIN-Normen und
                  Herstellervorschrift fachgerecht eingebaut.
                </p>
                <p>Siehe Anhang Datenblätter</p>
              </div>

              {/* Signature area - grows to push content down */}
              <div className="mt-auto flex items-end justify-between pt-12">
                {/* Left: Greeting and signature */}
                <div>
                  <p className="mb-8">Mit freundlichen Grüßen</p>
                  {isEditing ? (
                    <Field label="Unterschrift Name">
                      <Input
                        value={data.signatureName}
                        onChange={(e) => updateField("signatureName", e.target.value)}
                      />
                    </Field>
                  ) : (
                    <p className="font-medium">{data.signatureName}</p>
                  )}
                </div>

                {/* Right: Signature Image */}
                <div className="text-right">
                  {isEditing && (
                    <div className="mb-2 no-print">
                      <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleImageUpload}
                        accept="image/*"
                        className="hidden"
                      />
                      <div className="flex gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => fileInputRef.current?.click()}
                        >
                          Bild hochladen
                        </Button>
                        {data.signatureImage && (
                          <Button variant="ghost" size="sm" onClick={removeImage}>
                            Bild entfernen
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                  {data.signatureImage && (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={data.signatureImage}
                      alt="Unterschrift / Stempel"
                      className="max-h-40 max-w-xs object-contain"
                    />
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
    </Page>
  );
}
