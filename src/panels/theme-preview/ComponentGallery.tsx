import { useState } from "react";
import { Bold, Italic, AlignLeft, AlignCenter, AlignRight, User } from "lucide-react";

import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { AspectRatio } from "@/components/ui/aspect-ratio";
import { Avatar, AvatarFallback, AvatarGroup, AvatarGroupCount } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbLink, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Carousel, CarouselContent, CarouselItem, CarouselPrevious, CarouselNext } from "@/components/ui/carousel";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { Combobox, ComboboxTrigger, ComboboxValue, ComboboxContent, ComboboxList, ComboboxItem, ComboboxInput } from "@/components/ui/combobox";
import { CommandDialog, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem } from "@/components/ui/context-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuLabel } from "@/components/ui/dropdown-menu";
import { Empty, EmptyTitle, EmptyDescription } from "@/components/ui/empty";
import { Field, FieldLabel, FieldDescription, FieldGroup } from "@/components/ui/field";
import { HoverCard, HoverCardTrigger, HoverCardContent } from "@/components/ui/hover-card";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Label } from "@/components/ui/label";
import { Menubar, MenubarMenu, MenubarTrigger, MenubarContent, MenubarItem, MenubarSeparator, MenubarShortcut } from "@/components/ui/menubar";
import { NavigationMenu, NavigationMenuList, NavigationMenuItem, NavigationMenuLink } from "@/components/ui/navigation-menu";
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationPrevious, PaginationNext, PaginationEllipsis } from "@/components/ui/pagination";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Toggle } from "@/components/ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { BarChart, Bar, XAxis } from "recharts";

type CategoryProps = { label: string; children: React.ReactNode };

