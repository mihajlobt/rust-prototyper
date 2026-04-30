import { useEffect, useMemo, useRef } from "react";
import { cn } from "@/lib/utils";
import {
  asyncDataLoaderFeature,
  hotkeysCoreFeature,
} from "@headless-tree/core";
import { useTree } from "@headless-tree/react";
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useAppStore } from "@/stores/appStore";
import { useFlatProjectTree } from "@/hooks/useProjectFiles";
import {
  Folder, FolderOpen, FileCode, File, FileText, ChevronRight, ChevronDown, RefreshCw,
  Workflow, Globe, Palette, Layout, Box,
  Plus, Copy, Star, Pencil, Trash2, ExternalLink,
} from "lucide-react";

/** All sections in order */
export const SECTION_NAMES = ["screens", "components", "themes", "workflows", "apis"] as const;
export type SectionName = typeof SECTION_NAMES[number];

/** UI labels for each section */
export const SECTION_LABELS: Record<SectionName, string> = {
  screens: "Screens",
  components: "Components",
  themes: "Themes",
  workflows: "Workflows",
  apis: "APIs",
};

/** Section → asset type for drag-and-drop */
export const SECTION_ASSET_TYPE: Record<SectionName, string | null> = {
  screens: "screen",
  components: "component",
  themes: "theme",
  workflows: null,
  apis: null,
};

/** Section → "screen" | "component" | "theme" | "api" | "workflow" for New dialog */
export const SECTION_NEW_TYPE: Record<SectionName, string> = {
  screens: "screen",
  components: "component",
  themes: "theme",
  workflows: "workflow",
  apis: "api",
};

/**
 * Item data stored in headless-tree.
 * itemId = canonical identifier used in dataLoader.getItem/getChildren.
 */
interface TreeItemData {
  /** Display name */
  name: string;
  /** Project-relative path */
  path: string;
  /** Whether this item can have children (section folders only) */
  hasChildren: boolean;
  /** Section this item belongs to — null for the virtual root */
  section: SectionName | null;
  /** For drag-and-drop — null for workflows/apis which are files */
  assetType: string | null;
}

/** Section → icon component for asset leaves */
function AssetIcon({ section }: { section: SectionName }) {
  switch (section) {
    case "screens": return <Layout size={12} className="shrink-0 text-blue-400" />;
    case "components": return <Box size={12} className="shrink-0 text-purple-400" />;
    case "themes": return <Palette size={12} className="shrink-0 text-pink-400" />;
    case "workflows": return <Workflow size={12} className="shrink-0 text-green-400" />;
    case "apis": return <Globe size={12} className="shrink-0 text-yellow-400" />;
  }
}

/** File icon based on file extension — used only for files inside asset folders */
function FileIcon({ name }: { name: string }) {
  const ext = name.split(".").pop()?.toLowerCase();
  if (ext === "tsx") return <FileCode size={12} className="shrink-0 text-blue-400" />;
  if (ext === "css") return <File size={12} className="shrink-0 text-pink-400" />;
  if (ext === "json") return <FileText size={12} className="shrink-0 text-yellow-400" />;
  if (ext === "md") return <File size={12} className="shrink-0 text-green-400" />;
  return <File size={12} className="shrink-0 text-muted-foreground" />;
}

// AssetIcon and FileIcon are used in rendering

interface ProjectExplorerProps {
  onSelectAsset: (section: SectionName, name: string) => void;
  onRename: (section: SectionName, name: string) => void;
  onDelete: (section: SectionName, name: string) => void;
  onDuplicate: (section: SectionName, name: string) => void;
  onSetDefaultTheme: (name: string) => void;
  onNewItem: (type: string) => void;
  onRefresh: () => void;
}

/** Query data array entry type from readDir */
type TreeEntry = { name: string; path: string; is_dir: boolean };

/** Shared button style for all tree items (folders and leaves).
 *  Accepts className so Radix asChild / headless-tree getProps() merges correctly. */
function TreeItemButton({ style, className, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cn(
        "w-full flex items-center gap-1.5 px-2 py-0.5 text-xs text-left rounded transition-colors",
        "text-muted-foreground hover:text-foreground hover:bg-muted",
        className
      )}
      style={style}
      {...props}
    >
      {children}
    </button>
  );
}

