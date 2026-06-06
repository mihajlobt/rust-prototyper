export interface WizardAnnotation {
  id: string
  type: "point" | "region"
  x: number
  y: number
  w?: number
  h?: number
  text: string
  resolved: boolean
  createdAt: number
}

export interface WizardPreviewTab {
  id: string
  type: "screen" | "theme"
  label: string
  /** URL route for iframe navigation, e.g. "/dashboard". Screen tabs only. */
  urlPath?: string
  /** Theme directory slug, e.g. "wizard". Theme tabs only. */
  themeSlug?: string
  /** Raw CSS for ThemeTokenPreview. Populated after readFile resolves. */
  themeCss?: string
}