function CategorySection({ label, children }: CategoryProps) {
  return (
    <div className="mx-4 mb-4">
      <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground pb-1.5">
        {label}
      </div>
      <Separator className="mb-3 opacity-40" />
      <div className="grid grid-cols-2 gap-3">{children}</div>
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
  const [commandOpen, setCommandOpen] = useState(false);

  return (
    <TooltipProvider>
      <div className="pb-4">
        <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground px-4 pt-3 pb-3">
          Component Gallery
        </div>

        {/* ─── Actions ─────────────────────────────── */}
        <CategorySection label="Actions">
          <div className="flex flex-wrap items-center gap-2">
            <Button>Default</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="destructive">Destructive</Button>
            <Button variant="link">Link</Button>
            <Button disabled>Disabled</Button>
            <Button variant="outline" disabled>Disabled</Button>
          </div>
          <ButtonGroup>
            <Button variant="outline">A</Button>
            <Button variant="outline">B</Button>
            <Button variant="outline">C</Button>
          </ButtonGroup>
        </CategorySection>

        {/* ─── Data Display ────────────────────────── */}
        <CategorySection label="Data Display">
          <div className="flex flex-wrap items-center gap-3">
            <Avatar>
              <AvatarFallback>AB</AvatarFallback>
            </Avatar>
            <Avatar>
              <AvatarFallback><User size={14} /></AvatarFallback>
            </Avatar>
            <AvatarGroup>
              <Avatar><AvatarFallback>A</AvatarFallback></Avatar>
              <Avatar><AvatarFallback>B</AvatarFallback></Avatar>
              <Avatar><AvatarFallback>C</AvatarFallback></Avatar>
              <AvatarGroupCount>+3</AvatarGroupCount>
            </AvatarGroup>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Badge>Default</Badge>
            <Badge variant="secondary">Secondary</Badge>
            <Badge variant="outline">Outline</Badge>
            <Badge variant="destructive">Destructive</Badge>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Qty</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>Widget A</TableCell>
                <TableCell><Badge variant="secondary">Active</Badge></TableCell>
                <TableCell className="text-right">42</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Widget B</TableCell>
                <TableCell><Badge variant="outline">Draft</Badge></TableCell>
                <TableCell className="text-right">7</TableCell>
              </TableRow>
            </TableBody>
          </Table>
          <Progress value={0} />
          <Progress value={50} />
          <Progress value={100} />
          <div className="flex items-center gap-3">
            <Spinner className="size-3" />
            <Spinner className="size-4" />
            <Spinner className="size-5" />
          </div>
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </CategorySection>

        {/* ─── Forms ───────────────────────────────── */}
        <CategorySection label="Forms">
          <div>
            <Label>Input</Label>
            <Input placeholder="Placeholder" />
          </div>
          <div>
            <Label>Input Group</Label>
            <InputGroup>
              <InputGroupAddon>@</InputGroupAddon>
              <InputGroupInput placeholder="username" />
            </InputGroup>
          </div>
          <div>
            <Label>OTP</Label>
            <InputOTP maxLength={4}>
              <InputOTPGroup>
                <InputOTPSlot index={0} />
                <InputOTPSlot index={1} />
                <InputOTPSlot index={2} />
                <InputOTPSlot index={3} />
              </InputOTPGroup>
            </InputOTP>
          </div>
          <Textarea placeholder="Enter text…" />
          <Select>
            <SelectTrigger>
              <SelectValue placeholder="Choose…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="a">Option A</SelectItem>
              <SelectItem value="b">Option B</SelectItem>
              <SelectItem value="c">Option C</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex items-center gap-2">
            <Checkbox id="cb" checked={checked} onCheckedChange={(v) => setChecked(!!v)} />
            <Label htmlFor="cb">Checkbox</Label>
          </div>
          <RadioGroup defaultValue="a" orientation="horizontal">
            <div className="flex items-center gap-1">
              <RadioGroupItem value="a" id="r1" />
              <Label htmlFor="r1">A</Label>
            </div>
            <div className="flex items-center gap-1">
              <RadioGroupItem value="b" id="r2" />
              <Label htmlFor="r2">B</Label>
            </div>
          </RadioGroup>
          <div className="flex items-center gap-2">
            <Switch checked={switchOn} onCheckedChange={setSwitchOn} />
            <Label>{switchOn ? "On" : "Off"}</Label>
          </div>
          <Slider value={sliderValue} onValueChange={setSliderValue} min={0} max={100} step={1} />
          <FieldGroup>
            <Field>
              <FieldLabel>Username</FieldLabel>
              <Input placeholder="Enter username" />
              <FieldDescription>Your public display name.</FieldDescription>
            </Field>
          </FieldGroup>
        </CategorySection>

        {/* ─── Formatting ──────────────────────────── */}
        <CategorySection label="Formatting">
          <div className="flex flex-wrap items-center gap-3">
            <Toggle pressed={toggleActive} onPressedChange={setToggleActive}>
              <Bold size={13} />
            </Toggle>
            <Toggle disabled>
              <Italic size={13} />
            </Toggle>
            <ToggleGroup type="single" value={toggleGroup} onValueChange={(v) => v && setToggleGroup(v)}>
              <ToggleGroupItem value="left"><AlignLeft size={13} /></ToggleGroupItem>
              <ToggleGroupItem value="center"><AlignCenter size={13} /></ToggleGroupItem>
              <ToggleGroupItem value="right"><AlignRight size={13} /></ToggleGroupItem>
            </ToggleGroup>
          </div>
        </CategorySection>

        {/* ─── Overlays ────────────────────────────── */}
        <CategorySection label="Overlays">
          <div className="flex flex-wrap gap-2 col-span-2">
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="outline">Dialog</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Dialog title</DialogTitle>
                  <DialogDescription>Dialog description text.</DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
                  <Button onClick={() => setDialogOpen(false)}>Confirm</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline">Alert Dialog</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete item?</AlertDialogTitle>
                  <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction>Delete</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <Drawer>
              <DrawerTrigger asChild>
                <Button variant="outline">Drawer</Button>
              </DrawerTrigger>
              <DrawerContent>
                <DrawerHeader>
                  <DrawerTitle>Drawer title</DrawerTitle>
                  <DrawerDescription>Drawer description.</DrawerDescription>
                </DrawerHeader>
                <DrawerFooter>
                  <Button>Action</Button>
                </DrawerFooter>
              </DrawerContent>
            </Drawer>
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="outline">Sheet</Button>
              </SheetTrigger>
              <SheetContent>
                <SheetHeader>
                  <SheetTitle>Sheet title</SheetTitle>
                  <SheetDescription>Side panel content.</SheetDescription>
                </SheetHeader>
                <SheetFooter>
                  <Button>Save</Button>
                </SheetFooter>
              </SheetContent>
            </Sheet>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">Dropdown</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuLabel>Actions</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem>Profile</DropdownMenuItem>
                  <DropdownMenuItem>Settings</DropdownMenuItem>
                  <DropdownMenuItem disabled>Disabled</DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <ContextMenu>
              <ContextMenuTrigger asChild>
                <Button variant="outline">Context Menu</Button>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem>Cut</ContextMenuItem>
                <ContextMenuItem>Copy</ContextMenuItem>
                <ContextMenuItem>Paste</ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline">Popover</Button>
              </PopoverTrigger>
              <PopoverContent>
                <p className="font-medium">Popover title</p>
                <p className="text-muted-foreground">Popover body content.</p>
              </PopoverContent>
            </Popover>
            <HoverCard>
              <HoverCardTrigger asChild>
                <Button variant="outline">Hover Card</Button>
              </HoverCardTrigger>
              <HoverCardContent>
                <p className="font-medium">Hover card title</p>
                <p className="text-muted-foreground">Shows on hover.</p>
              </HoverCardContent>
            </HoverCard>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline">Tooltip</Button>
              </TooltipTrigger>
              <TooltipContent>This is a tooltip</TooltipContent>
            </Tooltip>
          </div>
        </CategorySection>

        {/* ─── Navigation & Search ─────────────────── */}
        <CategorySection label="Navigation & Search">
          <Tabs defaultValue="tab1">
            <TabsList>
              <TabsTrigger value="tab1">Overview</TabsTrigger>
              <TabsTrigger value="tab2">Settings</TabsTrigger>
              <TabsTrigger value="tab3" disabled>Disabled</TabsTrigger>
            </TabsList>
            <TabsContent value="tab1">Overview content.</TabsContent>
            <TabsContent value="tab2">Settings content.</TabsContent>
          </Tabs>
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem><BreadcrumbLink href="#">Home</BreadcrumbLink></BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem><BreadcrumbLink href="#">Docs</BreadcrumbLink></BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem><BreadcrumbPage>Page</BreadcrumbPage></BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <Pagination>
            <PaginationContent>
              <PaginationItem><PaginationPrevious /></PaginationItem>
              <PaginationItem><PaginationLink isActive>1</PaginationLink></PaginationItem>
              <PaginationItem><PaginationLink>2</PaginationLink></PaginationItem>
              <PaginationItem><PaginationEllipsis /></PaginationItem>
              <PaginationItem><PaginationNext /></PaginationItem>
            </PaginationContent>
          </Pagination>
          <Accordion type="single" collapsible>
            <AccordionItem value="a">
              <AccordionTrigger>Section A</AccordionTrigger>
              <AccordionContent>Content for section A.</AccordionContent>
            </AccordionItem>
            <AccordionItem value="b">
              <AccordionTrigger>Section B</AccordionTrigger>
              <AccordionContent>Content for section B.</AccordionContent>
            </AccordionItem>
          </Accordion>
          <NavigationMenu>
            <NavigationMenuList>
              <NavigationMenuItem>
                <NavigationMenuLink href="#">Home</NavigationMenuLink>
              </NavigationMenuItem>
              <NavigationMenuItem>
                <NavigationMenuLink href="#">About</NavigationMenuLink>
              </NavigationMenuItem>
              <NavigationMenuItem>
                <NavigationMenuLink href="#">Contact</NavigationMenuLink>
              </NavigationMenuItem>
            </NavigationMenuList>
          </NavigationMenu>
          <Combobox>
            <ComboboxTrigger>
              <ComboboxValue placeholder="Search…" />
            </ComboboxTrigger>
            <ComboboxContent>
              <ComboboxInput placeholder="Type to search…" />
              <ComboboxList>
                <ComboboxItem value="a">Option A</ComboboxItem>
                <ComboboxItem value="b">Option B</ComboboxItem>
                <ComboboxItem value="c">Option C</ComboboxItem>
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
          <div>
            <CommandDialog open={commandOpen} onOpenChange={setCommandOpen}>
              <CommandInput placeholder="Type a command…" />
              <CommandList>
                <CommandEmpty>No results found.</CommandEmpty>
                <CommandGroup heading="Actions">
                  <CommandItem>New file</CommandItem>
                  <CommandItem>Save</CommandItem>
                </CommandGroup>
              </CommandList>
            </CommandDialog>
            <Button variant="outline" onClick={() => setCommandOpen(true)}>
              Command Palette
            </Button>
          </div>
        </CategorySection>

        {/* ─── Menubar ─────────────────────────────── */}
        <CategorySection label="Menubar">
          <div className="col-span-2">
            <Menubar>
            <MenubarMenu>
              <MenubarTrigger>File</MenubarTrigger>
              <MenubarContent>
                <MenubarItem>New</MenubarItem>
                <MenubarItem>Open</MenubarItem>
                <MenubarSeparator />
                <MenubarItem>Save <MenubarShortcut>⌘S</MenubarShortcut></MenubarItem>
              </MenubarContent>
            </MenubarMenu>
            <MenubarMenu>
              <MenubarTrigger>Edit</MenubarTrigger>
              <MenubarContent>
                <MenubarItem>Undo</MenubarItem>
                <MenubarItem>Redo</MenubarItem>
              </MenubarContent>
            </MenubarMenu>
          </Menubar>
          </div>
        </CategorySection>

        {/* ─── Feedback ────────────────────────────── */}
        <CategorySection label="Feedback">
          <Alert>
            <AlertTitle>Information</AlertTitle>
            <AlertDescription>This is an informational alert.</AlertDescription>
          </Alert>
          <Alert variant="destructive">
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>Something went wrong.</AlertDescription>
          </Alert>
          <Empty>
            <EmptyTitle>No items</EmptyTitle>
            <EmptyDescription>Your list is empty.</EmptyDescription>
          </Empty>
        </CategorySection>

        {/* ─── Layout ──────────────────────────────── */}
        <CategorySection label="Layout">
          <Card>
            <CardHeader>
              <CardTitle>Card Title</CardTitle>
              <CardDescription>Card description text.</CardDescription>
            </CardHeader>
            <CardContent>
              <p>Card body content with default spacing.</p>
            </CardContent>
            <CardFooter>
              <Button variant="outline">Action</Button>
            </CardFooter>
          </Card>
          <div className="col-span-2 flex flex-col gap-4">
            <Separator />
            <div className="flex items-center gap-4">
              <Separator orientation="vertical" className="h-8" />
            </div>
          </div>
          <AspectRatio ratio={16 / 9} className="bg-muted flex items-center justify-center">
            <p className="text-muted-foreground">16:9</p>
          </AspectRatio>
          <ScrollArea className="h-24 border rounded-md">
            <div className="p-3 space-y-1">
              {Array.from({ length: 8 }, (_, i) => (
                <div key={i}>List item {i + 1}</div>
              ))}
            </div>
          </ScrollArea>
          <Collapsible open={collapsibleOpen} onOpenChange={setCollapsibleOpen}>
            <div className="flex items-center gap-2">
              <CollapsibleTrigger asChild>
                <Button variant="outline">{collapsibleOpen ? "Collapse" : "Expand"}</Button>
              </CollapsibleTrigger>
            </div>
            <CollapsibleContent className="mt-2">
              <div className="border rounded-md p-4">Collapsible content.</div>
            </CollapsibleContent>
          </Collapsible>
          <div className="col-span-2">
            <Carousel opts={{ loop: true }}>
              <CarouselContent>
                <CarouselItem>
                  <div className="border rounded-md p-8 text-center">Slide 1</div>
                </CarouselItem>
                <CarouselItem>
                  <div className="border rounded-md p-8 text-center">Slide 2</div>
                </CarouselItem>
                <CarouselItem>
                  <div className="border rounded-md p-8 text-center">Slide 3</div>
                </CarouselItem>
              </CarouselContent>
              <CarouselPrevious />
              <CarouselNext />
            </Carousel>
          </div>
          <Calendar mode="single" />
          <div className="col-span-2">
            <ResizablePanelGroup className="border rounded-md h-24">
              <ResizablePanel defaultSize={50}>
                <div className="flex items-center justify-center h-full">Left</div>
              </ResizablePanel>
              <ResizableHandle />
              <ResizablePanel defaultSize={50}>
                <div className="flex items-center justify-center h-full">Right</div>
              </ResizablePanel>
            </ResizablePanelGroup>
          </div>
        </CategorySection>

        {/* ─── Chart ───────────────────────────────── */}
        <CategorySection label="Chart">
          <div className="col-span-2">
            <ChartContainer config={{ sales: { label: "Sales", color: "var(--primary)" } }}>
              <BarChart
                data={[
                  { month: "Jan", sales: 40 },
                  { month: "Feb", sales: 55 },
                  { month: "Mar", sales: 30 },
                  { month: "Apr", sales: 65 },
                  { month: "May", sales: 50 },
                  { month: "Jun", sales: 75 },
                  { month: "Jul", sales: 85 },
                  { month: "Aug", sales: 60 },
                ]}
              >
                <XAxis dataKey="month" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                <Bar dataKey="sales" radius={[4, 4, 0, 0]} fill="var(--primary)" />
                <ChartTooltip content={<ChartTooltipContent />} />
              </BarChart>
            </ChartContainer>
          </div>
        </CategorySection>
      </div>
    </TooltipProvider>
  );
}
