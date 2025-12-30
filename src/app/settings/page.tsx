"use client";

import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { Surface, PageHeader, Section, Stack, Grid } from "@/components/ui/Surface";
import type { InvoiceTemplateId, Language } from "@/lib/domain";
import { createDefaultTextsDe } from "@/lib/defaults";
import { t } from "@/lib/i18n";
import { usePersistedData } from "@/lib/storage/useStore";
import { updateSettings } from "@/lib/storage/store";

export default function SettingsPage() {
  const { adapter, data } = usePersistedData();
  const settings = data?.settings;
  const language = settings?.language ?? "de";

  if (!adapter || !settings) {
    return (
      <main className="p-6 lg:p-8">
        <div className="mx-auto max-w-(--content-max-width)">
          <Surface variant="solid" padding="lg">
            <div className="text-sm text-[var(--color-ink-subtle)]">Loading…</div>
          </Surface>
        </div>
      </main>
    );
  }

  return (
    <main className="p-6 lg:p-8">
      <div className="mx-auto max-w-(--content-max-width)">
        <Stack gap="xl">
          <PageHeader
            title={t(language, "settings.title")}
            description="Defaults are applied when you create a new invoice."
          />

          <Section title={t(language, "settings.language")}>
            <Surface variant="solid" padding="lg">
              <div className="max-w-xs">
                <Select
                  value={settings.language}
                  onChange={(e) => {
                    const nextLang = e.target.value as Language;
                    updateSettings(adapter, (prev) => ({ ...prev, language: nextLang }));
                  }}
                >
                  <option value="de">Deutsch</option>
                  <option value="en">English</option>
                </Select>
              </div>
            </Surface>
          </Section>

          <Section title="Defaults">
            <Surface variant="solid" padding="lg">
              <Stack gap="lg">
                <Grid cols={2} gap="md">
                  <Field label={t(language, "settings.currency")}>
                    <Input
                      value={settings.currency}
                      onChange={(e) =>
                        updateSettings(adapter, (prev) => ({ ...prev, currency: e.target.value.toUpperCase() }))
                      }
                    />
                  </Field>

                  <Field label={t(language, "settings.defaultTaxRate")}>
                    <Input
                      inputMode="decimal"
                      value={settings.defaultTaxRate === undefined ? "" : String(settings.defaultTaxRate)}
                      onChange={(e) => {
                        const value = e.target.value.trim();
                        const normalized = value.replace(",", ".");
                        const n = value === "" ? undefined : Number(normalized);
                        updateSettings(adapter, (prev) => ({
                          ...prev,
                          defaultTaxRate:
                            n === undefined
                              ? undefined
                              : Number.isFinite(n)
                                ? n
                                : prev.defaultTaxRate,
                        }));
                      }}
                    />
                  </Field>

                  <Field label={t(language, "settings.defaultTemplate")}>
                    <Select
                      value={settings.defaultTemplateId}
                      onChange={(e) => {
                        const templateId = e.target.value as InvoiceTemplateId;
                        updateSettings(adapter, (prev) => ({ ...prev, defaultTemplateId: templateId }));
                      }}
                    >
                      <option value="classic">Classic</option>
                      <option value="modern">Modern</option>
                      <option value="minimal">Minimal</option>
                    </Select>
                  </Field>

                  <Field label="Logo Position">
                    <Select
                      value={settings.defaultLayout.logoPosition}
                      onChange={(e) => {
                        const logoPosition = e.target.value as typeof settings.defaultLayout.logoPosition;
                        updateSettings(adapter, (prev) => ({
                          ...prev,
                          defaultLayout: { ...prev.defaultLayout, logoPosition },
                        }));
                      }}
                    >
                      <option value="left">Top-Left</option>
                      <option value="center">Top-Center</option>
                      <option value="right">Top-Right</option>
                    </Select>
                  </Field>

                  <Field label="Logo Größe">
                    <Select
                      value={settings.defaultLayout.logoSize ?? "medium"}
                      onChange={(e) => {
                        const logoSize = e.target.value as "small" | "medium" | "large";
                        updateSettings(adapter, (prev) => ({
                          ...prev,
                          defaultLayout: { ...prev.defaultLayout, logoSize },
                        }));
                      }}
                    >
                      <option value="small">Klein</option>
                      <option value="medium">Mittel</option>
                      <option value="large">Groß</option>
                    </Select>
                  </Field>
                </Grid>

                <div className="flex flex-wrap gap-6">
                  <label className="flex items-center gap-2.5 text-sm text-[var(--color-ink-muted)] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.defaultLayout.showLogo}
                      onChange={(e) =>
                        updateSettings(adapter, (prev) => ({
                          ...prev,
                          defaultLayout: { ...prev.defaultLayout, showLogo: e.target.checked },
                        }))
                      }
                      className="h-4 w-4 rounded border-[var(--glass-border)] text-[var(--color-accent)] focus:ring-[var(--color-accent)]"
                    />
                    Show Logo
                  </label>

                  <label className="flex items-center gap-2.5 text-sm text-[var(--color-ink-muted)] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.defaultLayout.showFooter}
                      onChange={(e) =>
                        updateSettings(adapter, (prev) => ({
                          ...prev,
                          defaultLayout: { ...prev.defaultLayout, showFooter: e.target.checked },
                        }))
                      }
                      className="h-4 w-4 rounded border-[var(--glass-border)] text-[var(--color-accent)] focus:ring-[var(--color-accent)]"
                    />
                    Show Footer
                  </label>
                </div>

                <Grid cols={2} gap="md">
                  <Field label="Sender Position">
                    <Select
                      value={settings.defaultLayout.senderPosition}
                      onChange={(e) => {
                        const senderPosition = e.target.value as typeof settings.defaultLayout.senderPosition;
                        updateSettings(adapter, (prev) => ({
                          ...prev,
                          defaultLayout: { ...prev.defaultLayout, senderPosition },
                        }));
                      }}
                    >
                      <option value="left">Left</option>
                      <option value="right">Right</option>
                    </Select>
                  </Field>

                  <Field label="Recipient Position">
                    <Select
                      value={settings.defaultLayout.recipientPosition}
                      onChange={(e) => {
                        const recipientPosition = e.target.value as typeof settings.defaultLayout.recipientPosition;
                        updateSettings(adapter, (prev) => ({
                          ...prev,
                          defaultLayout: { ...prev.defaultLayout, recipientPosition },
                        }));
                      }}
                    >
                      <option value="left">Left</option>
                      <option value="right">Right</option>
                    </Select>
                  </Field>

                  <Field label={t(language, "settings.pdfFilenamePattern")} className="sm:col-span-2">
                    <Input
                      value={settings.pdfFilenamePattern}
                      onChange={(e) => updateSettings(adapter, (prev) => ({ ...prev, pdfFilenamePattern: e.target.value }))}
                    />
                  </Field>
                </Grid>
              </Stack>
            </Surface>
          </Section>

          <Grid cols={2} gap="lg">
            <Section title={t(language, "settings.defaultSender")}>
              <Surface variant="solid" padding="lg">
                <Stack gap="md">
                  <Field label="Name">
                    <Input
                      value={settings.defaultSender.name}
                      onChange={(e) =>
                        updateSettings(adapter, (prev) => ({
                          ...prev,
                          defaultSender: { ...prev.defaultSender, name: e.target.value },
                        }))
                      }
                    />
                  </Field>
                  <Field label="Address">
                    <Textarea
                      rows={3}
                      value={settings.defaultSender.address}
                      onChange={(e) =>
                        updateSettings(adapter, (prev) => ({
                          ...prev,
                          defaultSender: { ...prev.defaultSender, address: e.target.value },
                        }))
                      }
                    />
                  </Field>
                  <Field label="Contact">
                    <Textarea
                      rows={2}
                      value={settings.defaultSender.contact}
                      onChange={(e) =>
                        updateSettings(adapter, (prev) => ({
                          ...prev,
                          defaultSender: { ...prev.defaultSender, contact: e.target.value },
                        }))
                      }
                    />
                  </Field>
                </Stack>
              </Surface>
            </Section>

            <Section title={t(language, "settings.defaultFooter")}>
              <Surface variant="solid" padding="lg">
                <Textarea
                  rows={8}
                  value={settings.defaultFooterText}
                  onChange={(e) => updateSettings(adapter, (prev) => ({ ...prev, defaultFooterText: e.target.value }))}
                  className="h-full min-h-[200px]"
                />
              </Surface>
            </Section>
          </Grid>

          <Section title={t(language, "settings.defaultLogo")}>
            <Surface variant="solid" padding="lg">
              <Stack gap="md">
                <Input
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = () => {
                      const result = reader.result;
                      if (typeof result !== "string") return;
                      updateSettings(adapter, (prev) => ({ ...prev, defaultLogoDataUrl: result }));
                    };
                    reader.readAsDataURL(file);
                  }}
                />
                {settings.defaultLogoDataUrl && (
                  <div className="flex items-center gap-4">
                    <img 
                      src={settings.defaultLogoDataUrl} 
                      alt="Logo preview" 
                      className="h-16 w-auto rounded-lg border border-[var(--glass-border)]"
                    />
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => updateSettings(adapter, (prev) => ({ ...prev, defaultLogoDataUrl: undefined }))}
                    >
                      Remove logo
                    </Button>
                  </div>
                )}
              </Stack>
            </Surface>
          </Section>

          <Section 
            title="Invoice Text Defaults"
            description="These defaults are copied into every new invoice (editable per invoice)."
          >
            <Surface variant="soft" padding="md">
              <Button 
                variant="secondary"
                onClick={() => updateSettings(adapter, (prev) => ({ ...prev, defaultTexts: createDefaultTextsDe() }))}
              >
                Reset to German defaults
              </Button>
            </Surface>
          </Section>
        </Stack>
      </div>
    </main>
  );
}
