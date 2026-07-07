/**
 * Marketing icon set.
 *
 * The Sprout prototype hand-rolled a lucide-style SVG set (`<Icon n="…" />`);
 * here we map every name it used — across the marketing page AND the five app
 * screens — onto the real `lucide-react` icons, so section components import a
 * single, stable surface from one place.
 *
 * Two ways to consume, both stable:
 *   1. Named import:  `import { Sprout, FlaskConical } from "./icons"`
 *   2. By key:        `import { icons, type IconName } from "./icons"`
 *                     `const I = icons[name]; <I size={18} />`
 *
 * All icons inherit `currentColor` (lucide default) and accept a `size` prop.
 */
import {
  ArrowRight,
  Award,
  BarChart3,
  Bell,
  BookOpen,
  Building2,
  Calendar,
  Check,
  CheckCircle2,
  ChevronRight,
  Eye,
  Flame,
  FlaskConical,
  Gift,
  Globe,
  GraduationCap,
  Heart,
  Home,
  Leaf,
  Lock,
  Mail,
  Megaphone,
  MessageCircle,
  MessagesSquare,
  Play,
  Plus,
  Radio,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Sprout,
  Star,
  Store,
  Target,
  TrendingUp,
  Trophy,
  Users,
  UsersRound,
  Video,
  Zap,
  type LucideIcon,
} from "lucide-react";

/**
 * Stable string keys for icons addressable by name (the prototype's `Icon n=…`
 * convention). Section components can switch on these for data-driven lists.
 */
export type IconName =
  // marketing page + brand
  | "sprout"
  | "graduationCap"
  | "gift"
  | "trophy"
  | "bell"
  | "messages"
  | "messageCircle"
  | "radio"
  | "play"
  | "check"
  | "send"
  | "users"
  | "usersRound"
  | "store"
  | "flame"
  | "star"
  | "sparkles"
  | "eye"
  | "flask"
  | "book"
  | "leaf"
  | "target"
  | "mail"
  | "building"
  | "megaphone"
  | "lock"
  | "zap"
  | "calendar"
  | "award"
  | "video"
  | "globe"
  | "heart"
  | "home"
  // layout / chrome
  | "chevronRight"
  | "arrowRight"
  | "shieldCheck"
  | "barChart3"
  | "plus"
  | "search"
  | "trendingUp"
  | "checkCircle2"
  // back-compat aliases (original key spelling kept so existing consumers compile)
  | "messagesSquare"
  | "building2";

export const icons: Record<IconName, LucideIcon> = {
  sprout: Sprout,
  graduationCap: GraduationCap,
  gift: Gift,
  trophy: Trophy,
  bell: Bell,
  messages: MessagesSquare,
  messageCircle: MessageCircle,
  radio: Radio,
  play: Play,
  check: Check,
  send: Send,
  users: Users,
  usersRound: UsersRound,
  store: Store,
  flame: Flame,
  star: Star,
  sparkles: Sparkles,
  eye: Eye,
  flask: FlaskConical,
  book: BookOpen,
  leaf: Leaf,
  target: Target,
  mail: Mail,
  building: Building2,
  megaphone: Megaphone,
  lock: Lock,
  zap: Zap,
  calendar: Calendar,
  award: Award,
  video: Video,
  globe: Globe,
  heart: Heart,
  home: Home,
  chevronRight: ChevronRight,
  arrowRight: ArrowRight,
  shieldCheck: ShieldCheck,
  barChart3: BarChart3,
  plus: Plus,
  search: Search,
  trendingUp: TrendingUp,
  checkCircle2: CheckCircle2,
  // back-compat aliases
  messagesSquare: MessagesSquare,
  building2: Building2,
};

export {
  ArrowRight,
  Award,
  BarChart3,
  Bell,
  BookOpen,
  Building2,
  Calendar,
  Check,
  CheckCircle2,
  ChevronRight,
  Eye,
  Flame,
  FlaskConical,
  Gift,
  Globe,
  GraduationCap,
  Heart,
  Home,
  Leaf,
  Lock,
  Mail,
  Megaphone,
  MessageCircle,
  MessagesSquare,
  Play,
  Plus,
  Radio,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Sprout,
  Star,
  Store,
  Target,
  TrendingUp,
  Trophy,
  Users,
  UsersRound,
  Video,
  Zap,
  type LucideIcon,
};
