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
  type: "screen"
  label: string
  /** URL route pattern for this screen, e.g. "/paper/:id". */
  urlPath?: string
  /** Navigable URL with real IDs resolved, e.g. "/paper/p1". Falls back to urlPath for static routes. */
  previewPath?: string
}
