use std::io::Write;
use tauri::AppHandle;
use crate::{AppError, resolve_path};

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportProjectOptions {
    pub include_apis: bool,
    pub include_theme: bool,
    pub include_components: bool,
    pub include_tests: bool,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportComponentOptions {
    pub include_types: bool,
    pub include_storybook: bool,
    pub include_tests: bool,
}

fn zip_err(e: zip::result::ZipError) -> AppError {
    AppError::Io(std::io::Error::other(e.to_string()))
}

fn add_dir_to_zip<W: Write + std::io::Seek>(
    zip: &mut zip::ZipWriter<W>,
    dir: &std::path::Path,
    prefix: &std::path::Path,
) -> Result<(), AppError> {
    for entry in std::fs::read_dir(dir).map_err(AppError::Io)? {
        let entry = entry.map_err(AppError::Io)?;
        let path = entry.path();
        let name = path.strip_prefix(prefix).map_err(|_| AppError::NotFound("Prefix mismatch".into()))?;
        if path.is_file() {
            let mut file = std::fs::File::open(&path).map_err(AppError::Io)?;
            zip.start_file_from_path(name, zip::write::SimpleFileOptions::default()).map_err(zip_err)?;
            std::io::copy(&mut file, zip).map_err(AppError::Io)?;
        } else if path.is_dir() {
            zip.add_directory_from_path(name, zip::write::SimpleFileOptions::default()).map_err(zip_err)?;
            add_dir_to_zip(zip, &path, prefix)?;
        }
    }
    Ok(())
}

fn add_file_to_zip<W: Write + std::io::Seek>(
    zip: &mut zip::ZipWriter<W>,
    source_path: &std::path::Path,
    zip_path: &str,
) -> Result<(), AppError> {
    if !source_path.exists() { return Ok(()); }
    let mut file = std::fs::File::open(source_path).map_err(AppError::Io)?;
    zip.start_file(zip_path, zip::write::SimpleFileOptions::default()).map_err(zip_err)?;
    std::io::copy(&mut file, zip).map_err(AppError::Io)?;
    Ok(())
}

fn add_dir_to_zip_with_prefix<W: Write + std::io::Seek>(
    zip: &mut zip::ZipWriter<W>,
    dir: &std::path::Path,
    zip_prefix: &str,
) -> Result<(), AppError> {
    if !dir.exists() { return Ok(()); }
    for entry in std::fs::read_dir(dir).map_err(AppError::Io)? {
        let entry = entry.map_err(AppError::Io)?;
        let path = entry.path();
        let file_name = path.file_name().unwrap_or_default().to_string_lossy();
        let zip_entry = format!("{}/{}", zip_prefix, file_name);
        if path.is_file() {
            let mut file = std::fs::File::open(&path).map_err(AppError::Io)?;
            zip.start_file(&zip_entry, zip::write::SimpleFileOptions::default()).map_err(zip_err)?;
            std::io::copy(&mut file, zip).map_err(AppError::Io)?;
        } else if path.is_dir() {
            zip.add_directory(&zip_entry, zip::write::SimpleFileOptions::default()).map_err(zip_err)?;
            add_dir_to_zip_with_prefix(zip, &path, &zip_entry)?;
        }
    }
    Ok(())
}

fn scan_shadcn_imports(source: &str) -> Vec<String> {
    let prefix = "@/components/ui/";
    let mut names = Vec::new();
    for line in source.lines() {
        let trimmed = line.trim();
        if let Some(idx) = trimmed.find(prefix) {
            let after = &trimmed[idx + prefix.len()..];
            let component_path = after
                .find('\'').or_else(|| after.find('"')).or_else(|| after.find(';'))
                .map(|end| &after[..end])
                .unwrap_or(after);
            let base_name = component_path.split('/').next().unwrap_or(component_path);
            if !base_name.is_empty() && !names.iter().any(|n| n == base_name) {
                names.push(base_name.to_string());
            }
        }
    }
    names
}

fn shadcn_globals_css() -> &'static str {
    r#"@import "tailwindcss";

@custom-variant dark (&:where(.dark, .dark *));

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-chart-1: var(--chart-1);
  --color-chart-2: var(--chart-2);
  --color-chart-3: var(--chart-3);
  --color-chart-4: var(--chart-4);
  --color-chart-5: var(--chart-5);
  --color-sidebar: var(--sidebar);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar-primary: var(--sidebar-primary);
  --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
  --color-sidebar-accent: var(--sidebar-accent);
  --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
  --color-sidebar-border: var(--sidebar-border);
  --color-sidebar-ring: var(--sidebar-ring);
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
  --font-sans: 'Inter', sans-serif;
  --font-mono: var(--font-geist-mono, monospace);
}

