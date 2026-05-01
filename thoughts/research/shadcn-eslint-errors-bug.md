Full findings with references
Problem A: react-refresh/only-export-components — 10 false-positive errors
Origin: eslint-plugin-react-refresh v0.5.2's configs.vite enables only-export-components with allowConstantExport: true. Shadcn components export non-constant variants (e.g., buttonVariants = cva(...)) alongside components, violating this rule.
Known shadcn bugs (both still OPEN, no maintainer response):
- shadcn-ui/ui#7736 (https://github.com/shadcn-ui/ui/issues/7736) — "Components are exporting constants and functions causing Fast Refresh lint issue"
- shadcn-ui/ui#8489 (https://github.com/shadcn-ui/ui/issues/8489) — "Fast refresh only works when a file only exports components"
Plugin author's guidance (ArnaudBarre, eslint-plugin-react-refresh#84 (https://github.com/ArnaudBarre/eslint-plugin-react-refresh/issues/84)):
> "The warning is here mostly so that it guides people towards a file structure that will lead to quick HMR most of the time, but it doesn't hurt to have a few files you don't update often and don't respect it."
Community solution: Ignore src/components/ui/** in eslint config. The shadcn components are library code that users rarely edit — HMR slowness on those files is irrelevant.
Problem B: react-hooks/set-state-in-effect — 2 false-positive errors
Origin: eslint-plugin-react-hooks v7 recommended preset now includes ALL compiler rules (breaking change from v5). CHANGELOG v7.0.0 (https://github.com/facebook/react/blob/main/packages/eslint-plugin-react-hooks/CHANGELOG.md):
> "This release slims down presets to just 2 configurations (recommended and recommended-latest), and all compiler rules are enabled by default."
Known shadcn bug (OPEN, with a fix PR also OPEN):
- shadcn-ui/ui#8739 (https://github.com/shadcn-ui/ui/issues/8739) — "setIsMobile is called synchronously in useIsMobile and breaks new react-hooks/set-state-in-effect eslint rule"
- shadcn-ui/ui#10433 (https://github.com/shadcn-ui/ui/pull/10433) — Open PR to fix useMobile by initializing state lazily instead of calling setState in useEffect
Affected files: src/hooks/use-mobile.ts and src/components/ui/carousel.tsx — both shadcn-generated.
Solution: Ignore src/hooks/use-mobile.ts in eslint config. src/components/ui/carousel.tsx is already covered by the src/components/ui/** ignore from Problem A.
Verified solution
Patching shadcn's eslint.config.js to add globalIgnores(['dist', 'src/components/ui/**', 'src/hooks/use-mobile.ts']):
- ✅ bunx eslint . → 0 errors, exit 0
- ✅ Still catches real errors in user files (App.tsx, Generated.tsx)
- ✅ Uses only globalIgnores — no rule overrides, no disabling, no eslint-disable comments
