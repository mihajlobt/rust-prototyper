/**
 * Returns the __theme-preview.tsx template — the design-language showcase page
 * written to generated/src/__theme-preview.tsx at scaffold time.
 *
 * Lives in its own file because it is the largest single template (~300 lines).
 * The showcase reads the applied design tokens (theme.css variables) for color
 * swatches, typography scale, spacing ramp, radii, shadows, and motion. Works
 * for legacy CSS-only themes too (gracefully skips extended families).
 *
 * See ./scaffold-shadcn.ts for the barrel re-export.
 */

/** Returns a full design-language showcase page written to generated/src/__theme-preview.tsx at scaffold time. The showcase reads the applied design tokens (theme.css variables) for color swatches, typography scale, spacing ramp, radii, shadows, and motion. Works for legacy CSS-only themes too (gracefully skips extended families). */
export function getThemePreviewTsx(): string {
  return `import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'

const FALLBACK = (key: string, fallback: string) => getComputedStyle(document.documentElement).getPropertyValue(key).trim() || fallback

function TokenSlot({ label, value, cssVar }: { label: string; value?: string; cssVar?: string }) {
  const display = value || (cssVar ? FALLBACK(cssVar, '') : '')
  return (
    <div className="flex items-center justify-between text-xs py-1 border-b border-border/30 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono tabular-nums">{display}</span>
    </div>
  )
}

function Swatch({ label, cssVar }: { label: string; cssVar: string }) {
  const color = FALLBACK(cssVar, 'transparent')
  return (
    <div className="flex items-center gap-2 text-xs">
      <div className="w-6 h-6 rounded-md border border-border/40 shrink-0" style={{ background: color ? 'var(' + cssVar + ')' : undefined }} />
      <div className="flex-1 min-w-0">
        <div className="font-mono text-[10px] text-muted-foreground truncate">{cssVar}</div>
        <div className="truncate font-medium">{label}</div>
      </div>
    </div>
  )
}

function ShowcaseTab() {
  const fonts = [
    { label: 'Sans', cssVar: '--font-sans', sample: 'The quick brown fox jumps over the lazy dog.' },
    { label: 'Display', cssVar: '--font-display', sample: 'Display Heading' },
    { label: 'Mono', cssVar: '--font-mono', sample: 'import { useState } from "react"' },
    { label: 'Serif', cssVar: '--font-serif', sample: 'The quick brown fox jumps over the lazy dog.' },
  ].filter((f) => !!FALLBACK(f.cssVar, ''))

  const typeScale = [
    { label: 'XS', cssVar: '--text-xs' },
    { label: 'SM', cssVar: '--text-sm' },
    { label: 'Base', cssVar: '--text-base' },
    { label: 'LG', cssVar: '--text-lg' },
    { label: 'XL', cssVar: '--text-xl' },
    { label: '2XL', cssVar: '--text-2xl' },
    { label: '3XL', cssVar: '--text-3xl' },
    { label: '4XL', cssVar: '--text-4xl' },
  ]

  const spaceScale = [
    { label: 'XS', cssVar: '--space-xs' },
    { label: 'SM', cssVar: '--space-sm' },
    { label: 'MD', cssVar: '--space-md' },
    { label: 'LG', cssVar: '--space-lg' },
    { label: 'XL', cssVar: '--space-xl' },
    { label: '2XL', cssVar: '--space-2xl' },
    { label: '3XL', cssVar: '--space-3xl' },
  ]

  const radiiScale = [
    { label: 'SM', cssVar: '--radius-sm' },
    { label: 'MD', cssVar: '--radius-md' },
    { label: 'LG', cssVar: '--radius-lg' },
    { label: 'Full', cssVar: '--radius-full' },
  ]

  const shadowScale = [
    { label: 'SM', cssVar: '--shadow-sm' },
    { label: 'MD', cssVar: '--shadow-md' },
    { label: 'LG', cssVar: '--shadow-lg' },
    { label: 'XL', cssVar: '--shadow-xl' },
  ]

  const motionScale = [
    { label: 'Fast', cssVar: '--duration-fast' },
    { label: 'Normal', cssVar: '--duration-normal' },
    { label: 'Slow', cssVar: '--duration-slow' },
  ]

  const hasExtended = !!FALLBACK('--font-sans', '')

  return (
    <div className="space-y-6">
      {/* Color swatches — light (always shown) */}
      <Card>
        <CardHeader>
          <CardTitle>Semantic Colors — Light</CardTitle>
          <CardDescription>Surface, accent, and action tokens in light mode.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Swatch label="Background" cssVar="--background" />
            <Swatch label="Foreground" cssVar="--foreground" />
            <Swatch label="Card" cssVar="--card" />
            <Swatch label="Card Foreground" cssVar="--card-foreground" />
            <Swatch label="Popover" cssVar="--popover" />
            <Swatch label="Popover Foreground" cssVar="--popover-foreground" />
            <Swatch label="Primary" cssVar="--primary" />
            <Swatch label="Primary Foreground" cssVar="--primary-foreground" />
            <Swatch label="Secondary" cssVar="--secondary" />
            <Swatch label="Secondary Foreground" cssVar="--secondary-foreground" />
            <Swatch label="Muted" cssVar="--muted" />
            <Swatch label="Muted Foreground" cssVar="--muted-foreground" />
            <Swatch label="Accent" cssVar="--accent" />
            <Swatch label="Accent Foreground" cssVar="--accent-foreground" />
            <Swatch label="Destructive" cssVar="--destructive" />
            <Swatch label="Destructive Foreground" cssVar="--destructive-foreground" />
            <Swatch label="Border" cssVar="--border" />
            <Swatch label="Input" cssVar="--input" />
            <Swatch label="Ring" cssVar="--ring" />
          </div>
        </CardContent>
      </Card>

      {/* Color swatches — dark */}
      <Card className="dark">
        <CardHeader>
          <CardTitle>Semantic Colors — Dark</CardTitle>
          <CardDescription>Adaptive surface values in dark mode.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Swatch label="Background" cssVar="--background" />
            <Swatch label="Foreground" cssVar="--foreground" />
            <Swatch label="Card" cssVar="--card" />
            <Swatch label="Primary" cssVar="--primary" />
            <Swatch label="Secondary" cssVar="--secondary" />
            <Swatch label="Muted" cssVar="--muted" />
            <Swatch label="Accent" cssVar="--accent" />
            <Swatch label="Destructive" cssVar="--destructive" />
            <Swatch label="Border" cssVar="--border" />
          </div>
        </CardContent>
      </Card>

      {/* Typography */}
      <Card>
        <CardHeader>
          <CardTitle>Typography</CardTitle>
          <CardDescription>Font families and type scale.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {hasExtended ? (
            fonts.map((f) => (
              <div key={f.label}>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="font-mono text-muted-foreground">{f.cssVar}</span>
                  <span className="font-medium">{FALLBACK(f.cssVar, '')}</span>
                </div>
                <div style={{ fontFamily: 'var(' + f.cssVar + ')' }} className="text-sm">{f.sample}</div>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">Extended typography tokens are not defined in this theme.</p>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2">
            {typeScale.map((t) => (
              <div key={t.label} className={"p-2 rounded border border-border/30 " + (FALLBACK(t.cssVar, '') ? "" : "opacity-40")}>
                <div className="text-[10px] text-muted-foreground font-mono">{t.cssVar}</div>
                <div style={{ fontSize: 'var(' + t.cssVar + ')' }} className="leading-tight">Aa</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Spacing */}
      <Card>
        <CardHeader>
          <CardTitle>Spacing</CardTitle>
          <CardDescription>Base unit and scale ramp.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <TokenSlot label="Base unit" cssVar="--space-base" />
            {spaceScale.map((s) => (
              <div key={s.label} className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground w-10 shrink-0">{s.label}</span>
                <span className="font-mono tabular-nums w-14 shrink-0">{FALLBACK(s.cssVar, '')}</span>
                <div className="h-2 bg-primary rounded-sm" style={{ width: FALLBACK(s.cssVar, '0px'), opacity: 0.6 }} />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Radii */}
      <Card>
        <CardHeader>
          <CardTitle>Radii</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          {radiiScale.map((r) => (
            <div key={r.label} className="flex flex-col items-center gap-1">
              <div className="w-12 h-12 bg-primary/60 border border-border/40" style={{ borderRadius: 'var(' + r.cssVar + ')' }} />
              <span className="text-[10px] text-muted-foreground">{r.label}</span>
            </div>
          ))}
          <div className="flex flex-col items-center gap-1">
            <div className="w-12 h-12 bg-primary/60 border border-border/40" style={{ borderRadius: 'var(--radius)' }} />
            <span className="text-[10px] text-muted-foreground">base</span>
          </div>
        </CardContent>
      </Card>

      {/* Shadows */}
      <Card>
        <CardHeader>
          <CardTitle>Shadows</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-4">
          {shadowScale.map((s) => (
            <div key={s.label} className="flex flex-col items-center gap-1">
              <div className="w-12 h-12 bg-card border border-border/40" style={{ boxShadow: 'var(' + s.cssVar + ')' }} />
              <span className="text-[10px] text-muted-foreground">{s.label}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Motion */}
      <Card>
        <CardHeader>
          <CardTitle>Motion</CardTitle>
          <CardDescription>Durations and easing curves.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-3">
            {motionScale.map((m) => (
              <Button key={m.label} size="sm" style={{ transitionDuration: 'var(' + m.cssVar + ')' }} className="hover:bg-primary/80 transition-colors">
                {m.label} ({FALLBACK(m.cssVar, '')})
              </Button>
            ))}
          </div>
          <TokenSlot label="Standard easing" cssVar="--ease-standard" />
          <TokenSlot label="Emphasized easing" cssVar="--ease-emphasized" />
          <TokenSlot label="Decelerate easing" cssVar="--ease-decelerate" />
        </CardContent>
      </Card>

      {/* Component samples (legacy, preserved) */}
      <Card>
        <CardHeader>
          <CardTitle>Buttons</CardTitle>
          <CardDescription>Primary interaction surfaces</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Destructive</Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Badges &amp; Input</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Badge>Default</Badge>
            <Badge variant="secondary">Secondary</Badge>
            <Badge variant="outline">Outline</Badge>
            <Badge variant="destructive">Destructive</Badge>
          </div>
          <Input placeholder="Input field" />
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Tabs</CardTitle></CardHeader>
        <CardContent>
          <Tabs defaultValue="tab1">
            <TabsList>
              <TabsTrigger value="tab1">Overview</TabsTrigger>
              <TabsTrigger value="tab2">Details</TabsTrigger>
              <TabsTrigger value="tab3">Settings</TabsTrigger>
            </TabsList>
            <TabsContent value="tab1" className="pt-3 text-sm text-muted-foreground">Overview content.</TabsContent>
            <TabsContent value="tab2" className="pt-3 text-sm text-muted-foreground">Details content.</TabsContent>
            <TabsContent value="tab3" className="pt-3 text-sm text-muted-foreground">Settings content.</TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  )
}

export default function ThemePreview() {
  return (
    <div className="p-8 space-y-6 bg-background min-h-screen">
      <div>
        <h1 className="text-2xl font-bold text-foreground mb-1">Design Language Preview</h1>
        <p className="text-sm text-muted-foreground">Live showcase of the active design language applied to shadcn/ui components, tokens, spacing, radii, shadows, and motion.</p>
      </div>
      <ShowcaseTab />
    </div>
  )
}
`;
}