@layer base {
  :root {
    --background: oklch(1 0 0);
    --foreground: oklch(0.145 0 0);
    --card: oklch(1 0 0);
    --card-foreground: oklch(0.145 0 0);
    --popover: oklch(1 0 0);
    --popover-foreground: oklch(0.145 0 0);
    --primary: oklch(0.205 0 0);
    --primary-foreground: oklch(0.985 0 0);
    --secondary: oklch(0.97 0 0);
    --secondary-foreground: oklch(0.205 0 0);
    --muted: oklch(0.97 0 0);
    --muted-foreground: oklch(0.556 0 0);
    --accent: oklch(0.97 0 0);
    --accent-foreground: oklch(0.205 0 0);
    --destructive: oklch(0.577 0.245 27.325);
    --border: oklch(0.922 0 0);
    --input: oklch(0.922 0 0);
    --ring: oklch(0.708 0 0);
    --radius: 0.625rem;
    --chart-1: oklch(0.646 0.222 41.116);
    --chart-2: oklch(0.6 0.118 184.704);
    --chart-3: oklch(0.398 0.07 227.392);
    --chart-4: oklch(0.828 0.189 84.429);
    --chart-5: oklch(0.769 0.188 70.08);
    --sidebar: oklch(0.985 0 0);
    --sidebar-foreground: oklch(0.145 0 0);
    --sidebar-primary: oklch(0.205 0 0);
    --sidebar-primary-foreground: oklch(0.985 0 0);
    --sidebar-accent: oklch(0.97 0 0);
    --sidebar-accent-foreground: oklch(0.205 0 0);
    --sidebar-border: oklch(0.922 0 0);
    --sidebar-ring: oklch(0.708 0 0);
  }

  .dark {
    --background: oklch(0.145 0 0);
    --foreground: oklch(0.985 0 0);
    --card: oklch(0.145 0 0);
    --card-foreground: oklch(0.985 0 0);
    --popover: oklch(0.145 0 0);
    --popover-foreground: oklch(0.985 0 0);
    --primary: oklch(0.985 0 0);
    --primary-foreground: oklch(0.205 0 0);
    --secondary: oklch(0.269 0 0);
    --secondary-foreground: oklch(0.985 0 0);
    --muted: oklch(0.269 0 0);
    --muted-foreground: oklch(0.708 0 0);
    --accent: oklch(0.269 0 0);
    --accent-foreground: oklch(0.985 0 0);
    --destructive: oklch(0.396 0.141 25.723);
    --border: oklch(0.269 0 0);
    --input: oklch(0.269 0 0);
    --ring: oklch(0.439 0 0);
    --chart-1: oklch(0.488 0.243 264.376);
    --chart-2: oklch(0.696 0.17 162.48);
    --chart-3: oklch(0.769 0.188 70.08);
    --chart-4: oklch(0.627 0.265 303.9);
    --chart-5: oklch(0.645 0.246 16.439);
    --sidebar: oklch(0.205 0 0);
    --sidebar-foreground: oklch(0.985 0 0);
    --sidebar-primary: oklch(0.488 0.243 264.376);
    --sidebar-primary-foreground: oklch(0.985 0 0);
    --sidebar-accent: oklch(0.269 0 0);
    --sidebar-accent-foreground: oklch(0.985 0 0);
    --sidebar-border: oklch(0.269 0 0);
    --sidebar-ring: oklch(0.439 0 0);
  }
}

@layer base {
  * {
    @apply border-border;
  }
  body {
    @apply bg-background text-foreground;
  }
}
"#
}

