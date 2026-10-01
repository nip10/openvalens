import { Avatar, AvatarFallback } from "@openhealth/ui/components/avatar";
import { Badge } from "@openhealth/ui/components/badge";
import { Button } from "@openhealth/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@openhealth/ui/components/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@openhealth/ui/components/chart";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@openhealth/ui/components/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@openhealth/ui/components/dropdown-menu";
import { Input } from "@openhealth/ui/components/input";
import { Label } from "@openhealth/ui/components/label";
import { Progress } from "@openhealth/ui/components/progress";
import { ScrollArea } from "@openhealth/ui/components/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@openhealth/ui/components/select";
import { Separator } from "@openhealth/ui/components/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@openhealth/ui/components/sheet";
import { Skeleton } from "@openhealth/ui/components/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@openhealth/ui/components/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@openhealth/ui/components/tabs";
import { Textarea } from "@openhealth/ui/components/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@openhealth/ui/components/tooltip";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { Line, LineChart, XAxis } from "recharts";

/**
 * Design-system preview (issue #30): every ported anchovy primitive in one
 * page, for visual checks in light and dark mode. Development builds only.
 * Sample values are synthetic.
 */
export const Route = createFileRoute("/dev/components")({
  beforeLoad: () => {
    if (!import.meta.env.DEV) throw notFound();
  },
  component: ComponentsPreview,
});

const chartData = [
  { day: "Mon", value: 81.4 },
  { day: "Tue", value: 81.1 },
  { day: "Wed", value: 81.3 },
  { day: "Thu", value: 80.9 },
  { day: "Fri", value: 80.7 },
];
const chartConfig = { value: { label: "Sample", color: "var(--chart-1)" } } satisfies ChartConfig;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="font-display text-2xl">{title}</h2>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </section>
  );
}

function ComponentsPreview() {
  return (
    <TooltipProvider>
      <ScrollArea className="h-full">
        <div className="mx-auto max-w-5xl space-y-10 p-8">
          <h1 className="font-display text-4xl">Design system</h1>

          <Section title="Buttons">
            {(["default", "secondary", "outline", "ghost", "destructive", "link"] as const).map(
              (variant) => (
                <Button key={variant} variant={variant}>
                  {variant}
                </Button>
              ),
            )}
            <Button size="sm">Small</Button>
            <Button size="lg">Large</Button>
            <Button disabled>Disabled</Button>
          </Section>

          <Section title="Badges and avatar">
            {(["default", "secondary", "outline", "destructive"] as const).map((variant) => (
              <Badge key={variant} variant={variant}>
                {variant}
              </Badge>
            ))}
            <Avatar>
              <AvatarFallback>OH</AvatarFallback>
            </Avatar>
          </Section>

          <Section title="Form controls">
            <div className="grid w-full max-w-sm gap-2">
              <Label htmlFor="preview-input">Input</Label>
              <Input id="preview-input" placeholder="Placeholder" />
              <Label htmlFor="preview-textarea">Textarea</Label>
              <Textarea id="preview-textarea" placeholder="Notes" />
              <Select>
                <SelectTrigger>
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="a">Option A</SelectItem>
                  <SelectItem value="b">Option B</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </Section>

          <Section title="Card, progress, skeleton, separator">
            <Card className="w-80">
              <CardHeader>
                <CardTitle>Card title</CardTitle>
                <CardDescription>Card description</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Progress value={62} />
                <Separator />
                <Skeleton className="h-4 w-40" />
              </CardContent>
            </Card>
          </Section>

          <Section title="Tabs">
            <Tabs defaultValue="one" className="w-80">
              <TabsList>
                <TabsTrigger value="one">One</TabsTrigger>
                <TabsTrigger value="two">Two</TabsTrigger>
              </TabsList>
              <TabsContent value="one">First panel</TabsContent>
              <TabsContent value="two">Second panel</TabsContent>
            </Tabs>
          </Section>

          <Section title="Overlays">
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="outline">Dialog</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Dialog title</DialogTitle>
                  <DialogDescription>Dialog description</DialogDescription>
                </DialogHeader>
              </DialogContent>
            </Dialog>
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="outline">Sheet</Button>
              </SheetTrigger>
              <SheetContent>
                <SheetHeader>
                  <SheetTitle>Sheet title</SheetTitle>
                  <SheetDescription>Sheet description</SheetDescription>
                </SheetHeader>
              </SheetContent>
            </Sheet>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">Dropdown</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem>Item one</DropdownMenuItem>
                <DropdownMenuItem>Item two</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost">Tooltip</Button>
              </TooltipTrigger>
              <TooltipContent>Tooltip content</TooltipContent>
            </Tooltip>
          </Section>

          <Section title="Table">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Day</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {chartData.map((row) => (
                  <TableRow key={row.day}>
                    <TableCell>{row.day}</TableCell>
                    <TableCell className="text-right">{row.value}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Section>

          <Section title="Chart">
            <ChartContainer config={chartConfig} className="h-48 w-full">
              <LineChart data={chartData}>
                <XAxis dataKey="day" tickLine={false} axisLine={false} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Line dataKey="value" stroke="var(--color-value)" strokeWidth={2} dot={false} />
              </LineChart>
            </ChartContainer>
          </Section>
        </div>
      </ScrollArea>
    </TooltipProvider>
  );
}
