"use client";

import {
  TrendingUp,
  TrendingDown,
  BarChart3,
  Wallet,
  ClipboardList,
  Zap,
  Download,
  FileText,
  CheckCircle2,
  AlertTriangle,
  Database,
  RefreshCcw,
  Plus,
  XCircle,
  Lock,
  ArrowRight,
} from "lucide-react";

const ICONS = {
  "trending-up": TrendingUp,
  "trending-down": TrendingDown,
  "bar-chart-3": BarChart3,
  wallet: Wallet,
  "clipboard-list": ClipboardList,
  zap: Zap,
  download: Download,
  "file-text": FileText,
  "check-circle": CheckCircle2,
  "alert-triangle": AlertTriangle,
  database: Database,
  "refresh-ccw": RefreshCcw,
  plus: Plus,
  "x-circle": XCircle,
  lock: Lock,
  "arrow-right": ArrowRight,
};

export default function Icon({ name, size = 16, style }) {
  const Cmp = ICONS[name];
  if (!Cmp) return null;
  return <Cmp size={size} style={style} />;
}