#[tauri::command]
pub async fn export_project(
    project_id: String,
    output_path: String,
    format: String,
    options: ExportProjectOptions,
    app: AppHandle,
) -> Result<String, AppError> {
    let project_dir = resolve_path(&app, &format!("projects/{}", project_id))?;
    // output_path comes from native save dialog — validate it doesn't contain traversal
    if output_path.contains("..") {
        return Err(AppError::Security("Invalid output path".into()));
    }

    let result = tokio::task::spawn_blocking(move || -> Result<String, AppError> {
        let file = std::fs::File::create(&output_path).map_err(AppError::Io)?;
        let mut zip = zip::ZipWriter::new(file);

        if format == "react-vite" || format.is_empty() {
            let pkg = r#"{"name":"exported-app","private":true,"version":"0.0.0","type":"module","scripts":{"dev":"vite","build":"vite build","preview":"vite preview"},"dependencies":{"react":"^19","react-dom":"^19","class-variance-authority":"^0.7","clsx":"^2.1","tailwind-merge":"^3.0","radix-ui":"^1.4","lucide-react":"^0.511"},"devDependencies":{"@tailwindcss/vite":"^4","@types/react":"^19","@types/react-dom":"^19","@vitejs/plugin-react":"^4","typescript":"^5","vite":"^6"}}"#;
            zip.start_file("package.json", zip::write::SimpleFileOptions::default()).map_err(zip_err)?;
            zip.write_all(pkg.as_bytes()).map_err(AppError::Io)?;

            let tsconfig = r#"{"compilerOptions":{"target":"ES2020","useDefineForClassFields":true,"lib":["ES2020","DOM","DOM.Iterable"],"module":"ESNext","skipLibCheck":true,"moduleResolution":"bundler","allowImportingTsExtensions":true,"resolveJsonModule":true,"isolatedModules":true,"noEmit":true,"jsx":"react-jsx","strict":true,"noUnusedLocals":true,"noUnusedParameters":true,"noFallthroughCasesInSwitch":true,"baseUrl":".","paths":{"@/*":["./src/*"]}},"include":["src"],"references":[{"path":"./tsconfig.node.json"}]}"#;
            zip.start_file("tsconfig.json", zip::write::SimpleFileOptions::default()).map_err(zip_err)?;
            zip.write_all(tsconfig.as_bytes()).map_err(AppError::Io)?;

            let vite_config = r#"import { defineConfig } from 'vite'; import react from '@vitejs/plugin-react'; import tailwindcss from '@tailwindcss/vite'; import path from 'path'; export default defineConfig({ plugins: [react(), tailwindcss()], resolve: { alias: { '@': path.resolve(__dirname, './src') } } });"#;
            zip.start_file("vite.config.ts", zip::write::SimpleFileOptions::default()).map_err(zip_err)?;
            zip.write_all(vite_config.as_bytes()).map_err(AppError::Io)?;

            let main = r#"import React from 'react'; import ReactDOM from 'react-dom/client'; import App from './App'; import './styles/globals.css'; ReactDOM.createRoot(document.getElementById('root')!).render(<App />);"#;
            zip.start_file("src/main.tsx", zip::write::SimpleFileOptions::default()).map_err(zip_err)?;
            zip.write_all(main.as_bytes()).map_err(AppError::Io)?;

            let html = r#"<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>Exported App</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>"#;
            zip.start_file("index.html", zip::write::SimpleFileOptions::default()).map_err(zip_err)?;
            zip.write_all(html.as_bytes()).map_err(AppError::Io)?;

            // shadcn utility — prefer component-preview's file, fall back to default
            let default_utils = r#"import { clsx, type ClassValue } from "clsx"; import { twMerge } from "tailwind-merge"; export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }"#;
            let utils_path = project_dir.join("component-preview").join("src").join("lib").join("utils.ts");
            let utils_source = if utils_path.exists() {
                std::fs::read_to_string(&utils_path).unwrap_or_else(|_| default_utils.to_string())
            } else {
                default_utils.to_string()
            };
            zip.start_file("src/lib/utils.ts", zip::write::SimpleFileOptions::default()).map_err(zip_err)?;
            zip.write_all(utils_source.as_bytes()).map_err(AppError::Io)?;

            zip.start_file("src/styles/globals.css", zip::write::SimpleFileOptions::default()).map_err(zip_err)?;
            zip.write_all(shadcn_globals_css().as_bytes()).map_err(AppError::Io)?;
        }

        if options.include_components {
            let comp_dir = project_dir.join("components");
            if comp_dir.exists() { add_dir_to_zip(&mut zip, &comp_dir, &project_dir)?; }
        }
        if options.include_theme {
            let theme_dir = project_dir.join("themes");
            if theme_dir.exists() { add_dir_to_zip(&mut zip, &theme_dir, &project_dir)?; }
        }
        if options.include_apis {
            let api_dir = project_dir.join("apis");
            if api_dir.exists() { add_dir_to_zip(&mut zip, &api_dir, &project_dir)?; }
        }

        let component_preview_dir = project_dir.join("component-preview");
        if component_preview_dir.exists() && (format == "react-vite" || format.is_empty()) {
            let ui_dir = component_preview_dir.join("src").join("components").join("ui");
            if ui_dir.exists() { add_dir_to_zip_with_prefix(&mut zip, &ui_dir, "src/components/ui")?; }
        }

        let screens_dir = project_dir.join("screens");
        if screens_dir.exists() { add_dir_to_zip(&mut zip, &screens_dir, &project_dir)?; }

        let gen_dir = project_dir.join("generated");
        if gen_dir.exists() { add_dir_to_zip(&mut zip, &gen_dir, &project_dir)?; }

        if options.include_tests {
            zip.start_file("src/App.test.tsx", zip::write::SimpleFileOptions::default()).map_err(zip_err)?;
            zip.write_all(b"import { describe, it, expect } from 'vitest';").map_err(AppError::Io)?;
            let vitest_config = r#"import { defineConfig } from 'vitest/config'; import react from '@vitejs/plugin-react'; export default defineConfig({ plugins: [react()], test: { environment: 'jsdom', globals: true } });"#;
            zip.start_file("vitest.config.ts", zip::write::SimpleFileOptions::default()).map_err(zip_err)?;
            zip.write_all(vitest_config.as_bytes()).map_err(AppError::Io)?;
        }

        zip.finish().map_err(zip_err)?;
        Ok(output_path)
    }).await.map_err(|e| AppError::Process(e.to_string()))?;

    result
}

