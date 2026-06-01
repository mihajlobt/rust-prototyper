import { useState } from "react";
import { Bold, Italic, AlignLeft, AlignCenter, AlignRight, User } from "lucide-react";

import { Avatar, AvatarImage, AvatarFallback, AvatarGroup, AvatarGroupCount } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuLabel } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Toggle } from "@/components/ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[9px] font-semibold uppercase tracking-[0.06em] text-muted-foreground px-4 pt-4 pb-2">
        {label}
      </div>
      <div className="px-4 pb-3">{children}</div>
    </div>
  );
}

export function ComponentGallery() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [collapsibleOpen, setCollapsibleOpen] = useState(false);
  const [checked, setChecked] = useState(false);
  const [switchOn, setSwitchOn] = useState(false);
  const [sliderValue, setSliderValue] = useState([40]);
  const [toggleActive, setToggleActive] = useState(false);
  const [toggleGroup, setToggleGroup] = useState("center");

  return (
    <TooltipProvider>
      <div className="pb-6">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground px-4 pt-3 pb-1">
          Components
        </h3>
        <Separator className="opacity-40" />

        <Section label="Button">
          <div className="flex flex-wrap gap-2">
            <Button size="sm">Default</Button>
            <Button size="sm" variant="secondary">Secondary</Button>
            <Button size="sm" variant="outline">Outline</Button>
            <Button size="sm" variant="ghost">Ghost</Button>
            <Button size="sm" variant="destructive">Destructive</Button>
            <Button size="sm" variant="link">Link</Button>
          </div>
          <div className="flex gap-2 mt-2">
            <Button size="sm" disabled>Disabled</Button>
            <Button size="sm" variant="outline" disabled>Disabled outline</Button>
          </div>
        </Section>

        <Separator className="opacity-40" />

        <Section label="Badge">
          <div className="flex flex-wrap gap-2">
            <Badge>Default</Badge>
            <Badge variant="secondary">Secondary</Badge>
            <Badge variant="outline">Outline</Badge>
            <Badge variant="destructive">Destructive</Badge>
          </div>
        </Section>

        <Separator className="opacity-40" />

        <Section label="Avatar">
          <div className="flex items-center gap-3">
            <Avatar>
              <AvatarImage src="" alt="User" />
              <AvatarFallback>AB</AvatarFallback>
            </Avatar>
            <Avatar>
              <AvatarFallback><User size={14} /></AvatarFallback>
            </Avatar>
            <AvatarGroup>
              <Avatar><AvatarFallback>AA</AvatarFallback></Avatar>
              <Avatar><AvatarFallback>BB</AvatarFallback></Avatar>
              <Avatar><AvatarFallback>CC</AvatarFallback></Avatar>
              <AvatarGroupCount>+5</AvatarGroupCount>
            </AvatarGroup>
          </div>
        </Section>

        <Separator className="opacity-40" />

        <Section label="Input">
          <div className="space-y-2 max-w-xs">
            <div className="space-y-1">
              <Label className="text-xs">Label</Label>
              <Input placeholder="Placeholder text" className="h-8 text-sm" />
            </div>
            <Input placeholder="Disabled" className="h-8 text-sm" disabled />
          </div>
        </Section>

        <Separator className="opacity-40" />

        <Section label="Textarea">
          <Textarea placeholder="Enter text here…" className="text-sm max-w-xs h-20 resize-none" />
        </Section>

        <Separator className="opacity-40" />

        <Section label="Select">
          <Select>
            <SelectTrigger className="h-8 text-sm w-48">
              <SelectValue placeholder="Choose an option" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="a">Option A</SelectItem>
              <SelectItem value="b">Option B</SelectItem>
              <SelectItem value="c">Option C</SelectItem>
            </SelectContent>
          </Select>
        </Section>

        <Separator className="opacity-40" />

        <Section label="Checkbox">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Checkbox id="cb-demo" checked={checked} onCheckedChange={(v) => setChecked(!!v)} />
              <Label htmlFor="cb-demo" className="text-sm cursor-pointer">{checked ? "Checked" : "Unchecked"}</Label>
            </div>
            <div className="flex items-center gap-2 opacity-50">
              <Checkbox id="cb-disabled" disabled defaultChecked />
              <Label htmlFor="cb-disabled" className="text-sm">Disabled checked</Label>
            </div>
          </div>
        </Section>

        <Separator className="opacity-40" />

        <Section label="Toggle Switch">
          <div className="flex items-center gap-3">
            <ToggleSwitch checked={switchOn} onCheckedChange={setSwitchOn} />
            <span className="text-sm text-muted-foreground">{switchOn ? "On" : "Off"}</span>
            <ToggleSwitch checked disabled onCheckedChange={() => {}} />
            <span className="text-xs text-muted-foreground/50">Disabled</span>
          </div>
        </Section>

        <Separator className="opacity-40" />

        <Section label="Toggle">
          <div className="flex gap-2">
            <Toggle pressed={toggleActive} onPressedChange={setToggleActive} size="sm">
              <Bold size={13} />
            </Toggle>
            <Toggle size="sm" disabled>
              <Italic size={13} />
            </Toggle>
          </div>
        </Section>

        <Separator className="opacity-40" />

        <Section label="Toggle Group">
          <ToggleGroup type="single" value={toggleGroup} onValueChange={(v) => v && setToggleGroup(v)} size="sm">
            <ToggleGroupItem value="left"><AlignLeft size={13} /></ToggleGroupItem>
            <ToggleGroupItem value="center"><AlignCenter size={13} /></ToggleGroupItem>
            <ToggleGroupItem value="right"><AlignRight size={13} /></ToggleGroupItem>
          </ToggleGroup>
        </Section>

        <Separator className="opacity-40" />

        <Section label="Slider">
          <div className="max-w-xs space-y-2">
            <Slider value={sliderValue} onValueChange={setSliderValue} min={0} max={100} step={1} />
            <span className="text-xs text-muted-foreground">{sliderValue[0]}%</span>
          </div>
        </Section>

        <Separator className="opacity-40" />

        <Section label="Tabs">
          <Tabs defaultValue="tab1">
            <TabsList>
              <TabsTrigger value="tab1">Overview</TabsTrigger>
              <TabsTrigger value="tab2">Settings</TabsTrigger>
              <TabsTrigger value="tab3" disabled>Disabled</TabsTrigger>
            </TabsList>
            <TabsContent value="tab1" className="text-sm text-muted-foreground pt-2">Tab one content.</TabsContent>
            <TabsContent value="tab2" className="text-sm text-muted-foreground pt-2">Tab two content.</TabsContent>
          </Tabs>
        </Section>

        <Separator className="opacity-40" />

        <Section label="Collapsible">
          <Collapsible open={collapsibleOpen} onOpenChange={setCollapsibleOpen} className="max-w-xs">
            <CollapsibleTrigger asChild>
              <Button variant="outline" size="sm">{collapsibleOpen ? "Collapse" : "Expand"}</Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-2">
              <div className="rounded border border-border p-3 text-sm text-muted-foreground">
                Collapsible content revealed when expanded.
              </div>
            </CollapsibleContent>
          </Collapsible>
        </Section>

        <Separator className="opacity-40" />

        <Section label="Dialog">
          <Button size="sm" variant="outline" onClick={() => setDialogOpen(true)}>Open dialog</Button>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Dialog title</DialogTitle>
                <DialogDescription>This dialog uses your theme tokens for background, border, and text colors.</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" size="sm" onClick={() => setDialogOpen(false)}>Cancel</Button>
                <Button size="sm" onClick={() => setDialogOpen(false)}>Confirm</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </Section>

        <Separator className="opacity-40" />

        <Section label="Dropdown Menu">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline">Open menu</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel className="text-xs">Actions</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem>Profile</DropdownMenuItem>
                <DropdownMenuItem>Settings</DropdownMenuItem>
                <DropdownMenuItem disabled>Disabled item</DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive">Delete</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </Section>

        <Separator className="opacity-40" />

        <Section label="Popover">
          <Popover>
            <PopoverTrigger asChild>
              <Button size="sm" variant="outline">Open popover</Button>
            </PopoverTrigger>
            <PopoverContent className="text-sm w-56">
              <p className="text-sm font-medium">Popover title</p>
              <p className="text-xs text-muted-foreground mt-1">Popover content using theme card colors and border tokens.</p>
            </PopoverContent>
          </Popover>
        </Section>

        <Separator className="opacity-40" />

        <Section label="Tooltip">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="sm" variant="outline">Hover for tooltip</Button>
            </TooltipTrigger>
            <TooltipContent>Tooltip content</TooltipContent>
          </Tooltip>
        </Section>

        <Separator className="opacity-40" />

        <Section label="Scroll Area">
          <ScrollArea className="h-24 w-48 rounded border border-border">
            <div className="p-3 space-y-1">
              {Array.from({ length: 12 }, (_, i) => (
                <div key={i} className="text-xs text-muted-foreground">List item {i + 1}</div>
              ))}
            </div>
          </ScrollArea>
        </Section>

        <Separator className="opacity-40" />

        <Section label="Separator">
          <div className="space-y-2 max-w-xs">
            <Separator />
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Left</span>
              <Separator orientation="vertical" className="h-4" />
              <span className="text-xs text-muted-foreground">Right</span>
            </div>
          </div>
        </Section>

        <Separator className="opacity-40" />

        <Section label="Card">
          <div className="rounded-[--radius] border border-border bg-card p-4 max-w-xs space-y-2">
            <p className="text-sm font-semibold text-card-foreground">Card title</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Card body using theme card and muted foreground tokens.
            </p>
            <Button size="sm" variant="outline" className="mt-1">Action</Button>
          </div>
        </Section>
      </div>
    </TooltipProvider>
  );
}
