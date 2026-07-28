// ── Category icons ───────────────────────────────────────────
// A curated map keeps the whole lucide set out of the bundle while
// still covering everything the seeds use. `category.icon` stores the
// kebab-case lucide name.

import {
  Bike,
  Book,
  BookOpen,
  Boxes,
  Cable,
  Camera,
  Car,
  CarFront,
  CarTaxiFront,
  CookingPot,
  Cpu,
  Folder,
  Gamepad2,
  GraduationCap,
  Headphones,
  House,
  Laptop,
  Monitor,
  Package,
  Shirt,
  Smartphone,
  Sofa,
  Truck,
  Watch,
  Wrench,
  type LucideIcon,
} from "lucide-react";

export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  bike: Bike,
  book: Book,
  "book-open": BookOpen,
  boxes: Boxes,
  cable: Cable,
  camera: Camera,
  car: Car,
  "car-front": CarFront,
  "car-taxi-front": CarTaxiFront,
  "cooking-pot": CookingPot,
  cpu: Cpu,
  folder: Folder,
  "gamepad-2": Gamepad2,
  "graduation-cap": GraduationCap,
  headphones: Headphones,
  house: House,
  laptop: Laptop,
  monitor: Monitor,
  package: Package,
  shirt: Shirt,
  smartphone: Smartphone,
  sofa: Sofa,
  truck: Truck,
  watch: Watch,
  wrench: Wrench,
};

export const ICON_NAMES = Object.keys(CATEGORY_ICONS);

/** The icon for a stored name, falling back to a plain folder. */
export function iconFor(name: string | null | undefined): LucideIcon {
  return (name && CATEGORY_ICONS[name]) || Folder;
}

/** Swatches offered by the icon/colour picker. */
export const CATEGORY_COLORS = [
  "#38bdf8",
  "#60a5fa",
  "#818cf8",
  "#a78bfa",
  "#f472b6",
  "#fb7185",
  "#fbbf24",
  "#34d399",
  "#22d3ee",
  "#94a3b8",
];