#[tauri::command]
pub async fn export_component(
    project_id: String,
    component_id: String,
    output_path: String,
    format: String,
    options: ExportComponentOptions,
    app: AppHandle,
) -> Result<String, AppError> {
    if output_path.contains("..") {
        return Err(AppError::Security("Invalid output path".into()));
    }
    let component_path = resolve_path(&app, &format!("projects/{}/components/{}/component.tsx", project_id, component_id))?;
    let project_dir = resolve_path(&app, &format!("projects/{}", project_id))?;
    let component_preview_dir = project_dir.join("component-preview");

    let result = tokio::task::spawn_blocking(move || -> Result<String, AppError> {
        let file = std::fs::File::create(&output_path).map_err(AppError::Io)?;
        let mut zip = zip::ZipWriter::new(file);

        let mut component_source = String::new();
        let ext = if format == "jsx" { "jsx" } else { "tsx" };

        if component_path.exists() {
            let mut f = std::fs::File::open(&component_path).map_err(AppError::Io)?;
            std::io::Read::read_to_string(&mut f, &mut component_source).map_err(AppError::Io)?;
            let mut f = std::fs::File::open(&component_path).map_err(AppError::Io)?;
            zip.start_file(format!("{}.{}", component_id, ext), zip::write::SimpleFileOptions::default()).map_err(zip_err)?;
            std::io::copy(&mut f, &mut zip).map_err(AppError::Io)?;
        }

        let shadcn_components = scan_shadcn_imports(&component_source);
        if !shadcn_components.is_empty() {
            let ui_dir = component_preview_dir.join("src").join("components").join("ui");
            for comp_name in &shadcn_components {
                add_file_to_zip(&mut zip, &ui_dir.join(format!("{}.tsx", comp_name)), &format!("components/ui/{}.tsx", comp_name))?;
            }

            let utils_file = component_preview_dir.join("src").join("lib").join("utils.ts");
            let default_utils = r#"import { clsx, type ClassValue } from "clsx"; import { twMerge } from "tailwind-merge"; export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }"#;
            if utils_file.exists() {
                add_file_to_zip(&mut zip, &utils_file, "lib/utils.ts")?;
            } else {
                zip.start_file("lib/utils.ts", zip::write::SimpleFileOptions::default()).map_err(zip_err)?;
                zip.write_all(default_utils.as_bytes()).map_err(AppError::Io)?;
            }

            zip.start_file("styles/globals.css", zip::write::SimpleFileOptions::default()).map_err(zip_err)?;
            zip.write_all(shadcn_globals_css().as_bytes()).map_err(AppError::Io)?;

            let pkg = serde_json::json!({
                "name": "exported-component", "private": true, "version": "0.0.0", "type": "module",
                "dependencies": { "react": "^19", "react-dom": "^19", "class-variance-authority": "^0.7", "clsx": "^2.1", "tailwind-merge": "^3.0", "radix-ui": "^1.4", "lucide-react": "^0.511" },
                "devDependencies": { "@types/react": "^19", "@types/react-dom": "^19", "typescript": "^5" }
            });
            zip.start_file("package.json", zip::write::SimpleFileOptions::default()).map_err(zip_err)?;
            zip.write_all(serde_json::to_string_pretty(&pkg).unwrap_or_default().as_bytes()).map_err(AppError::Io)?;

            let tsconfig = r#"{"compilerOptions":{"target":"ES2020","useDefineForClassFields":true,"lib":["ES2020","DOM","DOM.Iterable"],"module":"ESNext","skipLibCheck":true,"moduleResolution":"bundler","allowImportingTsExtensions":true,"resolveJsonModule":true,"isolatedModules":true,"noEmit":true,"jsx":"react-jsx","strict":true,"noUnusedLocals":true,"noUnusedParameters":true,"noFallthroughCasesInSwitch":true,"baseUrl":".","paths":{"@/*":["./*"]}},"include":["*"]}"#;
            zip.start_file("tsconfig.json", zip::write::SimpleFileOptions::default()).map_err(zip_err)?;
            zip.write_all(tsconfig.as_bytes()).map_err(AppError::Io)?;
        }

        if options.include_types {
            zip.start_file(format!("{}.types.ts", component_id), zip::write::SimpleFileOptions::default()).map_err(zip_err)?;
            zip.write_all(format!("export interface {}Props {{}}\n", component_id).as_bytes()).map_err(AppError::Io)?;
        }
        if options.include_storybook {
            let story = format!(r#"import type {{ Meta, StoryObj }} from '@storybook/react'; import {{ {} }} from './{}'; const meta: Meta<typeof {}> = {{ component: {} }}; export default meta; type Story = StoryObj<typeof {}>; export const Default: Story = {{ args: {{}} }};"#, component_id, component_id, component_id, component_id, component_id);
            zip.start_file(format!("{}.stories.tsx", component_id), zip::write::SimpleFileOptions::default()).map_err(zip_err)?;
            zip.write_all(story.as_bytes()).map_err(AppError::Io)?;
        }
        if options.include_tests {
            let test = format!(r#"import {{ render, screen }} from '@testing-library/react'; import {{ {} }} from './{}'; describe('{}', () => {{ it('renders', () => {{ render(<{} />); expect(screen.getByText(/.*/)).toBeInTheDocument(); }}); }});"#, component_id, component_id, component_id, component_id);
            zip.start_file(format!("{}.test.tsx", component_id), zip::write::SimpleFileOptions::default()).map_err(zip_err)?;
            zip.write_all(test.as_bytes()).map_err(AppError::Io)?;
        }

        zip.finish().map_err(zip_err)?;
        Ok(output_path)
    }).await.map_err(|e| AppError::Process(e.to_string()))?;

    result
}