export function ProjectExplorer({ onSelectAsset, onRename, onDelete, onDuplicate, onSetDefaultTheme, onNewItem, onRefresh }: ProjectExplorerProps) {
  const settings = useAppStore((s) => s.settings);
  const project = settings.project;

  const screensTree = useFlatProjectTree(project, "screens");
  const componentsTree = useFlatProjectTree(project, "components");
  const themesTree = useFlatProjectTree(project, "themes");
  const workflowsTree = useFlatProjectTree(project, "workflows");
  const apisTree = useFlatProjectTree(project, "apis");

  // Map section name → query result for DRY access
  const sectionQueries: Record<SectionName, ReturnType<typeof useFlatProjectTree>> = useMemo(() => ({
    screens: screensTree,
    components: componentsTree,
    themes: themesTree,
    workflows: workflowsTree,
    apis: apisTree,
  }), [screensTree, componentsTree, themesTree, workflowsTree, apisTree]);

  // Build flat lookup: itemId → TreeItemData
  const dataLookup = useMemo((): Record<string, TreeItemData> => {
    const lookup: Record<string, TreeItemData> = {};

    for (const sectionName of SECTION_NAMES) {
      const entries = (sectionQueries[sectionName].data || []) as TreeEntry[];

      // Section header — can have children (assets)
      lookup[sectionName] = {
        name: SECTION_LABELS[sectionName],
        path: `projects/${project}/${sectionName}`,
        hasChildren: true,
        section: sectionName,
        assetType: null,
      };

      // Each asset entry within the section
      for (const entry of entries) {
        // Asset items are leaves — no children, even for folders in FS
        lookup[entry.path] = {
          name: entry.is_dir ? entry.name : entry.name.replace(/\.json$/, ""),
          path: entry.path,
          hasChildren: false, // Assets are always leaves (files)
          section: sectionName,
          assetType: entry.is_dir ? SECTION_ASSET_TYPE[sectionName] : null,
        };
      }
    }

    return lookup;
  }, [project, sectionQueries]);

  // Keep refs always pointing to the latest data so async dataLoader callbacks
  // read fresh values even after headless-tree has cached old results.
  const dataLookupRef = useRef(dataLookup);
  dataLookupRef.current = dataLookup;

  const sectionQueriesRef = useRef(sectionQueries);
  sectionQueriesRef.current = sectionQueries;

  // Track which sections have been expanded programmatically
  const sectionsExpandedRef = useRef<Set<SectionName>>(new Set());

  const tree = useTree<TreeItemData>({
    rootItemId: "__root__",
    getItemName: (item) => item.getItemData()?.name ?? "",
    isItemFolder: (item) => item.getItemData()?.hasChildren ?? false,
    dataLoader: {
      getItem: async (itemId) => {
        if (itemId === "__root__") {
          return { name: "", path: "", hasChildren: true, section: null, assetType: null };
        }
        return dataLookupRef.current[itemId] ?? { name: itemId, path: itemId, hasChildren: false, section: null, assetType: null };
      },
      getChildren: async (itemId) => {
        if (itemId === "__root__") {
          return [...SECTION_NAMES];
        }
        if ((SECTION_NAMES as readonly string[]).includes(itemId)) {
          const entries = (sectionQueriesRef.current[itemId as SectionName]?.data ?? []) as TreeEntry[];
          return entries.map((e) => e.path);
        }
        return [];
      },
    },
    features: [asyncDataLoaderFeature, hotkeysCoreFeature],
  });

  // When TanStack Query refetches a section, tell headless-tree its cache is stale.
  // dataUpdatedAt changes on every successful fetch, making it a reliable dependency.
  useEffect(() => {
    for (const sectionName of SECTION_NAMES) {
      tree.getItemInstance(sectionName)?.invalidateChildrenIds();
    }
  }, [
    screensTree.dataUpdatedAt,
    componentsTree.dataUpdatedAt,
    themesTree.dataUpdatedAt,
    workflowsTree.dataUpdatedAt,
    apisTree.dataUpdatedAt,
    tree,
  ]);

  // Programmatically expand section headers when data first loads
  useEffect(() => {
    const loading = Object.values(sectionQueries).some((q) => q.isLoading);
    if (loading) return;

    for (const sectionName of SECTION_NAMES) {
      if (sectionsExpandedRef.current.has(sectionName)) continue;
      const entries = sectionQueries[sectionName].data;
      if (entries && entries.length > 0) {
        tree.getItemInstance(sectionName)?.expand();
        sectionsExpandedRef.current.add(sectionName);
      }
    }
  }, [sectionQueries, tree]);

  const isLoading = Object.values(sectionQueries).some((q) => q.isLoading);
  const hasData = Object.keys(dataLookup).length > 0;

  if (isLoading) {
    return <div className="text-xs text-muted-foreground px-2 py-2">Loading…</div>;
  }

  if (!hasData) {
    return <div className="text-xs text-muted-foreground px-2 py-2">No assets</div>;
  }

  return (
    <div {...tree.getContainerProps()} className="py-1">
      {tree.getItems().map((item) => {
        const itemData = item.getItemData();
        if (!itemData) return null;
        const meta = item.getItemMeta();
        const indent = meta.level === 0 ? 4 : 20 + (meta.level - 1) * 16;

        if (item.isFolder()) {
          // Section header folder
          const section = itemData.section;
          return (
            <div key={item.getId()}>
              <ContextMenu>
                <ContextMenuTrigger asChild>
                  <TreeItemButton style={{ paddingLeft: `${indent}px` }} {...item.getProps()}>
                    {item.isExpanded() ? <ChevronDown size={10} className="shrink-0" /> : <ChevronRight size={10} className="shrink-0" />}
                    {item.isExpanded() ? <FolderOpen size={12} className="shrink-0" /> : <Folder size={12} className="shrink-0" />}
                    <span className="font-medium">{itemData.name}</span>
                  </TreeItemButton>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  {section && (
                    <ContextMenuItem onClick={() => onNewItem(SECTION_NEW_TYPE[section])}>
                      <Plus size={12} className="mr-2" />New {SECTION_NEW_TYPE[section]}…
                    </ContextMenuItem>
                  )}
                  <ContextMenuItem onClick={onRefresh}>
                    <RefreshCw size={12} className="mr-2" />Refresh
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            </div>
          );
        }

        // Asset leaf — uses itemData.name which is already correct
        const assetType = itemData.assetType;
        const section = itemData.section;

        return (
          <div key={item.getId()}>
            <ContextMenu>
              <ContextMenuTrigger asChild>
                <TreeItemButton
                  style={{ paddingLeft: `${indent}px` }}
                  {...item.getProps()}
                  onDoubleClick={() => section && onSelectAsset(section, itemData.name)}
                  draggable={assetType !== null}
                  onDragStart={(e) => {
                    if (assetType) {
                      e.dataTransfer.setData(
                        "application/prototyper-asset",
                        JSON.stringify({ filePath: itemData.path, assetType, assetName: itemData.name })
                      );
                      e.dataTransfer.effectAllowed = "copy";
                    }
                  }}
                >
                  {section ? <AssetIcon section={section} /> : <FileIcon name={itemData.name} />}
                  <span className="truncate">{itemData.name}</span>
                </TreeItemButton>
              </ContextMenuTrigger>
              <ContextMenuContent>
                {section && (
                  <ContextMenuItem onClick={() => onSelectAsset(section, itemData.name)}>
                    <ExternalLink size={12} className="mr-2" />Open
                  </ContextMenuItem>
                )}
                {assetType !== null && (
                  <ContextMenuItem onClick={() => onDuplicate(section!, itemData.name)}>
                    <Copy size={12} className="mr-2" />Duplicate
                  </ContextMenuItem>
                )}
                {section === "themes" && (
                  <ContextMenuItem onClick={() => onSetDefaultTheme(itemData.name)}>
                    <Star size={12} className="mr-2" />Set as default theme
                  </ContextMenuItem>
                )}
                <ContextMenuSeparator />
                {section && (
                  <ContextMenuItem onClick={() => onRename(section, itemData.name)}>
                    <Pencil size={12} className="mr-2" />Rename…
                  </ContextMenuItem>
                )}
                {section && (
                  <ContextMenuItem className="text-destructive" onClick={() => onDelete(section, itemData.name)}>
                    <Trash2 size={12} className="mr-2" />Delete
                  </ContextMenuItem>
                )}
              </ContextMenuContent>
            </ContextMenu>
          </div>
        );
      })}
    </div>
  );
}
