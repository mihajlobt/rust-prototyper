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
