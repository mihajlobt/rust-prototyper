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

fn add_dir_to_zip_filtered<W: Write + std::io::Seek>(
    zip: &mut zip::ZipWriter<W>,
    dir: &std::path::Path,
    base: &std::path::Path,
    exclude: &[&str],
) -> Result<(), AppError> {
    for entry in std::fs::read_dir(dir).map_err(AppError::Io)? {
        let entry = entry.map_err(AppError::Io)?;
        let path = entry.path();
        let file_name = path.file_name().unwrap_or_default().to_string_lossy();
        if exclude.iter().any(|e| *e == file_name.as_ref()) { continue; }
        let zip_name = path.strip_prefix(base).map_err(|_| AppError::NotFound("Prefix mismatch".into()))?;
        if path.is_file() {
            let mut file = std::fs::File::open(&path).map_err(AppError::Io)?;
            zip.start_file_from_path(zip_name, zip::write::SimpleFileOptions::default()).map_err(zip_err)?;
            std::io::copy(&mut file, zip).map_err(AppError::Io)?;
        } else if path.is_dir() {
            zip.add_directory_from_path(zip_name, zip::write::SimpleFileOptions::default()).map_err(zip_err)?;
            add_dir_to_zip_filtered(zip, &path, base, exclude)?;
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
    _format: String,
    _options: ExportProjectOptions,
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

        // Export is always from generated/ — the fully scaffolded runnable project.
        // If generated/ hasn't been scaffolded yet, tell the user to scaffold in Runner first.
        let gen_dir = project_dir.join("generated");
        if !gen_dir.exists() || !gen_dir.join("package.json").exists() {
            return Err(AppError::NotFound(
                "generated/ project not found. Open the Runner panel and scaffold the project first.".into()
            ));
        }

        let exclude = ["node_modules", ".env.local", ".env"];
        add_dir_to_zip_filtered(&mut zip, &gen_dir, &gen_dir, &exclude)?;

        // .env.example — strip values from .env.local so the zip is safe to share
        let env_local = gen_dir.join(".env.local");
        if env_local.exists() {
            if let Ok(content) = std::fs::read_to_string(&env_local) {
                let example: String = content.lines().map(|line| {
                    if !line.starts_with('#') && line.contains('=') {
                        let key = line.split('=').next().unwrap_or(line);
                        format!("{}=\n", key)
                    } else {
                        format!("{}\n", line)
                    }
                }).collect();
                zip.start_file(".env.example", zip::write::SimpleFileOptions::default()).map_err(zip_err)?;
                zip.write_all(example.as_bytes()).map_err(AppError::Io)?;
            }
        }

        // README.md
        let readme = concat!(
            "# Exported App\n\n",
            "## Setup\n\n",
            "1. Install dependencies:\n",
            "   ```bash\n   bun install\n   ```\n\n",
            "2. Configure environment variables:\n",
            "   ```bash\n   cp .env.example .env.local\n",
            "   # Edit .env.local and fill in your API keys\n   ```\n\n",
            "3. Start development server:\n",
            "   ```bash\n   bun dev\n   ```\n\n",
            "> API calls are proxied via Vite — see `vite.config.ts` for proxy configuration.\n",
        );
        zip.start_file("README.md", zip::write::SimpleFileOptions::default()).map_err(zip_err)?;
        zip.write_all(readme.as_bytes()).map_err(AppError::Io)?;

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
