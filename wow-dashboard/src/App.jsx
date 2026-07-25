import React, { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import { Responsive } from 'react-grid-layout';
import ReactECharts from 'echarts-for-react';
import { Widget5 as GripHorizontal, CloseCircle as X, Settings, Download, Pulse2 as Activity, AddSquare as Plus, TrashBinMinimalistic as Trash2, Widget as Layout, Chart2 as BarChart3, Pen2 as Edit3, GraphUp as TrendingUp, PieChart as PieIcon, Smartphone, ShieldWarning as ShieldAlert, BatteryCharge as BatteryCharging, UsersGroupRounded as Users, Suitcase as Briefcase, Bell, List, SliderHorizontal as SlidersHorizontal, Radar, Sun, Moon, Monitor, CheckCircle as Check, AltArrowDown as ChevronDown, InfoCircle as Info, AltArrowRight as ChevronRight, Upload, Diskette as Save, Box, FileText, MapPoint as MapPin, ClockCircle as Clock, Target, WiFiRouter as Wifi, WiFiRouterMinimalistic as WifiOff, Layers, Global as Globe, Magnifer as Search, Bookmark, AltArrowLeft as ChevronLeft, Heart, Bug, Folder, Atom, Backpack, Bag as ShoppingBag, Gps as Locate, Vinyl as Disc, Bed, Archive, GhostSmile as Baby, Bolt as Zap, Bone, Book, Delivery as Package, TestTube as FlaskConical, ShieldMinimalistic as LifeBuoy, Buildings2 as Building2, Bus, Calculator, Calendar, Camera, Armchair, ChatRound as MessageCircle, CheckSquare, CloseSquare as XSquare, DangerTriangle as AlertTriangle, Stopwatch as Timer, Refresh as RefreshCw, Buildings as Factory, Clapperboard, Code, Compass, Cpu, Dislike as ThumbsDown, Like as ThumbsUp, Copy, DollarMinimalistic as CircleDollarSign, DoubleAltArrowUp as ChevronsUp, Filter, Camera as Aperture, Flame, Flag, Forbidden as Ban, Gamepad as Gamepad2, HeadphonesRound as Headphones, Home, Hourglass, Glasses, Key, Laptop, Lightbulb, Lock, LockUnlocked as Unlock, MagicStick as Wand2, StreetsNavigation as Navigation, Book2 as BookOpen, Palette, Printer, Radio, Satellite, Shield, Shop as Store, Tag, TShirt as Shirt, User, WatchRound as Watch, Widget2 as LayoutGrid, Wineglass as Wine, Ghost, Letter as Mail, EyeClosed as EyeOff, MenuDots as MoreHorizontal, TransferHorizontal as MoveHorizontal, ArrowRightUp as ExternalLink, Structure as Workflow, Logout as LogOut, ShieldCheck, ChecklistMinimalistic as ListChecks, DocumentText as ScrollText, PlugCircle as Webhook, Database, UserCircle as UserCircle2 } from '@solar-icons/react';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import ReactGlobe from 'react-globe.gl';
import * as THREE from 'three';
import { MapContainer, TileLayer, Marker, Tooltip as LeafletTooltip, useMap } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'react-leaflet-cluster/dist/assets/MarkerCluster.css';
import 'react-leaflet-cluster/dist/assets/MarkerCluster.Default.css';
import DevicesView from './components/devices/DevicesView';
import WorkflowsView from './components/workflows/WorkflowsView';
import CompliancePoliciesView from './components/compliance/CompliancePoliciesView';
import CasesView from './components/cases/CasesView';
import AppListsView from './components/compliance/AppListsView';
import AuditLogsView from './components/audit/AuditLogsView';
import ViewSwitcher from './components/shared/ViewSwitcher';
import HelpIcon from './components/shared/HelpIcon';
import LogExportDestinations from './components/settings/LogExportDestinations';
import TriggersSettings from './components/settings/TriggersSettings';
import IntegrationsSettings from './components/settings/IntegrationsSettings';
import CaseAutoRunRulesSettings from './components/settings/CaseAutoRunRulesSettings';
import AppliveryWebhookSettings from './components/settings/AppliveryWebhookSettings';
import CaseSlaSettings from './components/settings/CaseSlaSettings';
import SystemHealthSettings from './components/settings/SystemHealthSettings';
import OsUpdatesSettings from './components/settings/OsUpdatesSettings';
import VulnCatalogSettings from './components/settings/VulnCatalogSettings';
import VulnServiceSettings from './components/settings/VulnServiceSettings';
import OsLifecycleSettings from './components/settings/OsLifecycleSettings';
import AppleAppUpdatesSettings from './components/settings/AppleAppUpdatesSettings';
import ThreatIntelSettings from './components/settings/ThreatIntelSettings';
import WorkspaceOnboardingModal from './components/onboarding/WorkspaceOnboardingModal';
import RolesSettings from './components/settings/RolesSettings';

// ─── CUSTOM AUTO-SIZING ENGINE ───
function useAutoWidth() {
  const [width, setWidth] = useState(1200);
  const ref = React.useCallback(node => {
    if (node !== null) {
      setWidth(node.clientWidth);
      const observer = new ResizeObserver(entries => {
        if (entries[0]) setWidth(entries[0].target.clientWidth);
      });
      observer.observe(node);
    }
  }, []);
  return [width, ref];
}

// ─── GLOBAL AXIOS INTERCEPTOR (ROCK SOLID) ───
axios.interceptors.request.use((config) => {
  const token = localStorage.getItem('applivery_dashboard_token');
  if (token && config.url && config.url.includes('/api')) {
    // FIX: Safely use the .set() method to preserve existing AxiosHeaders (like X-Workspace-Slug)
    if (config.headers && typeof config.headers.set === 'function') {
      config.headers.set('Authorization-Dashboard', `Bearer ${token}`);
      config.headers.set('X-Dashboard-Token', `Bearer ${token}`);
    } else {
      config.headers = config.headers || {};
      config.headers['Authorization-Dashboard'] = `Bearer ${token}`;
      config.headers['X-Dashboard-Token'] = `Bearer ${token}`;
    }
  }
  return config;
});

// ─── APPLIVERY HUMAN SESSION — shared helpers ───
// apiToken/orgSlug are now personal to whoever is logged in (set at login,
// never persisted to shared backend state — see StatePayload in main.py).
// These helpers keep that session alive without every call site
// reimplementing the refresh dance.

function clearAppliverySession() {
  localStorage.removeItem('applivery_dashboard_token');
  localStorage.removeItem('applivery_apiToken');
  localStorage.removeItem('applivery_apiTokenExpireAt');
  localStorage.removeItem('applivery_refreshToken');
  localStorage.removeItem('applivery_refreshTokenExpireAt');
  localStorage.removeItem('applivery_orgSlug');
  localStorage.removeItem('applivery_user');
  localStorage.removeItem('applivery_organizations');
}

let _appliveryRefreshInFlight = null;
async function refreshAppliverySession() {
  // De-dupe concurrent refreshes — several widgets can hit a 401 at once.
  if (_appliveryRefreshInFlight) return _appliveryRefreshInFlight;
  _appliveryRefreshInFlight = (async () => {
    const lastAccessToken = localStorage.getItem('applivery_apiToken');
    const refreshToken = localStorage.getItem('applivery_refreshToken');
    if (!lastAccessToken || !refreshToken) return false;
    try {
      const res = await axios.post('/api/auth/refresh', { lastAccessToken, refreshToken });
      localStorage.setItem('applivery_apiToken', res.data.appliveryAccessToken);
      localStorage.setItem('applivery_apiTokenExpireAt', res.data.appliveryAccessTokenExpireAt || '');
      localStorage.setItem('applivery_refreshToken', res.data.appliveryRefreshToken || '');
      localStorage.setItem('applivery_refreshTokenExpireAt', res.data.appliveryRefreshTokenExpireAt || '');
      return true;
    } catch (e) {
      return false;
    }
  })();
  const result = await _appliveryRefreshInFlight;
  _appliveryRefreshInFlight = null;
  return result;
}

// ─── SOAR RBAC — resolve-access helper ───
// Backend enforcement (require_permission in main.py) reads from a
// server-side cache that is ONLY populated by POST /api/auth/resolve-access
// — it never re-resolves inline. So this call must happen right after every
// login (fresh credentials or workspace picker) and right after every
// workspace switch, or every high-risk endpoint (policy/workflow delete,
// destructive workflow run, integrations CRUD, config export/import/clone,
// bulk triage) will 403 for everyone, including the real Applivery Owner.
// Result is cached in localStorage so the UI can gate nav/buttons
// synchronously without waiting on a second round-trip per render.
async function resolveSoarAccess(apiTok, slug) {
  try {
    const res = await axios.post('/api/auth/resolve-access', {}, {
      headers: { Authorization: `Bearer ${apiTok}`, 'X-Workspace-Slug': slug },
    });
    localStorage.setItem('applivery_access', JSON.stringify(res.data));
    return res.data;
  } catch (err) {
    const access = {
      allowed: false, isSuperAdmin: false, role: null, collaboratorRole: null, matchedTagValue: null,
      deniedReason: err.response?.data?.detail || 'Could not verify your access permissions for this workspace.',
    };
    localStorage.setItem('applivery_access', JSON.stringify(access));
    return access;
  }
}

function getStoredAccess() {
  try { return JSON.parse(localStorage.getItem('applivery_access') || 'null'); } catch (e) { return null; }
}

// Small gating helpers shared by every view that needs to hide/disable a
// high-risk action — mirrors _FEATURE_ACCESS_LEVELS / require_permission in
// main.py exactly, so a button that's enabled here never gets a surprise
// 403 from the backend for a permission reason (it can still 403 for an
// unrelated reason, e.g. a stale cache TTL, but never a scope mismatch).
const _FEATURE_ACCESS_LEVELS = { none: 0, read: 1, manage: 2 };
function hasFeatureAccess(access, area, level = 'read') {
  if (!access || !access.allowed) return false;
  if (access.isSuperAdmin) return true;
  const have = _FEATURE_ACCESS_LEVELS[(access.role?.featureAccess || {})[area] || 'none'] ?? 0;
  const need = _FEATURE_ACCESS_LEVELS[level] ?? 1;
  return have >= need;
}
function hasRiskyAction(access, action) {
  if (!access || !access.allowed) return false;
  if (access.isSuperAdmin) return true;
  return !!(access.role?.riskyActions || {})[action];
}

axios.interceptors.response.use(
  (response) => response,
  async (error) => {
    const cfg = error.config || {};
    if (error.response && error.response.status === 401) {
      // Direct-to-Applivery calls (many widgets call api.applivery.io
      // straight from the browser) surface a real 401 when the human
      // session token expires mid-use — try one silent refresh + retry
      // before giving up.
      const isDirectApplivery = typeof cfg.url === 'string' && cfg.url.includes('api.applivery.io');
      if (isDirectApplivery && !cfg._appliveryRetried) {
        const ok = await refreshAppliverySession();
        if (ok) {
          cfg._appliveryRetried = true;
          const newToken = localStorage.getItem('applivery_apiToken');
          if (cfg.headers && typeof cfg.headers.set === 'function') cfg.headers.set('Authorization', `Bearer ${newToken}`);
          else { cfg.headers = cfg.headers || {}; cfg.headers['Authorization'] = `Bearer ${newToken}`; }
          return axios(cfg);
        }
        console.error("🔥 Applivery session expired and refresh failed — signing out.");
        clearAppliverySession();
        setTimeout(() => window.location.reload(), 500);
        return Promise.reject(error);
      }

      const detail = error.response.data?.detail || '';

      // FIX: Explicitly check for 'Missing X-Dashboard-Token', ignoring 'Missing credentials'
      if (typeof detail === 'string' && (detail.includes('Invalid session') || detail.includes('Missing X-Dashboard-Token'))) {
        console.error("🔥 FATAL SESSION ERROR:", detail);
        clearAppliverySession();
        setTimeout(() => window.location.reload(), 1000);
      } else {
        console.warn("Ignored 401: Data-level error, session remains active.", detail);
      }
    }
    return Promise.reject(error);
  }
);

// ─── OS ICONS COMPONENT ───
const OFFICIAL_OS_COLORS = { apple: '#1D1D1F', android: '#3DDC84', windows: '#0241E2' };
// Apple adapts to theme — near-black on light, near-white on dark
const getAppleColor = (isDarkMode) => isDarkMode ? '#E5E7EB' : '#1D1D1F';

function OsIcon({ platform, size = 16, color, isDarkMode = false }) {
  const p = platform.toLowerCase();
  if (p.includes('apple') || p.includes('ios') || p.includes('mac') || p.includes('ipad')) {
    return (
      <svg width={size} height={size} viewBox="2 1.5 20 19" fill={color || getAppleColor(isDarkMode)}>
        <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.04 2.34-.84 3.73-.81 1.26.06 2.3.49 3.03 1.3-2.6 1.42-2.14 4.54.44 5.56-.63 1.95-1.63 4.2-2.28 5.12zM12.03 7.25C11.83 4.4 14.12 2.35 16.14 2c.28 2.56-2.28 4.88-4.11 5.25z"/>
      </svg>
    );
  }
  if (p.includes('android') || p.includes('emm')) {
    return (
      <svg width={size} height={size} viewBox="1 2 22 17" fill={color || OFFICIAL_OS_COLORS.android}>
        <path d="M17.6 9.48l1.84-3.18a.68.68 0 0 0-.25-.93.67.67 0 0 0-.93.25l-1.88 3.25a11.17 11.17 0 0 0-8.76 0L5.74 5.62a.67.67 0 0 0-.93-.25.68.68 0 0 0-.25.93l1.84 3.18A11.53 11.53 0 0 0 1.2 18.6h21.6a11.5 11.5 0 0 0-5.2-9.12zM7.33 15.46a1.44 1.44 0 1 1 1.44-1.44 1.44 1.44 0 0 1-1.44 1.44zm9.34 0a1.44 1.44 0 1 1 1.44-1.44 1.44 1.44 0 0 1-1.44 1.44z"/>
      </svg>
    );
  }
  if (p.includes('win')) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill={color || OFFICIAL_OS_COLORS.windows}>
        <path d="M0 0h11.4v11.4H0V0zm12.6 0H24v11.4H12.6V0zM0 12.6h11.4V24H0V12.6zm12.6 0H24V24H12.6V12.6z"/>
      </svg>
    );
  }
  return <Layout size={size} color={color} />;
}

const osImages = {
  apple: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="2 1.5 20 19" fill="%2379C6E8"><path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.04 2.34-.84 3.73-.81 1.26.06 2.3.49 3.03 1.3-2.6 1.42-2.14 4.54.44 5.56-.63 1.95-1.63 4.2-2.28 5.12zM12.03 7.25C11.83 4.4 14.12 2.35 16.14 2c.28 2.56-2.28 4.88-4.11 5.25z"/></svg>',
  android: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="1 2 22 17" fill="%233DDC84"><path d="M17.6 9.48l1.84-3.18a.68.68 0 0 0-.25-.93.67.67 0 0 0-.93.25l-1.88 3.25a11.17 11.17 0 0 0-8.76 0L5.74 5.62a.67.67 0 0 0-.93-.25.68.68 0 0 0-.25.93l1.84 3.18A11.53 11.53 0 0 0 1.2 18.6h21.6a11.5 11.5 0 0 0-5.2-9.12zM7.33 15.46a1.44 1.44 0 1 1 1.44-1.44 1.44 1.44 0 0 1-1.44 1.44zm9.34 0a1.44 1.44 0 1 1 1.44-1.44 1.44 1.44 0 0 1-1.44 1.44z"/></svg>',
  windows: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%230078D4"><path d="M0 0h11.4v11.4H0V0zm12.6 0H24v11.4H12.6V0zM0 12.6h11.4V24H0V12.6zm12.6 0H24V24H12.6V12.6z"/></svg>'
};

function Hash(props) {
  return (
    <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="4" x2="20" y1="9" y2="9"/><line x1="4" x2="20" y1="15" y2="15"/><line x1="10" x2="8" y1="3" y2="21"/><line x1="16" x2="14" y1="3" y2="21"/>
    </svg>
  );
}

const PRIMARY_BLUE = '#0241E3';
const SUCCESS = '#22C55E';
const WARNING = '#F59E0B';
const DANGER = '#EF4444';

// Left-nav categories for the Platform Settings modal — see settingsTab state.
const SETTINGS_TABS = [
  { id: 'general', label: 'General', Icon: Settings },
  { id: 'smtp', label: 'Email (SMTP)', Icon: Mail },
  { id: 'account', label: 'Account', Icon: UserCircle2 },
  { id: 'backup', label: 'Backup & Restore', Icon: Download },
  { id: 'audit', label: 'Audit Log', Icon: ScrollText },
  { id: 'automation', label: 'Workspace Automation', Icon: RefreshCw },
  { id: 'webhook', label: 'Device Data Webhook', Icon: Webhook },
  { id: 'logexport', label: 'Log Export', Icon: Database },
  { id: 'triggers', label: 'Inbound Webhooks', Icon: Zap },
  { id: 'caseautorun', label: 'Case Auto-Run Rules', Icon: Target },
  { id: 'applivery-events', label: 'Applivery Events', Icon: Satellite },
  { id: 'casesla', label: 'Case SLA', Icon: Clock },
  { id: 'systemhealth', label: 'System Health', Icon: Activity },
  { id: 'osupdates', label: 'OS Updates', Icon: Cpu },
  { id: 'vulncatalog', label: 'Vulnerability Catalog', Icon: Bug },
  { id: 'vulnservice', label: 'Vulnerability Service', Icon: ShieldAlert },
  { id: 'oslifecycle', label: 'OS Lifecycle', Icon: Hourglass },
  { id: 'appupdates', label: 'App Updates (Apple)', Icon: Package },
  { id: 'integrations', label: 'Ticketing & Chat', Icon: MessageCircle },
  { id: 'threatintel', label: 'Threat Intel', Icon: Radar },
  // Super Admin only — filtered out of SETTINGS_TABS.map() below for anyone
  // else, same restriction the backend enforces via require_permission(
  // super_admin_only=True) on every /api/roles* endpoint.
  { id: 'roles', label: 'Roles', Icon: ShieldCheck, superAdminOnly: true },
];

// Maps each Settings left-nav tab to its heading id inside docs/settings.md,
// so the single ⓘ button in the Settings modal header can deep-link straight
// to the section for whichever tab is currently open, instead of dropping
// the admin at the top of a long guide. Ids are github-slugger output for
// the "## ..." heading text (verified against the doc during authoring —
// see e.g. "Backup & Restore" -> "backup--restore", ampersand dropped,
// leaving a double hyphen where the surrounding spaces collapse together).
const SETTINGS_TAB_ANCHORS = {
  general: 'general',
  smtp: 'smtp',
  account: 'account',
  backup: 'backup--restore',
  audit: 'audit-log',
  automation: 'workspace-automation',
  webhook: 'device-data-webhook',
  logexport: 'log-export',
  triggers: 'inbound-webhooks',
  caseautorun: 'case-auto-run-rules',
  'applivery-events': 'applivery-events',
  casesla: 'case-sla',
  systemhealth: 'system-health',
  osupdates: 'os-updates',
  vulncatalog: 'vulnerability-catalog',
  vulnservice: 'vulnerability-service',
  oslifecycle: 'os-lifecycle',
  appupdates: 'apple-app-updates',
  integrations: 'integrations',
  threatintel: 'threat-intel',
  roles: 'roles',
};

const THEME = {
  light: {
    bg: '#F3F7FE', card: '#FFFFFF', border: '#E9EAEC',
    text: '#111827', textMuted: '#6B7280',
    chartPalette: ['#8B5CF6', '#3B82F6', '#06B6D4', '#22C55E', '#F59E0B', '#EF4444', '#EC4899', '#14B8A6'],
    gridLine: 'rgba(107, 114, 128, 0.1)'
  },
  dark: {
    // Neutral BlueSky dark-surface tokens (docs.applivery.com pages.md "Dark
    // Mode") — gray-950/800/700/white/gray-400 — replacing the previous
    // navy-tinted palette so dark mode matches Applivery's own dark surfaces.
    bg: '#030712', card: '#1F2937', border: '#374151',
    text: '#FFFFFF', textMuted: '#9CA3AF',
    chartPalette: ['#A78BFA', '#60A5FA', '#22D3EE', '#4ADE80', '#FBBF24', '#F87171', '#F472B6', '#2DD4BF'],
    gridLine: 'rgba(156, 163, 175, 0.1)'
  }
};

// ─── ENHANCED WIDGET DESIGN SYSTEM (from UX Designer) ───────────────────────

// CSS variable helpers - resolve against current theme
const cssToken = (token, fallback = '') => {
  if (typeof window === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(token.replace(/^var\(/, '').replace(/\)$/, '')).trim();
  return v || fallback;
};

// Widget card elevation shadows
const ELEVATION_SM = '0px 1px 2px 0px rgba(0,0,0,0.05), 0px 0px 0px 1px rgba(0,0,0,0.04)';
const ELEVATION_SM_DARK = '0px 1px 3px 0px rgba(0,0,0,0.3)';

// ─── CHART HOVER: Ghost detects hover + triggers global focus, front is silent visual ───
// Ghost series (index 0): not silent, handles events, focus:'self' blurScope:'global'
//   This puts ALL items in BOTH series into blur state when ghost[i] is hovered.
//   Ghost[i] itself: emphasis → grows (scale:true, scaleSize:10), stays 38% opacity
//   Ghost[j≠i]: blur → opacity:0 (invisible)
//   Front[i]: blur → BUT we override per-item to keep it solid (opacity:1)
//   Front[j≠i]: blur → opacity:0.15 (faded)
// The key: front[i] has per-item blur:opacity:1 so it stays solid even when blurred globally.

const ECHARTS_BLUR = {
  itemStyle: { opacity: 0.18 },
  label: { opacity: 0.18 },
};

const makeBarEmphasis = (barColor) => ({
  focus: 'self',
  blurScope: 'global',
  scale: true,
  scaleSize: 6,
  itemStyle: { color: barColor, borderWidth: 0 },
});

const buildPieSeriesOption = (chartData, colorFn, stat, humanLabel, isDonut, activeTheme) => {
  const outerR = isDonut ? '78%' : '78%';
  const innerR = isDonut ? '59%' : '0%';

  const slices = chartData.map((d, i) => ({
    name: humanLabel(d.name),
    value: d.value,
    color: colorFn(stat, d.name, i),
  }));

  // GHOST series: detects mouse, triggers global focus+blur, grows on hover
  const ghostSeries = {
    type: 'pie',
    z: 1,
    silent: false,
    radius: [innerR, outerR],
    center: ['50%', '50%'],
    itemStyle: { borderWidth: 0, borderColor: 'transparent' },
    label: { show: false },
    tooltip: { show: true },
    emphasis: {
      focus: 'self',
      blurScope: 'global',   // puts ALL series items into blur on hover
      scale: true,
      scaleSize: 10,
      itemStyle: { borderWidth: 0 },
    },
    blur: { itemStyle: { opacity: 0, borderWidth: 0 } },  // other ghost slices invisible
    data: slices.map(d => ({
      name: d.name,
      value: d.value,
      itemStyle: { color: d.color, opacity: 0.38, borderWidth: 0 },
      emphasis: { itemStyle: { color: d.color, opacity: 0.38, borderWidth: 0 } },
      blur: { itemStyle: { color: d.color, opacity: 0, borderWidth: 0 } },
    })),
  };

  // SOLID series: silent visual layer. Per-item blur keeps hovered front[i] solid.
  // When ghost[i] triggers blurScope:global, front[i] enters blur state BUT
  // its per-item blur opacity:1 overrides the series-level blur → stays solid.
  // Front[j≠i] also enters blur → opacity:0.15 → faded. ✓
  const solidSeries = {
    type: 'pie',
    z: 2,
    silent: true,
    radius: [innerR, outerR],
    center: ['50%', '50%'],
    itemStyle: { borderWidth: 0, borderColor: 'transparent' },
    label: { show: false },
    tooltip: { show: false },
    emphasis: { scale: false, itemStyle: { borderWidth: 0 } },
    blur: { itemStyle: { opacity: 0.15, borderWidth: 0 } },
    data: slices.map((d, idx) => ({
      name: d.name,
      value: d.value,
      itemStyle: { color: d.color, opacity: 1, borderWidth: 0 },
      // Per-item blur: each slice knows its own index.
      // We store index on the item so onEvents can set the right blur per item.
      // Default blur: faded. Will be overridden for the hovered index via chart.setOption.
      blur: { itemStyle: { color: d.color, opacity: 0.15, borderWidth: 0 } },
    })),
  };

  return [ghostSeries, solidSeries];
};


// ─── THEMED TOOLTIP FORMATTER (elegant card-style popup) ───
const makeTooltipFormatter = (theme) => ({
  trigger: 'item',
  backgroundColor: theme.card,
  borderColor: theme.border,
  borderWidth: 1,
  borderRadius: 10,
  padding: [10, 14],
  textStyle: { color: theme.text, fontFamily: 'Outfit, sans-serif', fontSize: 13 },
  extraCssText: `box-shadow: 0 8px 24px rgba(0,0,0,${theme === THEME.dark ? '0.4' : '0.12'}); backdrop-filter: blur(8px);`,
  formatter: (p) => {
    const dot = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.color};margin-right:6px;"></span>`;
    const pct = p.percent !== undefined ? ` <span style="opacity:0.55;font-size:11px">(${p.percent.toFixed(1)}%)</span>` : '';
    return `${dot}<span style="font-weight:500">${p.name}</span>${pct}<br/><span style="font-size:18px;font-weight:700;padding-left:14px">${p.value}</span>`;
  },
});

// ─── WIDGET CARD SHELL (enhanced) ───
function WidgetCardShell({ children, theme, highlight = false, style = {} }) {
  const isDark = theme === THEME.dark;
  return (
    <div
      className="rounded-2xl flex flex-col overflow-hidden h-full transition-all duration-300"
      style={{
        backgroundColor: theme.card,
        border: `1px solid ${theme.border}`,
        boxShadow: highlight
          ? `0 0 0 2px ${PRIMARY_BLUE}, ${isDark ? ELEVATION_SM_DARK : ELEVATION_SM}`
          : isDark ? ELEVATION_SM_DARK : ELEVATION_SM,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// ─── WIDGET HEADER (enhanced) ───
function WidgetHeader({ title, isTrend, osTotals, icon: Icon, iconColor, iconBg, theme, children, onMenuClick, menuOpen, onInfoClick, onToggleLock, onEdit, onRemove, isLocked, widgetId }) {
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef(null);
  const isDarkHeader = theme === THEME.dark;

  useEffect(() => {
    if (!showMenu) return;
    const handler = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setShowMenu(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showMenu]);

  return (
    <div className="px-5 pt-4 pb-3 flex justify-between items-center shrink-0 border-b" style={{ borderColor: theme.border + '4D' }}>
      {/* Left: icon + title */}
      <div className="flex items-center gap-2.5 min-w-0 flex-1">
        {Icon && (
          <div className="flex items-center justify-center w-7 h-7 rounded-lg shrink-0" style={{ backgroundColor: iconBg || `${PRIMARY_BLUE}18`, color: iconColor || PRIMARY_BLUE }}>
            <Icon size={15} />
          </div>
        )}
        <div className="flex items-baseline gap-1.5 min-w-0">
          <span className="text-[13px] font-medium truncate" style={{ color: theme.text }}>{title}</span>
          {isTrend && <span className="text-[10px] shrink-0" style={{ color: theme.textMuted }}>last 30 days</span>}
        </div>
        {/* OS totals for trend widgets */}
        {osTotals && (
          <div className="flex items-center gap-2.5 ml-1">
            {osTotals.apple > 0 && <div className="flex items-center gap-1 text-[11px] font-semibold" style={{ color: getAppleColor(isDarkHeader) }}><OsIcon platform="apple" size={13} color={getAppleColor(isDarkHeader)} isDarkMode={isDarkHeader}/> {osTotals.apple}</div>}
            {osTotals.android > 0 && <div className="flex items-center gap-1 text-[11px] font-semibold" style={{ color: OFFICIAL_OS_COLORS.android }}><OsIcon platform="android" size={13} color={OFFICIAL_OS_COLORS.android}/> {osTotals.android}</div>}
            {osTotals.windows > 0 && <div className="flex items-center gap-1 text-[11px] font-semibold" style={{ color: OFFICIAL_OS_COLORS.windows }}><OsIcon platform="windows" size={13} color={OFFICIAL_OS_COLORS.windows}/> {osTotals.windows}</div>}
          </div>
        )}
      </div>

      {/* Right: actions */}
      <div className="flex items-center gap-1 shrink-0 ml-2">
        {onInfoClick && (
          <button onClick={onInfoClick} className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-black/5 dark:hover:bg-white/8 transition-colors" style={{ color: theme.textMuted }}>
            <Info size={13} />
          </button>
        )}
        {/* Options menu */}
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setShowMenu(p => !p)}
            className="w-6 h-6 flex items-center justify-center rounded-md transition-colors"
            style={{ color: theme.textMuted, backgroundColor: showMenu ? `${PRIMARY_BLUE}12` : 'transparent' }}
          >
            <MoreHorizontal size={14} />
          </button>
          {showMenu && (
            <WidgetOptionsMenu
              theme={theme}
              isLocked={isLocked}
              onHide={() => { setShowMenu(false); onRemove && onRemove(widgetId); }}
              onMove={() => { setShowMenu(false); }}
              onEdit={() => { setShowMenu(false); onEdit && onEdit(); }}
              onRemove={() => { setShowMenu(false); onRemove && onRemove(widgetId); }}
              onToggleLock={() => { setShowMenu(false); onToggleLock && onToggleLock(widgetId); }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── WIDGET OPTIONS DROPDOWN (enhanced) ───
function WidgetOptionsMenu({ theme, isLocked, onHide, onMove, onEdit, onRemove, onToggleLock }) {
  return (
    <div
      className="absolute right-0 top-full mt-1 rounded-xl z-50 min-w-[168px] flex flex-col py-1.5 overflow-hidden"
      style={{
        backgroundColor: theme.card,
        border: `1px solid ${theme.border}`,
        boxShadow: '0 8px 24px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.08)',
      }}
    >
      {[
        { icon: EyeOff, label: 'Hide widget', action: onHide },
        { icon: MoveHorizontal, label: 'Move widget', action: onMove },
        { icon: Edit3, label: 'Edit widget', action: onEdit },
        { icon: isLocked ? Unlock : Lock, label: isLocked ? 'Unlock position' : 'Lock position', action: onToggleLock },
      ].map(({ icon: Icon, label, action }) => (
        <button
          key={label}
          onClick={action}
          className="flex items-center gap-2.5 px-3 py-2 w-full text-left transition-colors hover:opacity-80"
          style={{ color: theme.text }}
        >
          <Icon size={13} style={{ color: theme.textMuted }} />
          <span className="text-[13px] font-normal">{label}</span>
        </button>
      ))}
      <div className="h-px mx-3 my-1" style={{ backgroundColor: theme.border }} />
      <button
        onClick={onRemove}
        className="flex items-center gap-2.5 px-3 py-2 w-full text-left transition-colors hover:opacity-80"
        style={{ color: DANGER }}
      >
        <Trash2 size={13} style={{ color: DANGER }} />
        <span className="text-[13px] font-normal">Remove widget</span>
      </button>
    </div>
  );
}

// ─── ENHANCED SCORECARD WIDGET ───
function ScorecardContent({ value, label, theme, isClickable, onClick }) {
  return (
    <div
      className={`flex flex-col items-center justify-center h-full gap-2 ${isClickable ? 'cursor-pointer' : ''}`}
      onClick={isClickable ? onClick : undefined}
    >
      <span style={{ color: theme.text, fontFamily: "'Outfit', sans-serif", fontSize: '68px', fontWeight: 700, letterSpacing: '-3px', lineHeight: 1 }}>
        {value || 0}
      </span>
      {label && (
        <span className="text-xs font-medium uppercase tracking-widest" style={{ color: theme.textMuted }}>{label}</span>
      )}
      {isClickable && (
        <div className="flex items-center gap-1 mt-1 px-2.5 py-1 rounded-full" style={{ backgroundColor: `${PRIMARY_BLUE}12` }}>
          <Info size={10} style={{ color: PRIMARY_BLUE }} />
          <span className="text-[10px] font-medium" style={{ color: PRIMARY_BLUE }}>Tap to view list</span>
        </div>
      )}
    </div>
  );
}

// ─── ENHANCED DONUT / PIE LEGEND ───
function ChartLegendRow({ name, value, color, icon, isClickable, onClick, theme }) {
  return (
    <div
      className={`flex items-center justify-between w-full gap-2 rounded-lg px-2 py-1.5 transition-colors ${isClickable ? 'cursor-pointer hover:opacity-75' : ''}`}
      onClick={isClickable ? onClick : undefined}
    >
      <div className="flex items-center gap-2 min-w-0">
        {icon || <div className="w-2.5 h-2.5 rounded-[3px] shrink-0" style={{ backgroundColor: color }} />}
        <span className="text-[14px] font-normal truncate" style={{ color: theme.textMuted }}>{name}</span>
      </div>
      <span className="text-[14px] font-semibold tabular-nums shrink-0" style={{ color: theme.text }}>{value}</span>
    </div>
  );
}

// ─── ENHANCED LIST / PROGRESS ROW ───
function ListProgressRow({ item, index, isClickable, onClick, showBar, maxVal, theme, colorFor, getOsPlatform, humanLabel, stat }) {
  const osPlatform = stat === 'stats_os_updates_all' ? getOsPlatform(stat, item.name, item.os) : null;
  const color = osPlatform ? OFFICIAL_OS_COLORS[osPlatform] : colorFor(stat, item.name, index);
  const pctMax = showBar ? (item.value / maxVal) * 100 : 0;

  return (
    <div
      className={`flex flex-col gap-1.5 px-2 py-2 rounded-lg transition-colors ${isClickable ? 'cursor-pointer hover:opacity-75' : ''}`}
      style={{ backgroundColor: 'transparent' }}
      onClick={isClickable ? onClick : undefined}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          {osPlatform ? (
            <div className="flex items-center justify-center shrink-0 w-5 h-5">
              <OsIcon platform={osPlatform} size={14} color={color} />
            </div>
          ) : (
            <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
          )}
          <span className="text-[14px] font-normal truncate" style={{ color: theme.textMuted }}>
            {stat === 'stats_models' && index === 0 ? <span className="font-medium" style={{ color: theme.textMuted }}>Most used · </span> : ''}
            {humanLabel(item.name)}
          </span>
        </div>
        <span className="text-[14px] font-semibold tabular-nums shrink-0" style={{ color: theme.text }}>{item.value}</span>
      </div>
      {showBar && (
        <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: `${color}20` }}>
          <div className="h-full rounded-full transition-all duration-700 ease-out" style={{ width: `${pctMax}%`, backgroundColor: color }} />
        </div>
      )}
    </div>
  );
}

// ─── ENHANCED EMPTY STATE ───
function EmptyChartState({ theme }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-2">
      <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ backgroundColor: `${theme.textMuted}15` }}>
        <Activity size={18} style={{ color: theme.textMuted }} />
      </div>
      <span className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: theme.textMuted }}>No Data</span>
    </div>
  );
}

// ─── ENHANCED LOADING STATE ───
function LoadingChartState() {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div className="w-6 h-6 border-2 rounded-full animate-spin" style={{ borderColor: `${PRIMARY_BLUE}30`, borderTopColor: PRIMARY_BLUE }} />
    </div>
  );
}

// ─── ENHANCED MODAL BACKDROP ───
function ModalBackdrop({ children, onClose }) {
  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {children}
    </div>
  );
}

// ─── ENHANCED MODAL SHELL ───
function ModalShell({ children, theme, maxWidth = 'max-w-lg', maxHeight = 'max-h-[85vh]' }) {
  return (
    <div
      className={`w-full ${maxWidth} rounded-2xl flex flex-col ${maxHeight} shadow-2xl`}
      style={{ backgroundColor: theme.card, border: `1px solid ${theme.border}` }}
    >
      {children}
    </div>
  );
}

// ─── ENHANCED MODAL HEADER ───
function ModalHeader({ title, subtitle, onClose, theme, icon: Icon, iconColor, iconBg }) {
  return (
    <div className="flex justify-between items-center px-6 py-5 border-b shrink-0" style={{ borderColor: theme.border }}>
      <div className="flex items-center gap-3">
        {Icon && (
          <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: iconBg || `${PRIMARY_BLUE}15`, color: iconColor || PRIMARY_BLUE }}>
            <Icon size={18} />
          </div>
        )}
        <div>
          <h2 className="text-lg font-bold leading-tight" style={{ color: theme.text }}>{title}</h2>
          {subtitle && <p className="text-xs mt-0.5" style={{ color: theme.textMuted }}>{subtitle}</p>}
        </div>
      </div>
      <button
        onClick={onClose}
        className="w-8 h-8 flex items-center justify-center rounded-full transition-colors hover:opacity-70"
        style={{ color: theme.textMuted, backgroundColor: `${theme.textMuted}12` }}
      >
        <X size={16} />
      </button>
    </div>
  );
}

// ─── ENHANCED MODAL LIST ITEM ───
function ModalListItem({ label, subLabel, icon, theme, onClick }) {
  return (
    <div
      onClick={onClick}
      className={`flex items-center justify-between rounded-xl px-4 py-3.5 transition-colors ${onClick ? 'cursor-pointer hover:opacity-80' : ''}`}
      style={{ backgroundColor: theme.bg, border: `1px solid ${theme.border}` }}
    >
      <div className="flex items-center gap-3.5">
        <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: `${PRIMARY_BLUE}14`, color: PRIMARY_BLUE }}>
          {icon}
        </div>
        <div className="flex flex-col min-w-0">
          <span className="text-sm font-medium truncate" style={{ color: theme.text }}>{label}</span>
          {subLabel && <span className="text-xs mt-0.5 uppercase tracking-wide" style={{ color: theme.textMuted }}>{subLabel}</span>}
        </div>
      </div>
      {onClick && <ChevronRight size={16} style={{ color: theme.textMuted }} />}
    </div>
  );
}

// ─── DATE RANGE PICKER DROPDOWN (image 3 style) ───────────────────────────────
const PRESETS = [
  { label: 'Today',        getRange: () => { const d = new Date(); const s = new Date(d.getFullYear(),d.getMonth(),d.getDate()); return { from: s, to: s }; } },
  { label: 'Yesterday',    getRange: () => { const d = new Date(); d.setDate(d.getDate()-1); const s = new Date(d.getFullYear(),d.getMonth(),d.getDate()); return { from: s, to: s }; } },
  { label: 'Last 7 Days',  getRange: () => { const to = new Date(); const from = new Date(); from.setDate(from.getDate()-6); return { from, to }; } },
  { label: 'Last 30 Days', getRange: () => { const to = new Date(); const from = new Date(); from.setDate(from.getDate()-29); return { from, to }; } },
  { label: 'This Month',   getRange: () => { const d = new Date(); return { from: new Date(d.getFullYear(),d.getMonth(),1), to: new Date() }; } },
  { label: 'Last Month',   getRange: () => { const d = new Date(); return { from: new Date(d.getFullYear(),d.getMonth()-1,1), to: new Date(d.getFullYear(),d.getMonth(),0) }; } },
  { label: 'Custom Range', getRange: null },
];

const DAYS = ['Su','Mo','Tu','We','Th','Fr','Sa'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function CalendarMonth({ year, month, from, to, hoverDate, onDayClick, onDayHover, primaryBlue, theme, isCustom }) {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prevDays = new Date(year, month, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push({ d: new Date(year, month-1, prevDays - firstDay + i + 1), outside: true });
  for (let d = 1; d <= daysInMonth; d++) cells.push({ d: new Date(year, month, d), outside: false });
  // fill to complete 6 rows
  const remaining = 42 - cells.length;
  for (let d = 1; d <= remaining; d++) cells.push({ d: new Date(year, month+1, d), outside: true });

  const sameDay = (a, b) => a && b && a.toDateString() === b.toDateString();
  const effectiveTo = (isCustom && !to && hoverDate) ? hoverDate : to;

  const inRange = (d) => {
    if (!from || !effectiveTo || sameDay(from, effectiveTo)) return false;
    const lo = from <= effectiveTo ? from : effectiveTo;
    const hi = from <= effectiveTo ? effectiveTo : from;
    return d > lo && d < hi;
  };
  const isStart = (d) => sameDay(d, from);
  const isEnd   = (d) => effectiveTo && sameDay(d, effectiveTo) && !sameDay(from, effectiveTo);
  const isSingle = (d) => sameDay(d, from) && sameDay(from, effectiveTo);

  return (
    <div style={{ minWidth: 260 }}>
      <div className="grid grid-cols-7 mb-1">
        {DAYS.map(d => (
          <div key={d} className="text-center py-1 text-xs font-semibold" style={{ color: theme.textMuted }}>{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map(({ d, outside }, i) => {
          const sel = isStart(d) || isEnd(d) || isSingle(d);
          const rng = inRange(d);
          const startCap = isStart(d) && !isSingle(d);
          const endCap = isEnd(d);
          return (
            <div
              key={i}
              onClick={() => !outside && onDayClick(d)}
              onMouseEnter={() => isCustom && onDayHover(d)}
              className="relative flex items-center justify-center select-none"
              style={{ height: 36, cursor: outside ? 'default' : 'pointer' }}
            >
              {/* Range fill strip */}
              {rng && !outside && (
                <div className="absolute inset-0" style={{ backgroundColor: `${primaryBlue}20` }} />
              )}
              {/* Half-strip for start cap (right half) */}
              {startCap && !outside && (
                <div className="absolute top-[3px] bottom-[3px] right-0 left-1/2" style={{ backgroundColor: `${primaryBlue}20` }} />
              )}
              {/* Half-strip for end cap (left half) */}
              {endCap && !outside && (
                <div className="absolute top-[3px] bottom-[3px] left-0 right-1/2" style={{ backgroundColor: `${primaryBlue}20` }} />
              )}
              <div
                className="relative z-[1] flex items-center justify-center rounded-full text-sm transition-colors"
                style={{
                  width: 34, height: 34,
                  backgroundColor: sel && !outside ? primaryBlue : 'transparent',
                  color: outside ? theme.textMuted + '55' : sel ? '#fff' : theme.text,
                  fontWeight: sel && !outside ? 700 : 400,
                  opacity: outside ? 0.35 : 1,
                }}
              >
                {d.getDate()}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DateRangePickerDropdown({ value, onApply, onCancel, theme, primaryBlue }) {
  // Internal pending state — only committed when Apply is clicked
  const [pendingFrom, setPendingFrom] = React.useState(value?.from || new Date());
  const [pendingTo,   setPendingTo]   = React.useState(value?.to   || new Date());
  const [activeLabel, setActiveLabel] = React.useState(value?.label || 'Last 30 Days');
  const [hoverDate,   setHoverDate]   = React.useState(null);
  const isCustom = activeLabel === 'Custom Range';

  // Calendar navigation: left month always shows the month containing pendingFrom
  const [leftYM, setLeftYM] = React.useState(() => {
    const d = value?.from || new Date();
    // Show prev month on left so both months are visible for ranges
    const m = d.getMonth() === 0 ? 11 : d.getMonth() - 1;
    const y = d.getMonth() === 0 ? d.getFullYear() - 1 : d.getFullYear();
    return { year: y, month: m };
  });
  const rightYM = React.useMemo(() => {
    const m = leftYM.month + 1;
    return m > 11 ? { year: leftYM.year + 1, month: 0 } : { year: leftYM.year, month: m };
  }, [leftYM]);

  const prevMonth = () => setLeftYM(p => p.month === 0 ? { year: p.year-1, month: 11 } : { ...p, month: p.month-1 });
  const nextMonth = () => setLeftYM(p => p.month === 11 ? { year: p.year+1, month: 0 } : { ...p, month: p.month+1 });

  const selectPreset = (preset) => {
    setActiveLabel(preset.label);
    if (preset.getRange) {
      const r = preset.getRange();
      setPendingFrom(r.from);
      setPendingTo(r.to);
      // Navigate calendar to show the range
      const m = r.from.getMonth() === 0 ? 11 : r.from.getMonth() - 1;
      const y = r.from.getMonth() === 0 ? r.from.getFullYear() - 1 : r.from.getFullYear();
      setLeftYM({ year: y, month: m });
    }
  };

  const handleDayClick = (d) => {
    // Clicking any calendar day switches to Custom Range automatically
    if (activeLabel !== 'Custom Range') {
      setActiveLabel('Custom Range');
      setPendingFrom(d);
      setPendingTo(null);
      return;
    }
    // In custom range: first click = start, second click = end
    if (!pendingFrom || pendingTo) {
      // Start fresh
      setPendingFrom(d); setPendingTo(null);
    } else {
      // Second click: set end
      if (d < pendingFrom) { setPendingTo(pendingFrom); setPendingFrom(d); }
      else { setPendingTo(d); }
    }
  };

  const fmt = (d) => d ? d.toLocaleDateString('en-GB', { day:'2-digit', month:'2-digit', year:'numeric' }) : '—';

  const calProps = { from: pendingFrom, to: pendingTo, hoverDate: pendingTo ? null : hoverDate, onDayClick: handleDayClick, onDayHover: setHoverDate, primaryBlue, theme, isCustom: true };

  return (
    <div className="absolute right-0 top-full mt-2 z-[300] rounded-2xl shadow-2xl border overflow-hidden flex"
      style={{ backgroundColor: theme.card, borderColor: theme.border }}>

      {/* LEFT: preset list */}
      <div className="flex flex-col py-4 border-r" style={{ borderColor: theme.border, minWidth: 160 }}>
        {PRESETS.map(p => {
          const active = activeLabel === p.label;
          return (
            <button
              key={p.label}
              onClick={() => selectPreset(p)}
              className="px-5 py-2.5 text-left text-sm transition-all hover:opacity-80"
              style={{
                color: active ? primaryBlue : theme.text,
                fontWeight: active ? 600 : 400,
                backgroundColor: active ? `${primaryBlue}10` : 'transparent',
                borderLeft: active ? `3px solid ${primaryBlue}` : '3px solid transparent',
              }}
            >{p.label}</button>
          );
        })}
      </div>

      {/* RIGHT: always-visible dual calendar + footer */}
      <div className="flex flex-col p-5 gap-4">
        {/* Month headers + grids */}
        <div className="flex gap-6 items-start">
          {/* Left month */}
          <div>
            <div className="flex items-center justify-between mb-3 gap-4">
              <button onClick={prevMonth} className="w-7 h-7 flex items-center justify-center rounded-lg hover:opacity-60 text-lg font-light transition-opacity" style={{ color: theme.text }}>‹</button>
              <span className="text-sm font-semibold" style={{ color: theme.text }}>{MONTHS[leftYM.month]} {leftYM.year}</span>
              <div className="w-7" />
            </div>
            <CalendarMonth {...leftYM} {...calProps} />
          </div>
          {/* Right month */}
          <div>
            <div className="flex items-center justify-between mb-3 gap-4">
              <div className="w-7" />
              <span className="text-sm font-semibold" style={{ color: theme.text }}>{MONTHS[rightYM.month]} {rightYM.year}</span>
              <button onClick={nextMonth} className="w-7 h-7 flex items-center justify-center rounded-lg hover:opacity-60 text-lg font-light transition-opacity" style={{ color: theme.text }}>›</button>
            </div>
            <CalendarMonth {...rightYM} {...calProps} />
          </div>
        </div>

        {/* Footer: date range display + Cancel + Apply */}
        <div className="flex items-center justify-between border-t pt-4 gap-6" style={{ borderColor: theme.border }}>
          <span className="text-sm tabular-nums" style={{ color: theme.textMuted }}>
            {fmt(pendingFrom)}{pendingFrom && ' – '}{fmt(pendingTo)}
          </span>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={onCancel}
              className="px-4 py-2 rounded-lg text-sm font-medium border transition-colors hover:opacity-70"
              style={{ color: theme.textMuted, borderColor: theme.border }}
            >Cancel</button>
            <button
              onClick={() => {
                if (pendingFrom) {
                  onApply({ label: activeLabel, from: pendingFrom, to: pendingTo || pendingFrom });
                }
              }}
              className="px-6 py-2 rounded-lg text-sm font-semibold text-white transition-colors hover:opacity-90 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2"
              style={{ backgroundColor: primaryBlue }}
              disabled={!pendingFrom}
            >Apply</button>
          </div>
        </div>
      </div>
    </div>
  );
}


// ─── BAR WIDGET — same React state hover as DonutPieWidget ───
function BarWidget({ widget, chartData, activeTheme, isClickable, handleChartClick, _colorFor, _humanLabel }) {
  // UX designer spec: per-item color, borderRadius:4, borderWidth:0, barMaxWidth:40
  // Hover: hovered bar brightens slightly, others fade — native ECharts focus:'self'
  // No ghost series — single clean series, ECharts handles blur natively.

  const bars = chartData.map((d, i) => ({
    name: _humanLabel(d.name),
    value: d.value,
    color: _colorFor(widget.stat, d.name, i),
  }));

  // Lighten a hex color by mixing with white — used for hover brightness effect
  const brighten = (hex, amount = 0.18) => {
    if (!hex || !hex.startsWith('#')) return hex;
    const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
    const mix = (c) => Math.min(255, Math.round(c + (255 - c) * amount));
    return `#${mix(r).toString(16).padStart(2,'0')}${mix(g).toString(16).padStart(2,'0')}${mix(b).toString(16).padStart(2,'0')}`;
  };

  const option = {
    backgroundColor: 'transparent',
    tooltip: makeTooltipFormatter(activeTheme),
    grid: { top: 16, bottom: 36, left: 44, right: 12 },
    xAxis: {
      type: 'category',
      data: bars.map(b => b.name),
      axisLabel: { color: activeTheme.textMuted, fontSize: 11, fontFamily: 'Outfit, sans-serif' },
      axisLine: { show: false },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: activeTheme.gridLine } },
      axisLabel: { color: activeTheme.textMuted, fontSize: 11, fontFamily: 'Outfit, sans-serif' },
      axisLine: { show: false },
      axisTick: { show: false },
    },
    series: [{
      type: 'bar',
      barMaxWidth: 40,
      // Native ECharts focus/blur — hovered bar stays solid, others fade to 0.25
      emphasis: { focus: 'self', blurScope: 'global', scale: false },
      blur: { itemStyle: { opacity: 0.25 } },
      data: bars.map(b => ({
        value: b.value,
        itemStyle: { color: b.color, borderRadius: [4, 4, 0, 0], borderWidth: 0 },
        emphasis: {
          itemStyle: {
            color: brighten(b.color, 0.18),  // slight brightness lift on hover
            borderRadius: [4, 4, 0, 0],
            borderWidth: 0,
          },
        },
        blur: { itemStyle: { color: b.color, opacity: 0.25, borderWidth: 0 } },
      })),
    }],
  };

  return (
    <div className="h-full w-full" style={{ cursor: isClickable ? 'pointer' : 'default' }}>
      <ReactECharts
        opts={{ renderer: 'svg' }}
        option={option}
        onEvents={{ click: () => { if (isClickable) handleChartClick(widget); } }}
        style={{ height: '100%', width: '100%' }}
        notMerge={true}
      />
    </div>
  );
}

// ─── DONUT / PIE WIDGET — React state drives hover, no dispatchAction chaos ───
function DonutPieWidget({ widget, chartData, isDonut, total, activeTheme, isClickable, handleChartClick, _colorFor, _humanLabel }) {
  const [hovIdx, setHovIdx] = React.useState(-1);

  const slices = chartData.map((d, i) => ({
    name: _humanLabel(d.name),
    value: d.value,
    color: _colorFor(widget.stat, d.name, i),
  }));

  const outerR = isDonut ? '78%' : '78%';
  const innerR = isDonut ? '59%' : '0%';

  // Build option based on hovIdx:
  // hovIdx === -1: normal state, all solid
  // hovIdx === i:  ghost[i] grown, solid[i] full opacity, solid[j≠i] faded
  const buildOption = () => {
    const ghostData = slices.map((d, i) => ({
      name: d.name,
      value: d.value,
      itemStyle: {
        color: d.color,
        opacity: hovIdx === -1 ? 0.38        // normal: hidden behind solid
               : hovIdx === i  ? 0.38        // hovered: visible (grows via emphasis)
               : 0,                          // others: invisible
        borderWidth: 0,
      },
    }));

    const solidData = slices.map((d, i) => ({
      name: d.name,
      value: d.value,
      itemStyle: {
        color: d.color,
        opacity: hovIdx === -1 ? 1           // normal: fully solid
               : hovIdx === i  ? 1           // hovered: stays solid
               : 0.15,                       // others: faded
        borderWidth: 0,
      },
    }));

    return {
      backgroundColor: 'transparent',
      tooltip: makeTooltipFormatter(activeTheme),
      legend: { show: false },
      series: [
        // GHOST series (index 0): event source, grows on hover
        {
          type: 'pie', z: 1, silent: false,
          radius: [innerR, outerR], center: ['50%', '50%'],
          itemStyle: { borderWidth: 0, borderColor: 'transparent' },
          label: { show: false },
          emphasis: { scale: hovIdx !== -1, scaleSize: 10, itemStyle: { borderWidth: 0 } },
          data: ghostData,
        },
        // SOLID series (index 1): silent visual, opacity controlled by React state
        {
          type: 'pie', z: 2, silent: true,
          radius: [innerR, outerR], center: ['50%', '50%'],
          itemStyle: { borderWidth: 0, borderColor: 'transparent' },
          label: { show: false },
          emphasis: { scale: false, itemStyle: { borderWidth: 0 } },
          data: solidData,
        },
      ],
      graphic: isDonut ? [{
        type: 'group', left: 'center', top: 'center',
        children: [
          { type: 'text', style: { text: total.toString(), font: `700 28px Outfit, sans-serif`, fill: activeTheme.text, textAlign: 'center', y: -14 } },
          { type: 'text', style: { text: 'Total', font: `400 11px Outfit, sans-serif`, fill: activeTheme.textMuted, textAlign: 'center', y: 22 } },
        ],
      }] : [],
    };
  };

  return (
    <div className="flex h-full w-full items-center gap-2 pb-1 overflow-hidden">
      <div className="relative flex items-center justify-center shrink-0" style={{ flex: '0 0 52%', height: '100%', minHeight: 80 }}>
        <ReactECharts
          opts={{ renderer: 'svg' }}
          option={buildOption()}
          onEvents={{
            click: (e) => { if (isClickable) handleChartClick(widget, e.name); },
            mouseover: (params) => {
              if (params.seriesIndex === 0) setHovIdx(params.dataIndex);
            },
            mouseout: (params) => {
              if (params.seriesIndex === 0) setHovIdx(-1);
            },
          }}
          style={{ height: '100%', width: '100%', minHeight: '80px', cursor: isClickable ? 'pointer' : 'default' }}
          notMerge={false}
        />
      </div>
      <div className="flex flex-col justify-center gap-1 overflow-hidden" style={{ flex: '1 1 48%', minWidth: 0 }}>
        {slices.map((d, i) => (
          <div
            key={i}
            className={`flex items-center justify-between w-full gap-1.5 rounded-lg px-1 py-0.5 ${isClickable ? 'cursor-pointer' : ''}`}
            style={{ opacity: hovIdx === -1 ? 1 : hovIdx === i ? 1 : 0.25, transition: 'opacity 0.15s ease' }}
            onClick={isClickable ? () => handleChartClick(widget, d.name) : undefined}
          >
            <div className="flex items-center gap-1.5 min-w-0 overflow-hidden">
              <div className="w-2.5 h-2.5 rounded-[3px] shrink-0" style={{ backgroundColor: d.color }} />
              <span className="text-[13px] font-normal truncate" style={{ color: activeTheme.textMuted }}>{d.name}</span>
            </div>
            <span className="text-[13px] font-semibold tabular-nums shrink-0" style={{ color: activeTheme.text }}>{d.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── WIDGET INFO MODAL ───────────────────────────────────────────────────────
// Mirrors the UX designer's MetricsInfoModal: compact chart, legend, summary
// table from snapshot history, description, and "How is it calculated?" section.

const WIDGET_DESCRIPTIONS = {
  stats_devices_os:      { label: 'Devices by OS', summary: 'OS distribution', desc: 'Shows the breakdown of enrolled devices across operating systems. Distribution helps plan platform-specific policies and resource allocation.' },
  mdm_devices:           { label: 'Total Devices', summary: 'Total devices', desc: 'Total count of all enrolled devices in your MDM fleet. Tracks growth over time and gives a snapshot of your managed endpoint estate.' },
  stats_devices_status:  { label: 'Device Status', summary: 'Active devices', desc: 'Tracks the operational state (Active, Inactive, Disabled) of all registered devices. Helps identify devices that may need attention or decommissioning.' },
  stats_compliance:      { label: 'Compliance Status', summary: 'Compliant devices', desc: 'Measures how many devices meet your organisation\'s security policies. Non-compliant devices may be missing patches, configurations, or required apps.' },
  stats_battery:         { label: 'Battery Levels', summary: 'Battery health', desc: 'Distribution of device battery levels across the fleet. Low battery devices may impact productivity; this metric helps plan charging station or battery replacement strategies.' },
  stats_models:          { label: 'Device Models', summary: 'Model distribution', desc: 'Shows which hardware models are most common in your fleet. Useful for planning app compatibility, hardware refresh cycles, and support coverage.' },
  stats_os_updates_all:  { label: 'OS Updates', summary: 'Pending updates', desc: 'Devices with available OS updates that have not yet been applied. Keeping OS versions current reduces security vulnerabilities across the fleet.' },
  stats_os_versions:     { label: 'OS Versions', summary: 'Version distribution', desc: 'Breakdown of specific OS versions installed across your fleet. Version fragmentation can create compatibility and security risks.' },
  stats_sync_errors:     { label: 'Sync Failures', summary: 'Sync errors', desc: 'Devices experiencing synchronisation failures with the MDM server. Persistent sync errors may indicate connectivity issues or misconfigured policies.' },
  stats_devices_trend:   { label: 'Enrollment Trend', summary: 'New enrollments', desc: 'Shows device enrollment volume over the selected period. Enrollment spikes may correlate with onboarding campaigns or hardware refreshes.' },
  mdm_users:             { label: 'Device Employees', summary: 'Total users', desc: 'Total MDM users with enrolled devices. Tracks headcount and helps align device-to-user ratios across departments.' },
  mdm_collaborators:     { label: 'UEM Collaborators', summary: 'Collaborators', desc: 'Dashboard collaborators with access to UEM management features. Monitoring access helps maintain security and access governance.' },
  mdm_segments:          { label: 'Segments', summary: 'Segment count', desc: 'Organisational segments used to scope device policies and visibility. Segments help manage large fleets by grouping devices by department, location, or function.' },
  app_dist_apps:         { label: 'Enterprise Apps', summary: 'Total apps', desc: 'Enterprise apps distributed via the App Distribution platform. Tracks app portfolio size and platform coverage across iOS, Android, and Windows.' },
  stats_builds_os:       { label: 'Builds by OS', summary: 'Build distribution', desc: 'Distribution of app build uploads by operating system. Helps understand where build activity is concentrated and plan testing resources.' },
  stats_downloads_trend: { label: 'Downloads Trend', summary: 'Total downloads', desc: 'App download volume over the selected period. Tracks adoption rates and helps identify periods of high distribution activity.' },
  stats_builds_trend:    { label: 'Builds Trend', summary: 'Total builds', desc: 'App build upload volume over the selected period. Correlates with release cycles and development team activity.' },
  app_dist_store_users:  { label: 'Store Users', summary: 'Total employees', desc: 'Employees with access to the App Store. Monitors store adoption and helps manage licence entitlements across the organisation.' },
  app_dist_collaborators:{ label: 'Store Collaborators', summary: 'Collaborators', desc: 'Users with collaborator access to the App Distribution platform. Reviewing this list ensures access is appropriately scoped.' },
  stats_collaborators:   { label: 'Collaborator Roles', summary: 'Role distribution', desc: 'Breakdown of collaborator access levels (Owner, Admin, Editor, Viewer). Helps enforce least-privilege access policies.' },
  org_profile:           { label: 'Organisation', summary: 'Profile', desc: 'Your Applivery organisation profile including workspace name, plan details, and configuration status.' },
  compliance_policies_summary:   { label: 'Compliance Policies', summary: 'Total policies', desc: 'Total Compliance Policies configured in this SOAR system, split by enabled vs. disabled. Tracks how much of your fleet is actively governed by automated compliance checks.' },
  compliance_devices_violating:  { label: 'Devices in Violation', summary: 'Devices out of compliance', desc: 'Devices currently failing at least one Compliance Policy, right now, versus the rest of the fleet. Cleared automatically the moment a device recovers.' },
  compliance_violations_by_policy:{ label: 'Violations by Policy', summary: 'Active violations', desc: 'Currently-violating devices broken down by which Compliance Policy they\'re failing. Highlights which policies are catching the most non-compliance.' },
  compliance_violations_trend:   { label: 'Violations Trend', summary: 'Violations detected', desc: 'Volume of new Compliance Policy violations detected over the selected period. Spikes can flag a rollout gone wrong, a policy that\'s too strict, or a real fleet-wide drift.' },
  compliance_review_queue:       { label: 'Review Queue Status', summary: 'Queue breakdown', desc: 'Current violations broken down by handling status — auto-fired, pending manual review, or lacking a linked workflow. Helps size the manual review workload.' },
  autorun_safety_summary:        { label: 'autoRun Safety', summary: 'Safety interventions', desc: 'How much of autoRun\'s recent activity was a normal auto-fire versus the blast-radius cap or circuit breaker stepping in. A rising "Blocked"/"Capped" share is worth investigating — it usually means a policy or its linked workflow needs attention.' },
  compliance_framework_coverage: { label: 'Compliance Framework Coverage', summary: 'Avg. coverage across frameworks', desc: 'For each of ISO 27001, ENS, and NIS2: what share of that framework\'s device-level controls (from Compliance Policy Templates) currently has an enabled policy enforcing it in this workspace. A control with no matching policy counts as 0% covered — this is meant to surface gaps, not just celebrate progress.' },
  iso27001_compliance_status:    { label: 'ISO 27001 Compliance Status', summary: 'Devices violating an ISO 27001 control', desc: 'Every ISO/IEC 27001:2022 control this app has a template for (Annex A.8.1 endpoint controls, A.8.7 malware protection, A.8.24 cryptography), broken down by how many devices are currently violating it. Only counts policies created from an ISO 27001 template and still tagged to it — see Compliance > New from Template. Covers only the device-configuration slice of ISO 27001; certification also requires an ISMS with no device-policy equivalent.' },
  ens_compliance_status:         { label: 'ENS Compliance Status (mp.eq)', summary: 'Devices violating an ENS control', desc: 'Every Esquema Nacional de Seguridad mp.eq (equipment protection) control this app has a template for — encryption, screen lock, incident-reporting timeliness — broken down by how many devices are currently violating it. Only counts policies created from an ENS template and still tagged to it. Some controls are only mandatory at categoría alta; confirm against your declared ENS category.' },
  nis2_compliance_status:        { label: 'NIS2 Compliance Status (Art. 21)', summary: 'Devices violating a NIS2 control', desc: 'Every NIS2 Directive Article 21(2) cyber-hygiene control this app has a template for — device configuration, vulnerability handling, cryptography, asset visibility — broken down by how many devices are currently violating it. Only counts policies created from a NIS2 template and still tagged to it. Article 21 also covers organizational measures (supply-chain security, incident procedures, governance) with no device-policy equivalent.' },
  cases_summary:                 { label: 'Cases', summary: 'Open cases', desc: 'All Cases broken down by status. The scorecard counts only Open/Investigating — the ones still needing attention.' },
  cases_by_severity:             { label: 'Open Cases by Severity', summary: 'Open cases', desc: 'Currently open Cases broken down by severity — Low through Critical. Shows where analyst attention is most needed right now.' },
  cases_by_source:                { label: 'Cases by Source', summary: 'Total cases', desc: 'Every Case broken down by how it was opened — manually by an analyst, from a Compliance Policy violation, or from an Inbound Webhook Trigger. Shows which entry point is actually generating the workload.' },
  cases_trend:                   { label: 'Cases Opened Trend', summary: 'Cases opened', desc: 'Volume of new Cases opened over the selected period, across every source. Spikes can flag a bad policy rollout, a noisy integration, or a real incident.' },
  cases_sla_summary:             { label: 'Case SLA Status', summary: 'Cases breached', desc: 'Every open Case bucketed by SLA state — on track, acknowledge overdue, or resolve overdue — against the per-severity thresholds configured under Settings > Case SLA. A case breached on both clocks counts under the more severe (resolve) bucket.' },
  cases_mttr_trend:              { label: 'Case MTTR Trend', summary: 'Avg hours to resolve', desc: 'Average time (in hours) from a Case opening to closing, grouped by the day it closed. A rising trend is the earliest signal that response capacity is falling behind volume.' },
  applivery_events_by_type:      { label: 'Applivery Events by Type', summary: 'Events received', desc: 'Breakdown of Applivery\'s own native webhook events (device enrolled, MDM user changed, builds, bug/feedback reports, certificate expiry, and anything new Applivery adds) by event type. Reflects the last 50 events received — the same rolling window Settings > Applivery Events shows.' },
  applivery_events_trend:        { label: 'Applivery Events Trend', summary: 'Events received', desc: 'Daily volume of Applivery native webhook events received over the selected period. Reflects only the last 50 events received, so a very active workspace may not show the full period.' },
  applivery_automation_outcomes: { label: 'Applivery Automation Outcomes', summary: 'Events received', desc: 'What actually happened when each Applivery event arrived — logged only, opened a Case, fired a Workflow, or got blocked pending a destructive-action acknowledgment. The fastest way to see whether Applivery Event rules are configured the way you expect.' },
  system_health_summary:         { label: 'System Health', summary: 'Jobs needing attention', desc: 'Every background job in this app (Compliance evaluation, ticketing sync, Case SLA monitoring, scheduled reports, and more) bucketed by Healthy / Overdue / Erroring. Global across every workspace — matches Settings > System Health exactly, since it reads the same heartbeat registry.' },
  os_updates_catalog_summary:    { label: 'OS Update Catalog', summary: 'Known updates', desc: 'Every Windows security update in the MSRC-sourced catalog (Settings > OS Updates), bucketed by severity. Foundation-phase, Windows only — a version-gap signal, not yet a vulnerability score.' },
  os_updates_device_status_summary: { label: 'OS Update Device Status', summary: 'Devices behind', desc: 'Your Windows fleet bucketed by patch status against the OS Update Catalog: up to date, confirmed behind, or possibly behind (unconfirmed build match). Foundation-phase — not yet wired into Compliance Policies or risk scoring.' },
  vuln_catalog_summary:          { label: 'Apple/Android Vulnerability Catalog', summary: 'Known CVEs', desc: 'Every Apple (iOS/iPadOS, macOS) and Android CVE in the ENISA EUVD-sourced catalog (Settings > Vulnerability Catalog), bucketed by severity. Foundation-phase — a version-gap signal, not yet wired into Compliance Policies or risk scoring.' },
  vuln_device_status_summary:    { label: 'Apple/Android Vulnerability Device Status', summary: 'Devices behind', desc: 'Your Apple and Android fleet bucketed by CVE exposure against the Vulnerability Catalog: up to date, confirmed behind, or possibly behind (Android’s coarser major-version-only comparison). Foundation-phase — not yet wired into Compliance Policies or risk scoring.' },
  vuln_service_device_status_summary: { label: 'Vulnerability Service Device Status', summary: 'Devices with CVEs', desc: 'Your fleet bucketed by CVE exposure against your org\'s Vulnerability Service integration (Settings > Vulnerability Service): known-exploited (CISA KEV), critical/high, medium/low only, or clean. Covers all 4 platforms and both OS + installed apps — independent of, and additive to, the EUVD-based Vulnerability Device Status above. Only shows devices actually checked; requires the integration to be enabled.' },
  os_lifecycle_summary:          { label: 'OS Lifecycle Catalog', summary: 'Version trains', desc: 'Every tracked Windows, iOS/iPadOS, macOS, and Android version train (Settings > OS Lifecycle) bucketed by support status — Maintained, End of life, or Unknown. Sourced from endoflife.date.' },
  os_lifecycle_device_status_summary: { label: 'OS Lifecycle Device Status', summary: 'Devices on EOL OS', desc: 'Your whole fleet (all 4 platforms) bucketed by whether its OS version still receives security support: Supported, End of life, or Unknown. The one signal that catches a device with zero pending CVEs simply because it’s never been checked, not because it’s current.' },
  apple_app_updates_summary:     { label: 'Apple App Updates', summary: 'Apps with an update available', desc: 'Pending app updates across your Apple/macOS fleet (Settings > App Updates), sourced from Applivery\'s own HasUpdateAvailable signal per app — Apple\'s App Store/VPP metadata, not a version comparison we compute. Windows/Android aren\'t covered, since Applivery reports no equivalent field for them.' },
  triggers_summary:              { label: 'Inbound Trigger Fires', summary: 'Total fires', desc: 'Every Inbound Webhook Trigger (the open-ended 3rd-party channel — EDR, MTD, DEX, SIEM, or anything else that can POST JSON to a URL) broken down by fire count. Lifetime counts per trigger, not limited to the selected date range.' },
  triggers_fired_trend:          { label: 'Inbound Trigger Fires Trend', summary: 'Fires', desc: 'Daily volume of Inbound Webhook Trigger firings across every configured 3rd-party integration, from the Audit Log. A spike here usually means a specific EDR/MTD/DEX tool just got noisy — cross-check Settings > Inbound Webhooks.' },
  workflow_runs_summary:         { label: 'Workflow Runs', summary: 'Total runs', desc: 'Every recorded Workflow run — manual, autoRun, Inbound Trigger, or Case Auto-Run Rule — broken down by outcome (completed, partial, failed) or still in progress.' },
  workflow_runs_trend:           { label: 'Workflow Runs Trend', summary: 'Runs started', desc: 'Volume of Workflow runs started over the selected period, regardless of how they were triggered. Useful for spotting an automation that\'s firing far more (or less) than expected.' },
  device_risk_distribution:      { label: 'Device Risk Distribution', summary: 'Devices by risk tier', desc: 'The live fleet broken down by risk tier (Low/Medium/High/Critical), computed from each device\'s security attestation, open Cases, and active violations. A point-in-time snapshot — see Device Risk Trend for how it moves over time.' },
  device_risk_trend:             { label: 'Device Risk Trend', summary: 'Avg. risk score', desc: 'The fleet\'s average risk score over time, read from the daily risk snapshot. Answers "is the fleet trending safer or riskier", which a single point-in-time view can\'t show.' },
  mitre_coverage:                { label: 'MITRE ATT&CK Coverage', summary: 'Techniques covered', desc: 'How many MITRE ATT&CK Enterprise techniques are mapped to at least one Compliance Policy or Case, out of the full catalog. A coverage gauge, not a detection-quality measure.' },
  threat_intel_summary:          { label: 'Threat Intel Verdicts', summary: 'IOCs checked', desc: 'Every IOC lookup ever recorded on a Case, broken down by verdict (malicious/suspicious/clean/unknown), across manual and auto-enrichment checks alike.' },
  ticketing_summary:             { label: 'Ticketing Sync', summary: 'Linked tickets', desc: 'Every Jira/ServiceNow ticket a Case has ever linked, and how many the inbound sync loop has confirmed are resolved on the ticket system\'s own side.' },
};

function WidgetInfoModal({ widget, dataBlock, overviewDateRange, activeTheme, primaryBlue, colorFor, humanLabel, onClose }) {
  const info = WIDGET_DESCRIPTIONS[widget?.stat] || { label: widget?.title || '', summary: 'Total', desc: 'Widget data from Applivery.' };
  const chartData  = dataBlock?.chartData  || [];
  const trendData  = dataBlock?.trendData;
  const items      = dataBlock?.items      || [];
  const scorecardValue = dataBlock?.scorecardValue || 0;

  const type = widget?.type || '';
  const isDonut     = type === 'donut';
  const isPie       = type === 'pie';
  const isBar       = type === 'bar';
  const isLine      = type === 'line';
  const isGauge     = type === 'gauge';
  const isRadar     = type === 'radar';
  const isList      = type === 'list';
  const isProgress  = type === 'progress';
  const isScorecard = type === 'scorecard';
  const isGlobe     = type === 'globe';

  const [hovIdx, setHovIdx] = React.useState(-1);
  const total = chartData.reduce((a, c) => a + (c.value || 0), 0);
  const fmtDate = (d) => d ? d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

  const brighten = (hex, amt = 0.18) => {
    if (!hex || !hex.startsWith('#')) return hex;
    const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
    const mix = c => Math.min(255, Math.round(c + (255-c)*amt));
    return `#${mix(r).toString(16).padStart(2,'0')}${mix(g).toString(16).padStart(2,'0')}${mix(b).toString(16).padStart(2,'0')}`;
  };

  const tooltipBase = { backgroundColor: activeTheme.card, borderColor: activeTheme.border, textStyle: { color: activeTheme.text, fontFamily: 'Outfit, sans-serif', fontSize: 12 } };
  const axisLabelStyle = { color: activeTheme.textMuted, fontSize: 11, fontFamily: 'Outfit, sans-serif' };

  // ── Donut / Pie — identical ghost+solid two-series as live DonutPieWidget ──
  const buildDonutOption = () => {
    const outerR = '72%'; const innerR = isDonut ? '54%' : '0%';
    const slices = chartData.map((d, i) => ({ name: humanLabel(d.name), value: d.value, color: colorFor(widget.stat, d.name, i) }));
    return {
      backgroundColor: 'transparent',
      tooltip: { trigger: 'item', formatter: '{b}: <b>{c}</b> ({d}%)', ...tooltipBase },
      legend: { show: false },
      series: [
        { type: 'pie', z: 1, silent: false, radius: [innerR, outerR], center: ['50%','50%'],
          label: { show: false }, emphasis: { scale: hovIdx !== -1, scaleSize: 10, itemStyle: { borderWidth: 0 } },
          data: slices.map((d,i) => ({ name: d.name, value: d.value,
            itemStyle: { color: d.color, opacity: hovIdx === -1 ? 0.38 : hovIdx === i ? 0.38 : 0, borderWidth: 0 } })) },
        { type: 'pie', z: 2, silent: true, radius: [innerR, outerR], center: ['50%','50%'],
          label: { show: false }, emphasis: { scale: false, itemStyle: { borderWidth: 0 } },
          data: slices.map((d,i) => ({ name: d.name, value: d.value,
            itemStyle: { color: d.color, opacity: hovIdx === -1 ? 1 : hovIdx === i ? 1 : 0.15, borderWidth: 0 } })) },
      ],
      graphic: isDonut ? [{ type: 'group', left: 'center', top: 'center', children: [
        { type: 'text', style: { text: total.toLocaleString(), font: `700 32px Outfit,sans-serif`, fill: activeTheme.text, textAlign: 'center', y: -16 } },
        { type: 'text', style: { text: 'Total', font: `400 13px Outfit,sans-serif`, fill: activeTheme.textMuted, textAlign: 'center', y: 22 } },
      ]}] : [],
    };
  };

  // ── Bar — identical single-series + focus/blur as live BarWidget ──
  const buildBarOption = () => ({
    backgroundColor: 'transparent',
    tooltip: { trigger: 'item', ...tooltipBase },
    legend: { show: false },
    grid: { top: 12, bottom: 40, left: 48, right: 16 },
    xAxis: { type: 'category', data: chartData.map(d => humanLabel(d.name)), axisLabel: axisLabelStyle, axisLine: { show: false }, axisTick: { show: false } },
    yAxis: { type: 'value', axisLabel: axisLabelStyle, splitLine: { lineStyle: { color: activeTheme.gridLine } }, axisLine: { show: false }, axisTick: { show: false } },
    series: [{ type: 'bar', barMaxWidth: 40,
      emphasis: { focus: 'self', blurScope: 'global', scale: false },
      blur: { itemStyle: { opacity: 0.25 } },
      data: chartData.map((d, i) => {
        const color = colorFor(widget.stat, d.name, i);
        return { value: d.value,
          itemStyle: { color, borderRadius: [4,4,0,0], borderWidth: 0 },
          emphasis: { itemStyle: { color: brighten(color), borderRadius: [4,4,0,0], borderWidth: 0 } },
          blur: { itemStyle: { color, opacity: 0.25, borderWidth: 0 } } };
      }),
    }],
  });

  // ── Line / trend ──
  const buildLineOption = () => ({
    backgroundColor: 'transparent',
    tooltip: { trigger: 'axis', ...tooltipBase },
    legend: { show: false },
    grid: { top: 12, bottom: 40, left: 48, right: 16 },
    xAxis: { type: 'category', data: trendData?.labels || [], axisLabel: axisLabelStyle, axisLine: { show: false }, axisTick: { show: false } },
    yAxis: { type: 'value', axisLabel: axisLabelStyle, splitLine: { lineStyle: { color: activeTheme.gridLine } }, axisLine: { show: false }, axisTick: { show: false } },
    series: [{ type: 'line', smooth: true, data: trendData?.series || [],
      itemStyle: { color: primaryBlue }, lineStyle: { color: primaryBlue, width: 2.5 },
      areaStyle: { color: `${primaryBlue}18` }, symbol: 'circle', symbolSize: 6,
      emphasis: { itemStyle: { borderWidth: 2, borderColor: primaryBlue, color: '#fff' } } }],
  });

  // ── Gauge — same as live gauge widget ──
  const buildGaugeOption = () => {
    const primaryItem = chartData[0];
    const val = total > 0 ? Math.round((primaryItem.value / total) * 100) : 0;
    const color = colorFor(widget.stat, primaryItem.name, 0);
    return {
      backgroundColor: 'transparent',
      series: [{ type: 'gauge', startAngle: 180, endAngle: 0, min: 0, max: 100,
        pointer: { show: false },
        progress: { show: true, overlap: false, roundCap: true, clip: false, itemStyle: { color, borderWidth: 0 } },
        axisLine: { lineStyle: { width: 18, color: [[1, activeTheme.border]] } },
        splitLine: { show: false }, axisTick: { show: false }, axisLabel: { show: false },
        data: [{ value: val, name: humanLabel(primaryItem.name) }],
        title: { fontSize: 14, color: activeTheme.textMuted, offsetCenter: [0,'30%'], fontFamily: 'Outfit,sans-serif' },
        detail: { fontSize: 36, color: activeTheme.text, fontWeight: 'bold', offsetCenter: [0,'-5%'], formatter: '{value}%', fontFamily: 'Outfit,sans-serif' },
      }],
    };
  };

  // ── Radar ──
  const buildRadarOption = () => {
    const maxVal = Math.max(...chartData.map(d => d.value)) * 1.2 || 10;
    return {
      backgroundColor: 'transparent',
      tooltip: { trigger: 'item', ...tooltipBase },
      radar: { indicator: chartData.map(d => ({ name: humanLabel(d.name), max: maxVal })),
        radius: '65%', axisName: { color: activeTheme.textMuted, fontSize: 11, fontFamily: 'Outfit,sans-serif' },
        splitLine: { lineStyle: { color: activeTheme.gridLine } },
        splitArea: { show: false }, axisLine: { lineStyle: { color: activeTheme.border } } },
      series: [{ type: 'radar', data: [{ value: chartData.map(d => d.value), name: widget.title,
        areaStyle: { color: `${primaryBlue}40` }, lineStyle: { color: primaryBlue, width: 2 },
        itemStyle: { color: primaryBlue, borderColor: `${primaryBlue}40`, borderWidth: 5 },
        emphasis: { itemStyle: { color: primaryBlue, borderWidth: 8 }, lineStyle: { width: 3 } } }] }],
    };
  };

  // ── List / Progress — horizontal bar chart representation ──
  const buildListOption = () => {
    const maxVal = Math.max(...chartData.map(d => d.value)) || 1;
    return {
      backgroundColor: 'transparent',
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, ...tooltipBase },
      legend: { show: false },
      grid: { top: 8, bottom: 8, left: 8, right: 60, containLabel: true },
      xAxis: { type: 'value', show: false },
      yAxis: { type: 'category', data: chartData.map(d => humanLabel(d.name)).reverse(),
        axisLabel: { color: activeTheme.textMuted, fontSize: 11, fontFamily: 'Outfit,sans-serif' },
        axisLine: { show: false }, axisTick: { show: false } },
      series: [{ type: 'bar', barMaxWidth: 16,
        emphasis: { focus: 'self', blurScope: 'global' },
        blur: { itemStyle: { opacity: 0.25 } },
        label: { show: true, position: 'right', color: activeTheme.textMuted, fontSize: 11, fontFamily: 'Outfit,sans-serif', formatter: '{c}' },
        data: chartData.map((d, i) => {
          const color = colorFor(widget.stat, d.name, i);
          return { value: d.value,
            itemStyle: { color, borderRadius: [0,4,4,0], borderWidth: 0 },
            emphasis: { itemStyle: { color: brighten(color), borderRadius: [0,4,4,0] } },
            blur: { itemStyle: { color, opacity: 0.25 } } };
        }).reverse(),
      }],
    };
  };

  // Decide what to show
  const hasDonutPie = (isDonut || isPie) && chartData.length > 0;
  const hasBar      = isBar && chartData.length > 0;
  const hasLine     = isLine && trendData?.series?.length > 0;
  const hasGauge    = isGauge && chartData.length > 0;
  const hasRadar    = isRadar && chartData.length > 0;
  const hasListBar  = (isList || isProgress) && chartData.length > 0;
  const hasTrend    = !hasLine && (isGauge || isList || isProgress) && trendData?.series?.length > 0;

  return (
    <div className="fixed inset-0 z-[220] flex items-center justify-center bg-black/50 p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-xl rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-y-auto custom-scrollbar"
        style={{ backgroundColor: activeTheme.card, border: `1px solid ${activeTheme.border}` }}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b shrink-0" style={{ borderColor: activeTheme.border }}>
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-base font-semibold truncate" style={{ color: activeTheme.text }}>{info.label}</span>
            <span className="text-xs px-2 py-0.5 rounded-full font-medium shrink-0" style={{ backgroundColor: `${primaryBlue}12`, color: primaryBlue }}>
              {fmtDate(overviewDateRange?.from)} – {fmtDate(overviewDateRange?.to)}
            </span>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full hover:opacity-70 transition-opacity ml-3 shrink-0"
            style={{ color: activeTheme.textMuted, backgroundColor: `${activeTheme.textMuted}12` }}>
            <X size={15} />
          </button>
        </div>

        <div className="px-6 pt-6 pb-2 flex flex-col gap-6">

          {/* ── Donut / Pie: centred chart + inline legend below ── */}
          {hasDonutPie && (
            <div className="flex flex-col items-center gap-2">
              <div className="relative" style={{ width: 260, height: 260 }}>
                <ReactECharts opts={{ renderer: 'svg' }} option={buildDonutOption()}
                  onEvents={{ mouseover: p => { if (p.seriesIndex === 0) setHovIdx(p.dataIndex); }, mouseout: p => { if (p.seriesIndex === 0) setHovIdx(-1); } }}
                  style={{ width: '100%', height: '100%' }} notMerge={false} />
              </div>
              <div className="flex items-center justify-center gap-5 flex-wrap">
                {chartData.map((d, i) => {
                  const color = colorFor(widget.stat, d.name, i);
                  return (
                    <div key={i} className="flex items-center gap-1.5 transition-opacity"
                      style={{ opacity: hovIdx === -1 ? 1 : hovIdx === i ? 1 : 0.35 }}>
                      <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                      <span className="text-sm" style={{ color: activeTheme.textMuted }}>{humanLabel(d.name)}</span>
                      <span className="text-sm font-semibold tabular-nums" style={{ color: activeTheme.text }}>{d.value.toLocaleString()}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Bar: full-width ── */}
          {hasBar && (
            <div style={{ width: '100%', height: Math.max(200, chartData.length * 36 + 60) }}>
              <ReactECharts opts={{ renderer: 'svg' }} option={buildBarOption()}
                style={{ width: '100%', height: '100%' }} notMerge={true} />
            </div>
          )}

          {/* ── Line trend ── */}
          {hasLine && (
            <div className="flex flex-col gap-3">
              <div className="flex items-baseline gap-2 px-1">
                <span className="text-4xl font-bold tabular-nums" style={{ color: activeTheme.text }}>{scorecardValue.toLocaleString()}</span>
                <span className="text-sm" style={{ color: activeTheme.textMuted }}>{info.summary}</span>
              </div>
              <div style={{ width: '100%', height: 200 }}>
                <ReactECharts opts={{ renderer: 'svg' }} option={buildLineOption()}
                  style={{ width: '100%', height: '100%' }} notMerge={true} />
              </div>
            </div>
          )}

          {/* ── Gauge: centred ── */}
          {hasGauge && (
            <div className="flex flex-col items-center gap-1">
              <div style={{ width: 280, height: 180 }}>
                <ReactECharts opts={{ renderer: 'svg' }} option={buildGaugeOption()}
                  style={{ width: '100%', height: '100%' }} notMerge={true} />
              </div>
              {/* breakdown below gauge */}
              <div className="flex items-center justify-center gap-5 flex-wrap mt-1">
                {chartData.map((d, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: colorFor(widget.stat, d.name, i) }} />
                    <span className="text-sm" style={{ color: activeTheme.textMuted }}>{humanLabel(d.name)}</span>
                    <span className="text-sm font-semibold tabular-nums" style={{ color: activeTheme.text }}>{d.value.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Radar: centred ── */}
          {hasRadar && (
            <div style={{ width: '100%', height: 260 }}>
              <ReactECharts opts={{ renderer: 'svg' }} option={buildRadarOption()}
                style={{ width: '100%', height: '100%' }} notMerge={true} />
            </div>
          )}

          {/* ── List / Progress: horizontal bar chart ── */}
          {hasListBar && (
            <div style={{ width: '100%', height: Math.max(160, chartData.length * 32 + 24) }}>
              <ReactECharts opts={{ renderer: 'svg' }} option={buildListOption()}
                style={{ width: '100%', height: '100%' }} notMerge={true} />
            </div>
          )}

          {/* ── Gauge/List with trendData fallback ── */}
          {hasTrend && (
            <div className="flex flex-col gap-3">
              <div className="flex items-baseline gap-2 px-1">
                <span className="text-4xl font-bold tabular-nums" style={{ color: activeTheme.text }}>{scorecardValue.toLocaleString()}</span>
                <span className="text-sm" style={{ color: activeTheme.textMuted }}>{info.summary}</span>
              </div>
              <div style={{ width: '100%', height: 200 }}>
                <ReactECharts opts={{ renderer: 'svg' }} option={buildLineOption()}
                  style={{ width: '100%', height: '100%' }} notMerge={true} />
              </div>
            </div>
          )}

          {/* ── Scorecard: big centred number ── */}
          {isScorecard && (
            <div className="flex flex-col items-center py-6 gap-1">
              <span className="text-6xl font-bold tabular-nums" style={{ color: activeTheme.text }}>{scorecardValue.toLocaleString()}</span>
              <span className="text-base mt-1" style={{ color: activeTheme.textMuted }}>{info.summary}</span>
            </div>
          )}

          {/* ── Globe: no chart preview, just scorecard ── */}
          {isGlobe && (
            <div className="flex flex-col items-center py-4 gap-1">
              <span className="text-5xl font-bold tabular-nums" style={{ color: activeTheme.text }}>{items.length.toLocaleString()}</span>
              <span className="text-base mt-1" style={{ color: activeTheme.textMuted }}>Devices with GPS data</span>
            </div>
          )}

          {/* ── How is it calculated ── */}
          <div className="rounded-xl p-4 mb-6" style={{ backgroundColor: activeTheme.bg, border: `1px solid ${activeTheme.border}` }}>
            <p className="text-sm font-semibold mb-2" style={{ color: activeTheme.text }}>How is it calculated?</p>
            <p className="text-sm leading-relaxed" style={{ color: activeTheme.textMuted }}>{info.desc}</p>
            <a href="https://www.applivery.com/docs/" target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 mt-3 text-sm font-medium hover:underline"
              style={{ color: primaryBlue }}>
              Learn more about metrics definitions <ExternalLink size={12} />
            </a>
          </div>

        </div>
      </div>
    </div>
  );
}


const SHAPES = {
  analyticsKeyed:   ['scorecard', 'donut', 'pie', 'bar', 'radar', 'list', 'progress', 'gauge'],
  analyticsTrend:   ['line'],
  analyticsDiscrete:['scorecard', 'donut', 'pie', 'bar', 'list', 'progress', 'gauge'],
  analyticsManyKeys:['scorecard', 'bar', 'list', 'progress'],
  listGrouped:      ['scorecard', 'gauge', 'donut', 'list', 'progress'],
  listApps:         ['scorecard', 'donut', 'list', 'progress'], // Enterprise apps with builds
  listUsers:        ['scorecard', 'donut', 'list', 'progress'], // Store users / employees
  listCountOnly:    ['scorecard'],
  orgProfile:       ['scorecard'],
};

const SOURCE_SHAPES = {
  'stats_devices_os':        'analyticsKeyed',
  'stats_devices_status':    'analyticsKeyed',
  'stats_builds_os':         'analyticsKeyed',
  'stats_collaborators':     'analyticsKeyed',
  'stats_downloads_trend':   'analyticsTrend',
  'stats_builds_trend':      'analyticsTrend',
  'stats_devices_trend':     'analyticsTrend',
  'stats_compliance':        'analyticsDiscrete',
  'stats_battery':           'analyticsDiscrete',
  'stats_models':            'analyticsManyKeys',
  'stats_os_updates_all':    'analyticsManyKeys',
  'stats_os_versions':       'analyticsManyKeys',
  'stats_sync_errors':       'listGrouped',
  'mdm_devices':             'listGrouped',
  'mdm_users':               'listGrouped',
  'mdm_collaborators':       'listGrouped',
  'app_dist_collaborators':  'listGrouped',
  'app_dist_store_users':    'listUsers',
  'app_dist_apps':           'listApps',
  'org_profile':             'orgProfile',
  'mdm_segments':            'listGrouped',
  'compliance_policies_summary':    'analyticsDiscrete',
  'compliance_devices_violating':   'analyticsDiscrete',
  'compliance_violations_by_policy':'analyticsKeyed',
  'compliance_violations_trend':    'analyticsTrend',
  'compliance_review_queue':        'analyticsDiscrete',
  'autorun_safety_summary':         'analyticsDiscrete',
  'compliance_framework_coverage':  'analyticsKeyed',
  'iso27001_compliance_status':     'analyticsKeyed',
  'ens_compliance_status':          'analyticsKeyed',
  'nis2_compliance_status':         'analyticsKeyed',
  'cases_summary':                  'analyticsDiscrete',
  'cases_by_severity':              'analyticsKeyed',
  'cases_by_source':                'analyticsKeyed',
  'cases_trend':                    'analyticsTrend',
  'cases_sla_summary':              'analyticsKeyed',
  'cases_mttr_trend':               'analyticsTrend',
  'applivery_events_by_type':       'analyticsKeyed',
  'applivery_events_trend':         'analyticsTrend',
  'applivery_automation_outcomes':  'analyticsKeyed',
  'system_health_summary':          'analyticsKeyed',
  'os_updates_catalog_summary':     'analyticsKeyed',
  'os_updates_device_status_summary': 'analyticsKeyed',
  'vuln_catalog_summary':           'analyticsKeyed',
  'vuln_device_status_summary':     'analyticsKeyed',
  'vuln_service_device_status_summary': 'analyticsKeyed',
  'os_lifecycle_summary':           'analyticsKeyed',
  'os_lifecycle_device_status_summary': 'analyticsKeyed',
  'apple_app_updates_summary':      'analyticsKeyed',
  'triggers_summary':               'analyticsKeyed',
  'triggers_fired_trend':           'analyticsTrend',
  'workflow_runs_summary':          'analyticsDiscrete',
  'workflow_runs_trend':            'analyticsTrend',
  'device_risk_distribution':       'analyticsKeyed',
  'device_risk_trend':              'analyticsTrend',
  'mitre_coverage':                 'analyticsDiscrete',
  'threat_intel_summary':           'analyticsKeyed',
  'ticketing_summary':              'analyticsDiscrete',
};

const CATALOG = [
  { group: 'UEM · Devices', items: [
    { id: 'mdm_devices', label: 'Device list', stat: 'mdm_devices', icon: Smartphone, context: 'uem' },
    { id: 'stats_devices_os', label: 'Devices by OS', stat: 'stats_devices_os', icon: PieIcon, context: 'uem' },
    { id: 'stats_devices_status', label: 'Devices by state', stat: 'stats_devices_status', icon: Activity, context: 'uem' },
    { id: 'stats_compliance', label: 'Compliance status', stat: 'stats_compliance', icon: ShieldAlert, context: 'uem' },
    { id: 'stats_battery', label: 'Battery levels', stat: 'stats_battery', icon: BatteryCharging, context: 'uem' },
    { id: 'stats_models', label: 'Device models', stat: 'stats_models', icon: Smartphone, context: 'uem' },
    { id: 'stats_os_updates_all', label: 'OS available updates', stat: 'stats_os_updates_all', icon: RefreshCw, context: 'uem' },
    { id: 'stats_os_versions', label: 'OS version distribution', stat: 'stats_os_versions', icon: PieIcon, context: 'uem' },
    { id: 'stats_sync_errors', label: 'Sync failures', stat: 'stats_sync_errors', icon: AlertTriangle, context: 'uem' },
    { id: 'stats_devices_trend', label: 'Devices enrollment trend', stat: 'stats_devices_trend', icon: TrendingUp, context: 'uem' },
  ]},
  { group: 'UEM · Users & Segments', items: [
    { id: 'mdm_users', label: 'Device employees (UEM)', stat: 'mdm_users', icon: Users, context: 'uem' },
    { id: 'mdm_collaborators', label: 'UEM collaborators', stat: 'mdm_collaborators', icon: Briefcase, context: 'uem' },
    { id: 'mdm_segments', label: 'Segments', stat: 'mdm_segments', icon: Layers, context: 'uem' },
  ]},
  { group: 'App Distribution · Apps', items: [
    { id: 'app_dist_apps', label: 'Enterprise apps & builds', stat: 'app_dist_apps', icon: Box, context: 'dist' },
    { id: 'stats_builds_os', label: 'Builds by OS', stat: 'stats_builds_os', icon: PieIcon, context: 'dist' },
    { id: 'stats_downloads_trend', label: 'Downloads trend', stat: 'stats_downloads_trend', icon: TrendingUp, context: 'dist' },
    { id: 'stats_builds_trend', label: 'Builds trend', stat: 'stats_builds_trend', icon: TrendingUp, context: 'dist' },
  ]},
  { group: 'App Distribution · Users', items: [
    { id: 'app_dist_store_users', label: 'Store users (employees)', stat: 'app_dist_store_users', icon: Users, context: 'dist' },
    { id: 'app_dist_collaborators', label: 'Store collaborators', stat: 'app_dist_collaborators', icon: Briefcase, context: 'dist' },
    { id: 'stats_collaborators', label: 'Collaborator roles', stat: 'stats_collaborators', icon: PieIcon, context: 'dist' },
  ]},
  { group: 'System', items: [
    { id: 'org_profile', label: 'Organisation profile', stat: 'org_profile', icon: Building2, context: 'system' },
  ]},
  { group: 'Compliance (SOAR)', items: [
    { id: 'compliance_policies_summary', label: 'Compliance Policies', stat: 'compliance_policies_summary', icon: ShieldCheck, context: 'compliance' },
    { id: 'compliance_devices_violating', label: 'Devices in violation', stat: 'compliance_devices_violating', icon: ShieldAlert, context: 'compliance' },
    { id: 'compliance_violations_by_policy', label: 'Violations by policy', stat: 'compliance_violations_by_policy', icon: BarChart3, context: 'compliance' },
    { id: 'compliance_violations_trend', label: 'Violations trend', stat: 'compliance_violations_trend', icon: TrendingUp, context: 'compliance' },
    { id: 'compliance_review_queue', label: 'Review queue status', stat: 'compliance_review_queue', icon: ListChecks, context: 'compliance' },
    { id: 'autorun_safety_summary', label: 'autoRun safety interventions', stat: 'autorun_safety_summary', icon: ShieldCheck, context: 'compliance' },
  ]},
  { group: 'Compliance Frameworks (SOAR)', items: [
    { id: 'compliance_framework_coverage', label: 'Framework coverage (ISO27001/ENS/NIS2)', stat: 'compliance_framework_coverage', icon: ShieldCheck, context: 'compliance' },
    { id: 'iso27001_compliance_status', label: 'ISO 27001 compliance status', stat: 'iso27001_compliance_status', icon: ScrollText, context: 'compliance' },
    { id: 'ens_compliance_status', label: 'ENS compliance status (mp.eq)', stat: 'ens_compliance_status', icon: Flag, context: 'compliance' },
    { id: 'nis2_compliance_status', label: 'NIS2 compliance status (Art. 21)', stat: 'nis2_compliance_status', icon: Globe, context: 'compliance' },
  ]},
  { group: 'Cases (SOAR)', items: [
    { id: 'cases_summary', label: 'Cases by status', stat: 'cases_summary', icon: Folder, context: 'cases' },
    { id: 'cases_by_severity', label: 'Open cases by severity', stat: 'cases_by_severity', icon: AlertTriangle, context: 'cases' },
    { id: 'cases_by_source', label: 'Cases by source', stat: 'cases_by_source', icon: BarChart3, context: 'cases' },
    { id: 'cases_trend', label: 'Cases opened trend', stat: 'cases_trend', icon: TrendingUp, context: 'cases' },
    { id: 'cases_sla_summary', label: 'Case SLA status', stat: 'cases_sla_summary', icon: Clock, context: 'cases' },
    { id: 'cases_mttr_trend', label: 'Case MTTR trend', stat: 'cases_mttr_trend', icon: TrendingUp, context: 'cases' },
    { id: 'threat_intel_summary', label: 'Threat intel verdicts', stat: 'threat_intel_summary', icon: Radar, context: 'cases' },
    { id: 'ticketing_summary', label: 'Ticketing sync status', stat: 'ticketing_summary', icon: MessageCircle, context: 'cases' },
    { id: 'mitre_coverage', label: 'MITRE ATT&CK coverage', stat: 'mitre_coverage', icon: Target, context: 'cases' },
  ]},
  { group: 'Workflows & Risk (SOAR)', items: [
    { id: 'workflow_runs_summary', label: 'Workflow runs by outcome', stat: 'workflow_runs_summary', icon: Workflow, context: 'workflows' },
    { id: 'workflow_runs_trend', label: 'Workflow runs trend', stat: 'workflow_runs_trend', icon: TrendingUp, context: 'workflows' },
    { id: 'device_risk_distribution', label: 'Device risk distribution', stat: 'device_risk_distribution', icon: ShieldAlert, context: 'workflows' },
    { id: 'device_risk_trend', label: 'Device risk trend', stat: 'device_risk_trend', icon: TrendingUp, context: 'workflows' },
  ]},
  { group: 'Applivery Events (SOAR)', items: [
    { id: 'applivery_events_by_type', label: 'Events by type', stat: 'applivery_events_by_type', icon: Satellite, context: 'cases' },
    { id: 'applivery_events_trend', label: 'Events received trend', stat: 'applivery_events_trend', icon: TrendingUp, context: 'cases' },
    { id: 'applivery_automation_outcomes', label: 'Automation outcomes', stat: 'applivery_automation_outcomes', icon: ListChecks, context: 'cases' },
  ]},
  { group: 'Operations (SOAR)', items: [
    { id: 'system_health_summary', label: 'System health', stat: 'system_health_summary', icon: Activity, context: 'workflows' },
  ]},
  { group: 'OS Updates (SOAR)', items: [
    { id: 'os_updates_catalog_summary', label: 'OS update catalog', stat: 'os_updates_catalog_summary', icon: Cpu, context: 'workflows' },
    { id: 'os_updates_device_status_summary', label: 'OS update device status', stat: 'os_updates_device_status_summary', icon: ShieldAlert, context: 'workflows' },
  ]},
  { group: 'Vulnerability Intel (SOAR)', items: [
    { id: 'vuln_catalog_summary', label: 'Apple/Android vulnerability catalog', stat: 'vuln_catalog_summary', icon: Bug, context: 'workflows' },
    { id: 'vuln_device_status_summary', label: 'Apple/Android vulnerability device status', stat: 'vuln_device_status_summary', icon: ShieldAlert, context: 'workflows' },
    { id: 'vuln_service_device_status_summary', label: 'Vulnerability Service device status', stat: 'vuln_service_device_status_summary', icon: ShieldAlert, context: 'workflows' },
  ]},
  { group: 'OS Lifecycle (SOAR)', items: [
    { id: 'os_lifecycle_summary', label: 'OS lifecycle catalog', stat: 'os_lifecycle_summary', icon: Hourglass, context: 'workflows' },
    { id: 'os_lifecycle_device_status_summary', label: 'OS lifecycle device status', stat: 'os_lifecycle_device_status_summary', icon: Hourglass, context: 'workflows' },
  ]},
  { group: 'App Updates (SOAR)', items: [
    { id: 'apple_app_updates_summary', label: 'Apple app updates', stat: 'apple_app_updates_summary', icon: Package, context: 'workflows' },
  ]},
  { group: '3rd-Party Events (SOAR)', items: [
    { id: 'triggers_summary', label: 'Inbound trigger fires', stat: 'triggers_summary', icon: Webhook, context: 'cases' },
    { id: 'triggers_fired_trend', label: 'Inbound trigger fires trend', stat: 'triggers_fired_trend', icon: TrendingUp, context: 'cases' },
  ]}
];

const ALL_CHART_TYPES = [
  { id: 'scorecard', label: 'Scorecard', desc: 'Total count', icon: <Hash size={18}/> },
  { id: 'gauge', label: 'Gauge', desc: 'Count vs total arc', icon: <Activity size={18}/> },
  { id: 'donut', label: 'Donut', desc: 'Grouped by category', icon: <PieIcon size={18}/> },
  { id: 'pie', label: 'Pie', desc: 'Proportions filled', icon: <PieIcon size={18}/> },
  { id: 'bar', label: 'Bar', desc: 'Compare categories', icon: <BarChart3 size={18}/> },
  { id: 'line', label: 'Line', desc: 'Time-series', icon: <TrendingUp size={18}/> },
  { id: 'radar', label: 'Radar', desc: 'Multi-axis', icon: <Radar size={18}/> },
  { id: 'list', label: 'List', desc: 'Breakdown rows', icon: <List size={18}/> },
  { id: 'progress', label: 'Bars', desc: 'Horizontal fill bars', icon: <SlidersHorizontal size={18}/> }
];

const SIZES = [
  { id: 'small',  label: 'Small',  desc: '1×1', w: 3,  h: 2 },
  { id: 'half',   label: 'Wide',   desc: '2×1', w: 6,  h: 3 },
  { id: 'full',   label: 'Large',  desc: '4×1', w: 12, h: 3 },
];

const DEFAULT_DASHBOARD = {
  widgets: [
    { id: 'w0', title: 'WORKSPACE PROFILE', stat: 'org_profile', type: 'scorecard', size: 'small', filters: {} },
    { id: 'w1', title: 'DEVICES BY OS', stat: 'stats_devices_os', type: 'donut', size: 'small', filters: {} },
    { id: 'w2', title: 'COMPLIANCE STATUS', stat: 'stats_compliance', type: 'donut', size: 'small', filters: {} },
    { id: 'w3', title: 'DOWNLOAD TRENDS', stat: 'stats_downloads_trend', type: 'line', size: 'half', filters: {} }
  ],
  layout: [
    { i: 'w0', x: 0, y: 0, w: 4, h: 3, static: false },
    { i: 'w1', x: 4, y: 0, w: 4, h: 3, static: false },
    { i: 'w2', x: 8, y: 0, w: 4, h: 3, static: false },
    { i: 'w3', x: 0, y: 3, w: 6, h: 3, static: false }
  ]
};

const getCleanDashboard = (dash) => ({
  widgets: dash.widgets,
  layout: dash.layout.map(({ i, x, y, w, h, static: isStatic }) => ({ i, x, y, w, h, static: !!isStatic }))
});

const getSegmentIcon = (iconValue) => {
  if (iconValue === undefined || iconValue === null) return Bookmark;
  const val = String(iconValue).trim().toLowerCase();
  const name = val.startsWith('i') ? val.substring(1) : val;

  const iconArray = [
    Folder, Atom, Backpack, ShoppingBag, Locate, Disc, BatteryCharging, Bed, Archive, Bell, Baby, Zap,
    Bone, Book, Bookmark, Package, FlaskConical, LifeBuoy, Box, Bug, Building2, Bus, Calculator, Calendar,
    Camera, Briefcase, Armchair, BarChart3, MessageCircle, CheckSquare, XSquare, AlertTriangle, Timer, RefreshCw, Factory, Clapperboard,
    Clock, Code, Compass, Cpu, ThumbsDown, ThumbsUp, Copy, CircleDollarSign, LifeBuoy, ChevronsUp, FileText, Filter,
    Aperture, Flame, Flag, Ban, Gamepad2, Headphones, Heart, Home, Hourglass, Glasses, Key, Laptop,
    Lightbulb, Lock, Unlock, Wand2, Navigation, MapPin, Monitor, Smartphone, BookOpen, Palette, Globe, Printer,
    Radio, Satellite, Shield, Store, Tag, Trash2, Shirt, User, Watch, LayoutGrid, Wine, Ghost
  ];

  if (/^\d+$/.test(val)) {
    const idx = parseInt(val, 10);
    return iconArray[idx % iconArray.length] || Bookmark;
  }

  const iconMap = {
    'folder': Folder, 'atom': Atom, 'backpack': Backpack, 'bag': ShoppingBag, 'shop': ShoppingBag, 'balloon': Locate, 'dribbble': Disc, 'basketball': Disc, 'battery': BatteryCharging, 'bed': Bed, 'archive': Archive, 'drawer': Archive, 'bell': Bell, 'baby': Baby, 'zap': Zap, 'lightning': Zap,
    'bone': Bone, 'book': Book, 'mark': Bookmark, 'bookmark': Bookmark, 'package': Package, 'milk': FlaskConical, 'flask': FlaskConical, 'bowling': LifeBuoy, 'lifebuoy': LifeBuoy, 'box': Box, 'cube': Box, 'bug': Bug, 'insect': Bug, 'building': Building2, 'city': Building2, 'bus': Bus, 'calculator': Calculator, 'math': Calculator, 'calendar': Calendar, 'date': Calendar,
    'camera': Camera, 'photo': Camera, 'case': Briefcase, 'briefcase': Briefcase, 'work': Briefcase, 'chair': Armchair, 'armchair': Armchair, 'chart': BarChart3, 'bar': BarChart3, 'chat': MessageCircle, 'message': MessageCircle, 'check': CheckSquare, 'tick': CheckSquare, 'close': XSquare, 'cross': XSquare, 'alert': AlertTriangle, 'warning': AlertTriangle, 'danger': AlertTriangle, 'timer': Timer, 'stopwatch': Timer, 'refresh': RefreshCw, 'sync': RefreshCw, 'factory': Factory, 'industry': Factory, 'clapperboard': Clapperboard, 'movie': Clapperboard,
    'clock': Clock, 'time': Clock, 'code': Code, 'compass': Compass, 'cpu': Cpu, 'chip': Cpu, 'down': ThumbsDown, 'up': ThumbsUp, 'copy': Copy, 'files': Copy, 'dollar': CircleDollarSign, 'money': CircleDollarSign, 'coin': CircleDollarSign, 'donut': LifeBuoy, 'chevron': ChevronsUp, 'file': FileText, 'document': FileText, 'filter': Filter,
    'circle': Aperture, 'aperture': Aperture, 'flame': Flame, 'fire': Flame, 'flag': Flag, 'ban': Ban, 'forbidden': Ban, 'game': Gamepad2, 'headphone': Headphones, 'heart': Heart, 'love': Heart, 'home': Home, 'house': Home,
    'hourglass': Hourglass, 'glasses': Glasses, 'key': Key, 'laptop': Laptop, 'mac': Laptop, 'lightbulb': Lightbulb, 'bulb': Lightbulb, 'idea': Lightbulb, 'unlock': Unlock, 'lock': Lock, 'wand': Wand2, 'magic': Wand2, 'navigation': Navigation, 'nav': Navigation, 'pin': MapPin, 'location': MapPin, 'monitor': Monitor, 'screen': Monitor, 'device': Smartphone, 'phone': Smartphone, 'smartphone': Smartphone, 'mobile': Smartphone, 'open': BookOpen, 'palette': Palette, 'color': Palette, 'globe': Globe, 'world': Globe, 'planet': Globe, 'printer': Printer, 'print': Printer,
    'radio': Radio, 'satellite': Satellite, 'shield': Shield, 'secure': Shield, 'store': Store, 'tag': Tag, 'label': Tag, 'trash': Trash2, 'delete': Trash2, 'shirt': Shirt, 'tshirt': Shirt, 'user': User, 'person': User, 'people': Users, 'watch': Watch, 'grid': LayoutGrid, 'apps': LayoutGrid, 'wine': Wine, 'glass': Wine, 'ghost': Ghost,
    'target': Target, 'activity': Activity, 'pie': PieIcon, 'layout': Layout, 'slider': SlidersHorizontal, 'radar': Radar
  };

  for (const [key, IconComponent] of Object.entries(iconMap)) {
     if (name.includes(key) || val.includes(key)) return IconComponent;
  }
  return Bookmark; 
};

const getSegmentColor = (colorVal, activeTheme) => {
  if (!colorVal) return activeTheme.textMuted;
  const rawColor = String(colorVal).trim().toLowerCase();
  const APPLIVERY_COLOR_MAP = {
    '#000000': '#737373', '#000001': '#F87171', '#000002': '#FB923C', '#000004': '#FACC15',
    '#000005': '#A3E635', '#000007': '#34D399', '#000009': '#22D3EE', '#000011': '#60A5FA',
    '#000014': '#C084FC', '#000016': '#F472B6',
  };
  if (APPLIVERY_COLOR_MAP[rawColor]) return APPLIVERY_COLOR_MAP[rawColor];
  if (/^#([0-9a-f]{3}){1,2}$/.test(rawColor)) return rawColor;
  return activeTheme.textMuted;
};

// ─── COMPONENT: INTERACTIVE 3D GLOBE WIDGET (ENHANCED) ───
const SATELLITE_ORBITS = [
  { lat: 40.4,  lngOffset: 0,   alt: 0.38, speed: 0.12,  label: 'Melkor-1' },
  { lat: -23.5, lngOffset: 120, alt: 0.55, speed: 0.07,  label: 'Balthasar-2' },
  { lat: 60.0,  lngOffset: 240, alt: 0.44, speed: 0.09,  label: 'Casper-3' },
];

// Shared by GlobeWidget (3D) and PlaygroundMapView (2D, below) so both
// views agree on where a device actually is and what color represents it —
// a single source of truth rather than two copies that could drift.
function resolveRealDeviceLatLng(item) {
  if (item.locationCache?.lat !== undefined) return { lat: parseFloat(item.locationCache.lat), lng: parseFloat(item.locationCache.lng) };
  if (item.lastLocation?.latitude !== undefined) return { lat: parseFloat(item.lastLocation.latitude), lng: parseFloat(item.lastLocation.longitude) };
  if (item.location?.lat !== undefined) return { lat: parseFloat(item.location.lat), lng: parseFloat(item.location.lng) };
  if (item.networkInfo?.latitude !== undefined) return { lat: parseFloat(item.networkInfo.latitude), lng: parseFloat(item.networkInfo.longitude) };
  if (item.summary?.latitude !== undefined) return { lat: parseFloat(item.summary.latitude), lng: parseFloat(item.summary.longitude) };
  return null;
}

function deviceMarkerColor(item) {
  const os = String(item.platform_normalized || item.os || '').toLowerCase();
  let color = os.includes('apple') || os.includes('ios') || os.includes('mac') ? '#79C6E8'
            : os.includes('android') ? '#3DDC84'
            : os.includes('win') ? '#0078D4'
            : '#A855F7';
  if (item.is_compliant_normalized === false) color = '#EF4444';
  else if (item.is_compliant_normalized === true) color = '#22C55E';
  return color;
}

// Camera altitude (in globe radii — react-globe.gl's onZoom unit) below
// which the Playground auto-switches from the 3D globe to the 2D map. Below
// this point, devices clustered in the same region become hard to tell
// apart/click on the globe's curved surface — a flat, zoomable map with
// marker clustering handles a dense region far better.
const GLOBE_TO_MAP_ALTITUDE_THRESHOLD = 0.32;

function GlobeWidget({ items, activeTheme, onDeviceClick, filterActive = false, totalDevices = 0, paused = false, onZoom }) {
  const containerRef = useRef(null);
  const globeRef = useRef(null);
  const cloudsRef = useRef(null); // Safely holds the clouds for rotation
  const [dims, setDims] = useState({ width: 300, height: 300 });
  const [tick, setTick] = useState(0);
  const tickRef = useRef(0);
  const rafRef = useRef(null);
  // Mirrors the `paused` prop into a ref so the RAF loop below (a mount-once
  // effect with an empty dep array, per the comment on it) always reads the
  // latest value instead of closing over a stale one.
  const pausedRef = useRef(paused);
  useEffect(() => {
    pausedRef.current = paused;
    // Also live-toggle OrbitControls' own autoRotate — handleGlobeReady only
    // sets this once, on first load, so a later pause/resume needs its own
    // effect to reach the controls instance again.
    const controls = globeRef.current?.controls?.();
    if (controls) controls.autoRotate = !paused;
  }, [paused]);

  // Satellite sprite
  const satelliteMaterial = React.useMemo(() => {
    const texture = new THREE.TextureLoader().load('/applivery-satellite.svg');
    return new THREE.SpriteMaterial({ map: texture, color: 0xffffff, transparent: true, opacity: 0.95 });
  }, []);

  // Single RAF loop — animates both the satellites AND the clouds independently
  useEffect(() => {
    let frame = 0;
    const loop = () => {
      frame++;
      // 1. Move satellites
      if (frame % 2 === 0) { 
        tickRef.current++; 
        setTick(t => t + 1); 
      }
      // 2. Rotate clouds seamlessly at a cinematic, subtle speed — skipped
      // entirely while paused, alongside the globe's own OrbitControls
      // autoRotate (toggled in the effect above), so "pause rotation"
      // actually freezes both layers rather than just the sphere.
      if (cloudsRef.current && !pausedRef.current) {
        // 0.0003 creates a gentle drift slightly faster than the globe's auto-rotation
        cloudsRef.current.rotation.y += 0.0001;
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver(e => setDims({ width: e[0].contentRect.width, height: e[0].contentRect.height }));
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  // --- NEW: GLOBE READY HANDLER (Clouds & Auto-Rotation) ---
  const handleGlobeReady = () => {
    const globe = globeRef.current;
    if (!globe) return;

    // 1. Enable Smooth, Slow Auto-Rotation (Spins the globe, not the background)
    const controls = globe.controls();
    if (controls) {
      controls.autoRotate = !pausedRef.current;
      controls.autoRotateSpeed = 0.2;
    }

    // 2. Build and Inject the Clouds Sphere
    if (!cloudsRef.current) {
      // Using the raw GitHub URL to guarantee the transparent PNG loads!
      const CLOUDS_IMG_URL = 'https://raw.githubusercontent.com/vasturiano/react-globe.gl/master/example/clouds/clouds.png';
      const CLOUDS_ALT = 0.005;

      new THREE.TextureLoader().load(CLOUDS_IMG_URL, cloudsTexture => {
        const clouds = new THREE.Mesh(
          new THREE.SphereGeometry(globe.getGlobeRadius() * (1 + CLOUDS_ALT), 75, 75),
          new THREE.MeshPhongMaterial({ 
            map: cloudsTexture, 
            transparent: true, 
            opacity: 0.6, 
            depthWrite: false // Crucial: prevents clouds from masking the glowing device dots!
          })
        );
        globe.scene().add(clouds);
        cloudsRef.current = clouds; // Save it to the ref so the RAF loop can animate it
      });
    }
  };

  const gData = React.useMemo(() => items.map(item => {
    const real = resolveRealDeviceLatLng(item);

    const str = String(item.id || item._id || Math.random());
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = ((hash << 5) - hash) + str.charCodeAt(i);
    const hasReal = !!real && !isNaN(real.lat);
    const lat = (hasReal ? real.lat : (Math.abs(hash) % 120) - 60) + (Math.random() - 0.5) * 0.4;
    const lng = (hasReal ? real.lng : (Math.abs(hash >> 8) % 360) - 180) + (Math.random() - 0.5) * 0.4;
    const alt = 0.008 + Math.random() * 0.012;

    return { ...item, lat, lng, alt, size: hasReal ? 3.5 : 1.8, color: deviceMarkerColor(item), label: item.display_name || item.summary?.model || 'Device' };
  }), [items]);

  const satellitesRef = useRef(SATELLITE_ORBITS.map((orb, idx) => ({ ...orb, idx })));

  const satelliteObjects = React.useMemo(() => {
    satellitesRef.current.forEach(orb => {
      orb.lng = ((orb.lngOffset + tickRef.current * orb.speed * 3) % 360) - 180;
    });
    return [...satellitesRef.current];
  }, [tick]);

  const arcData = React.useMemo(() => {
    const real = gData.filter(d => d.size > 2);
    const arcs = [];
    for (let i = 0; i < Math.min(real.length, 4); i++) {
      for (let j = i + 1; j < Math.min(real.length, 5); j++) {
        arcs.push({ startLat: real[i].lat, startLng: real[i].lng, endLat: real[j].lat, endLng: real[j].lng, color: real[i].color });
      }
    }
    return arcs.slice(0, 8);
  }, [gData]);

  const tooltipStyle = (color) =>
    `background: rgba(2,8,23,0.92); backdrop-filter: blur(8px); padding: 8px 12px; border-radius: 10px; color: white; font-family: 'Outfit', sans-serif; font-size: 13px; border: 1px solid ${color}60; box-shadow: 0 8px 24px rgba(0,0,0,0.5);`;

  const compliant = gData.filter(d => d.is_compliant_normalized === true).length;
  const nonCompliant = gData.filter(d => d.is_compliant_normalized === false).length;
  const appleCount = gData.filter(d => String(d.platform_normalized || '').toLowerCase().includes('apple') || String(d.platform_normalized || '').toLowerCase().includes('ios')).length;
  const androidCount = gData.filter(d => String(d.platform_normalized || '').toLowerCase().includes('android')).length;
  const winCount = gData.filter(d => String(d.platform_normalized || '').toLowerCase().includes('win')).length;

  return (
    <div ref={containerRef} className="w-full h-full relative cursor-pointer rounded-xl overflow-hidden" style={{ background: '#020817 url(https://unpkg.com/three-globe/example/img/night-sky.png) center/cover' }}>
      {dims.width > 0 && (
        <ReactGlobe
          ref={globeRef}
          onGlobeReady={handleGlobeReady}
          onZoom={onZoom}
          width={dims.width}
          height={dims.height}
          globeImageUrl="https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg"
          atmosphereColor="#4488ff"
          atmosphereAltitude={0.18}
          backgroundColor="rgba(0,0,0,0)"

          ringsData={gData}
          ringColor="color"
          ringMaxRadius="size"
          ringPropagationSpeed={2.5}
          ringRepeatPeriod={900}
          onRingClick={onDeviceClick}
          ringLabel={d => `<div style="${tooltipStyle(d.color)}"><div style="font-weight:700;margin-bottom:2px">${d.label}</div><div style="color:${d.color};font-size:10px;text-transform:uppercase;letter-spacing:1px">${d.is_compliant_normalized === true ? '✓ Compliant' : d.is_compliant_normalized === false ? '✗ Non-compliant' : 'Click to view'}</div></div>`}

          pointsData={gData}
          pointLat="lat"
          pointLng="lng"
          pointColor="color"
          pointAltitude="alt"
          pointRadius={0.18}
          pointResolution={16}
          onPointClick={onDeviceClick}
          pointLabel={d => `<div style="${tooltipStyle(d.color)}"><div style="font-weight:700;margin-bottom:3px">${d.label}</div><div style="color:#94A3B8;font-size:10px;text-transform:uppercase;letter-spacing:0.5px">${String(d.platform_normalized || d.os || 'Unknown').toUpperCase()}</div></div>`}

          arcsData={arcData}
          arcStartLat="startLat"
          arcStartLng="startLng"
          arcEndLat="endLat"
          arcEndLng="endLng"
          arcColor={d => [`${d.color}99`, `${d.color}22`]}
          arcAltitude={0.18}
          arcStroke={0.4}
          arcDashLength={0.4}
          arcDashGap={0.15}
          arcDashAnimateTime={2500}

          objectsData={satelliteObjects}
          objectLat="lat"
          objectLng="lng"
          objectAltitude="alt"
          objectLabel={d => `<div style="${tooltipStyle('#0241E2')}"><div style="font-weight:700">${d.label}</div><div style="color:#3DDC84;font-size:9px;text-transform:uppercase;margin-top:2px;letter-spacing:1px">● Actively Scanning</div></div>`}
          objectThreeObject={() => {
            const sprite = new THREE.Sprite(satelliteMaterial);
            sprite.scale.set(5, 5, 1);
            return sprite;
          }}
        />
      )}

      {/* ── HUD Overlay ── */}
      <div className="absolute top-4 left-4 pointer-events-none">
        <div className="text-[9px] font-bold uppercase tracking-widest mb-2 text-white/40">
          {filterActive ? 'Non-Compliant Filter' : 'Device Fleet'}
        </div>
        <div className="flex flex-col gap-1.5">
          {!filterActive && (
            <div className="flex items-center gap-2 bg-black/40 backdrop-blur px-2.5 py-1.5 rounded-lg border border-blue-400/30">
              <div className="w-2 h-2 rounded-full bg-blue-400" style={{ boxShadow: '0 0 6px #60a5fa' }}/>
              <span className="text-[11px] font-semibold text-blue-200">{totalDevices} Total</span>
            </div>
          )}
          {!filterActive && compliant > 0 && (
            <div className="flex items-center gap-2 bg-black/40 backdrop-blur px-2.5 py-1.5 rounded-lg border border-green-500/25">
              <div className="w-2 h-2 rounded-full bg-green-400"/>
              <span className="text-[10px] text-green-300">{compliant} Compliant</span>
            </div>
          )}
          {nonCompliant > 0 && (
            <div className="flex items-center gap-2 bg-black/40 backdrop-blur px-2.5 py-1.5 rounded-lg border border-red-500/30">
              <div className="w-2 h-2 rounded-full bg-red-400" style={{ boxShadow: '0 0 6px #f87171' }}/>
              <span className="text-[10px] text-red-300">{filterActive ? `${nonCompliant} Out of Compliance` : `${nonCompliant} Non-compliant`}</span>
            </div>
          )}
        </div>
      </div>

      <div className="absolute bottom-4 left-4 pointer-events-none">
        <div className="flex gap-2">
          {appleCount > 0 && <div className="flex items-center gap-1.5 bg-black/40 backdrop-blur px-2 py-1 rounded-lg border border-[#79C6E8]/20"><OsIcon platform="apple" size={10} color="#79C6E8"/><span className="text-[10px] font-semibold text-[#79C6E8]">{appleCount}</span></div>}
          {androidCount > 0 && <div className="flex items-center gap-1.5 bg-black/40 backdrop-blur px-2 py-1 rounded-lg border border-[#3DDC84]/20"><OsIcon platform="android" size={10} color="#3DDC84"/><span className="text-[10px] font-semibold text-[#3DDC84]">{androidCount}</span></div>}
          {winCount > 0 && <div className="flex items-center gap-1.5 bg-black/40 backdrop-blur px-2 py-1 rounded-lg border border-[#0078D4]/20"><OsIcon platform="windows" size={10} color="#0078D4"/><span className="text-[10px] font-semibold text-[#0078D4]">{winCount}</span></div>}
        </div>
      </div>

      <div className="absolute bottom-3 right-4 pointer-events-none flex items-center gap-2">
        <img src="https://dashboard.applivery.io/images/logo-combined-white.svg" className="h-[14px] object-contain opacity-40" alt="Applivery"/>
        <span className="text-[9px] font-bold uppercase tracking-widest text-white/30">SOAR</span>
      </div>

      <div className="absolute top-4 right-4 pointer-events-none">
        <div className="flex items-center gap-1.5 bg-black/40 backdrop-blur px-2.5 py-1.5 rounded-lg border border-green-500/20">
          <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse"/>
          <span className="text-[10px] font-semibold text-green-300">{SATELLITE_ORBITS.length} Satellites</span>
        </div>
      </div>
    </div>
  );
}

// Same tiers/colors as DeviceDetailDrawer.jsx's own RISK_TIER_META (Devices
// list modal) — kept as a separate local copy here rather than shared/
// imported since DeviceInsightCard lives inline in this file, not in its
// own module.
const INSIGHT_RISK_TIER_META = {
  low: { label: 'Low', color: SUCCESS },
  medium: { label: 'Medium', color: WARNING },
  high: { label: 'High', color: '#F97316' },
  critical: { label: 'Critical', color: DANGER },
};

// ─── COMPONENT: PLAYGROUND 2D MAP VIEW (dense-region fallback) ───
// Swapped in for GlobeWidget once the user zooms in past
// GLOBE_TO_MAP_ALTITUDE_THRESHOLD (or via the manual toolbar toggle) — a flat
// OpenStreetMap view with clustered markers, since a curved 3D globe makes
// devices packed into the same region nearly impossible to click
// individually (see the toolbar's "Map View" toggle). Clicking a marker (or
// a cluster, which zooms in first) opens the exact same device modal as a
// globe pin click, via the shared onDeviceClick prop.
function PlaygroundDeviceMarkerIcon(color) {
  return L.divIcon({
    className: 'playground-device-marker',
    html: `<div style="width:14px;height:14px;border-radius:50%;background:${color};border:2px solid rgba(255,255,255,0.9);box-shadow:0 0 8px ${color}aa;"></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}

// Degrees of lat/lng around the globe's zoomed-in point (pov.lat/pov.lng)
// counted as "nearby" for the purposes of framing the map — roughly a large
// country's extent. Wide enough to catch a real device cluster even if it's
// spread across a metro area or small country, narrow enough that it won't
// accidentally pull in an unrelated cluster from a different continent.
const MAP_NEARBY_DEGREES = 8;

// Frames the map on entry into map mode (i.e. whenever `center` changes —
// a fresh zoom-in from the globe, or the manual "Map View" toggle) so
// devices are actually visible without the admin having to zoom out and
// hunt for them first. Deliberately does NOT re-run on every `items`
// change (e.g. toggling "Non-Compliant Only" while already on the map)
// — only a genuinely new entry point should reframe the view; otherwise
// it would fight the admin's own subsequent pan/zoom.
function FitMapToDevices({ items, center }) {
  const map = useMap();
  useEffect(() => {
    if (!center) return;
    const nearby = items.filter(it =>
      Math.abs(it._mapLat - center.lat) <= MAP_NEARBY_DEGREES && Math.abs(it._mapLng - center.lng) <= MAP_NEARBY_DEGREES
    );
    if (nearby.length >= 2) {
      // Frame every nearby device with some breathing room — capped at
      // maxZoom so a very tight cluster (all devices in one building)
      // doesn't zoom in absurdly close; marker clustering already handles
      // that case once you're on the map.
      const bounds = L.latLngBounds(nearby.map(it => [it._mapLat, it._mapLng]));
      map.fitBounds(bounds, { padding: [60, 60], maxZoom: 12 });
    } else if (nearby.length === 1) {
      map.setView([nearby[0]._mapLat, nearby[0]._mapLng], 10); // metro scale
    } else {
      // No real-location devices anywhere near where the globe was
      // pointed (e.g. it was zoomed into an area only carrying
      // placeholder/hashed positions, which never render on the map) —
      // fall back to a country-scale view centered on that point instead
      // of leaving the admin zoomed into empty ocean or countryside.
      map.setView([center.lat, center.lng], 6);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center?.lat, center?.lng]);
  return null;
}

function PlaygroundMapView({ items, activeTheme, onDeviceClick, center, onBackToGlobe }) {
  const geoItems = React.useMemo(() => {
    return items.map(item => {
      const real = resolveRealDeviceLatLng(item);
      if (!real || isNaN(real.lat) || isNaN(real.lng)) return null;
      return { ...item, _mapLat: real.lat, _mapLng: real.lng, _mapColor: deviceMarkerColor(item), _mapLabel: item.display_name || item.summary?.model || 'Device' };
    }).filter(Boolean);
  }, [items]);

  const skippedCount = items.length - geoItems.length;

  return (
    // `relative` + an explicit z-index (not just the default `auto`) forces
    // this div to establish its own CSS stacking context. Leaflet's own
    // panes/controls carry z-index values up to 1000 (see leaflet.css —
    // .leaflet-top/.leaflet-bottom controls sit at 1000), and with no
    // intervening stacking context those values compare directly against
    // the rest of the page's root-level stacking context — including
    // ModalBackdrop's z-[120], which the map would then render on top of.
    // Containing Leaflet's z-index scope in here keeps the whole map,
    // however "tall" its internal z-index gets, pinned at this div's own
    // z-0 from any ancestor's point of view — so the device modal (opened
    // by clicking a marker) always ends up above it.
    <div className="w-full h-full relative z-0">
      <MapContainer
        center={[center.lat, center.lng]}
        zoom={6}
        scrollWheelZoom
        className="w-full h-full"
        style={{ background: '#0b1220' }}
      >
        <FitMapToDevices items={geoItems} center={center} />
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        />
        <MarkerClusterGroup chunkedLoading maxClusterRadius={55}>
          {geoItems.map((item, i) => (
            <Marker
              key={item.id || item._id || i}
              position={[item._mapLat, item._mapLng]}
              icon={PlaygroundDeviceMarkerIcon(item._mapColor)}
              eventHandlers={{ click: () => onDeviceClick(item) }}
            >
              <LeafletTooltip direction="top" offset={[0, -8]} opacity={0.95}>
                <div style={{ fontFamily: "'Outfit', sans-serif" }}>
                  <div style={{ fontWeight: 700 }}>{item._mapLabel}</div>
                  <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.5px', color: item._mapColor }}>
                    {item.is_compliant_normalized === true ? '✓ Compliant' : item.is_compliant_normalized === false ? '✗ Non-compliant' : 'Click to view'}
                  </div>
                </div>
              </LeafletTooltip>
            </Marker>
          ))}
        </MarkerClusterGroup>
      </MapContainer>

      <div className="absolute top-4 right-4 z-[1000]">
        <button
          onClick={onBackToGlobe}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg font-medium text-[11px] transition-all border border-white/10 hover:bg-white/10 backdrop-blur"
          style={{ color: 'rgba(255,255,255,0.85)', backgroundColor: 'rgba(2,8,23,0.75)' }}
        >
          <Globe size={12} className="text-blue-400" /> Back to Globe
        </button>
      </div>

      {skippedCount > 0 && (
        <div
          className="absolute bottom-4 left-4 z-[1000] px-3 py-1.5 rounded-lg text-[10px] font-medium backdrop-blur"
          style={{ color: 'rgba(255,255,255,0.6)', backgroundColor: 'rgba(2,8,23,0.75)', border: '1px solid rgba(255,255,255,0.1)' }}
        >
          {skippedCount} device{skippedCount === 1 ? '' : 's'} without location data not shown here
        </div>
      )}
    </div>
  );
}

// ─── COMPONENT: DEVICE INSIGHT CARD ───
function DeviceInsightCard({ device, activeTheme, apiToken, orgSlug }) {
  const [activeTab, setActiveTab] = useState('Overview');
  const [showLocationHistory, setShowLocationHistory] = useState(false);
  const [locations, setLocations] = useState([]);
  const [network, setNetwork] = useState(null);
  const [assets, setAssets] = useState([]);
  const [logs, setLogs] = useState([]);
  const [loadingExtras, setLoadingExtras] = useState(true);
  const [compliance, setCompliance] = useState(null);
  const [loadingCompliance, setLoadingCompliance] = useState(true);
  const [complianceError, setComplianceError] = useState(null);

  // Fetched from our own backend (not Applivery directly, unlike the extras
  // below) — this device's compliance/risk data lives in get_devices_full's
  // computation, which the lighter Playground device list never carries.
  // See GET /api/devices/{id}/compliance in main.py.
  useEffect(() => {
    let isMounted = true;
    const id = device.id || device._id;
    if (!apiToken || !orgSlug || !id) { setLoadingCompliance(false); return; }
    setLoadingCompliance(true);
    setComplianceError(null);
    axios.get(`/api/devices/${id}/compliance`, {
      headers: { Authorization: `Bearer ${apiToken}`, 'X-Workspace-Slug': orgSlug },
    }).then(res => {
      if (isMounted) setCompliance(res.data);
    }).catch(err => {
      if (isMounted) setComplianceError(err.response?.data?.detail || 'Could not load compliance data for this device.');
    }).finally(() => {
      if (isMounted) setLoadingCompliance(false);
    });
    return () => { isMounted = false; };
  }, [device, apiToken, orgSlug]);

  useEffect(() => {
    let isMounted = true;
    const fetchExtras = async () => {
      if (!apiToken || !orgSlug) return;
      try {
        const headers = { Authorization: `Bearer ${apiToken}` };
        let mdmType = 'emmDevice';
        const plat = String(device.platform_normalized || device.type || '').toLowerCase();
        if (plat.includes('apple') || plat.includes('ios') || plat.includes('mac') || plat.includes('ipad')) mdmType = 'admDevice';
        else if (plat.includes('win')) mdmType = 'winDevice';
        const id = device.id || device._id;

        // Extract the exact Segment ID this device belongs to
        let devSegmentId = 0;
        if (device.segmentId !== undefined) devSegmentId = device.segmentId;
        else if (typeof device.segment === 'object' && device.segment !== null) devSegmentId = device.segment.id || device.segment._id || 0;
        else if (device.segment !== undefined) devSegmentId = device.segment;

        const reqs = [
          axios.get(`https://api.applivery.io/v1/organizations/${orgSlug}/mdm/locations/${mdmType}/${id}?limit=50&sort=createdAt:desc`, { headers }).catch(()=>null),
          axios.get(`https://api.applivery.io/v1/organizations/${orgSlug}/mdm/network-status/${mdmType}/${id}?limit=1&sort=createdAt:desc`, { headers }).catch(()=>null),
          // FIX 1: Agent Logs require both deviceId AND deviceType to route properly
          axios.get(`https://api.applivery.io/v1/organizations/${orgSlug}/mdm/agent-logs/?deviceId=${id}&deviceType=${mdmType}&limit=50&sort=createdAt:desc`, { headers }).catch(()=>null),
          // FIX 2: Fetch only assets assigned to this device's segment (and inherited from parent segments)
          axios.get(`https://api.applivery.io/v1/organizations/${orgSlug}/mdm/assets/?limit=100&segmentId=${devSegmentId}&expandTo=ancestors`, { headers }).catch(()=>null)
        ];
        
        const [locRes, netRes, logsRes, assetsRes] = await Promise.all(reqs);

        if (isMounted) {
          if (locRes?.data?.data?.items) setLocations(locRes.data.data.items);
          if (netRes?.data?.data?.items?.length > 0) setNetwork(netRes.data.data.items[0]);
          if (logsRes?.data?.data?.items) setLogs(logsRes.data.data.items);
          if (assetsRes?.data?.data?.items) setAssets(assetsRes.data.data.items);
          setLoadingExtras(false);
        }
      } catch(e) {
        console.error("Error fetching device extras", e);
        if (isMounted) setLoadingExtras(false);
      }
    };
    fetchExtras();
    return () => { isMounted = false; };
  }, [device, apiToken, orgSlug]);

  const name = device.displayName || device.summary?.model || device.name || 'Unknown Device';
  const email = device.mdmUser?.email || 'Unassigned';
  const os = device.platform_normalized || 'other';
  const _isDarkInsight = activeTheme === THEME.dark;
  const osIconColor = os === 'apple' ? getAppleColor(_isDarkInsight) : os === 'android' ? OFFICIAL_OS_COLORS.android : OFFICIAL_OS_COLORS.windows;
  const isComp = device.is_compliant_normalized;
  const state = String(device.state || device.status || 'UNKNOWN').toUpperCase();
  
  const activePolicies = [];
  const addPolicy = (p) => { if(p && p.name && !activePolicies.includes(p.name)) activePolicies.push(p.name); };
  addPolicy(device.appliedEmmPolicy); addPolicy(device.appliedAdmPolicy); addPolicy(device.appliedWinPolicy);
  if (device.devicePolicyStatus?.policyName) activePolicies.push(device.devicePolicyStatus.policyName);
  if (device.summary?.appliedPolicy) addPolicy(device.summary.appliedPolicy);

  const battery = device.summary?.battery;
  const batteryColor = battery < 20 ? DANGER : battery < 40 ? WARNING : SUCCESS;

  // --- Network Processing ---
  let netType = 'Unknown', isWifi = false, NetIcon = Wifi, netColor = PRIMARY_BLUE, signalPct = null;
  let carrierName = '', simState = '', pointCity = '', netDate = '';
  
  if (network) {
    netType = network.networkType || 'Unknown';
    isWifi = netType.toLowerCase().includes('wifi') || netType.toLowerCase().includes('wi-fi');
    NetIcon = isWifi ? Wifi : Radio;
    netColor = isWifi ? '#3B82F6' : SUCCESS; // Match Dart's Info (Blue) / Success (Green) logic
    
    // Normalize signal strength (0-100 or 0-4 bars)
    const strength = network.strength;
    if (strength !== undefined && strength !== null) {
      signalPct = strength > 4 ? strength / 100 : strength / 4;
      signalPct = Math.min(Math.max(signalPct, 0), 1);
    }
    
    carrierName = network.carrierInfo?.carrierName || '';
    simState = network.carrierInfo?.simState || '';
    const pointAddr = network.point?.address || {};
    pointCity = [pointAddr.city, pointAddr.country].filter(Boolean).join(', ');
    netDate = (network.date || network.updatedAt || '').split('T')[0];
  }

  return (
    <div className="w-full relative space-y-6">
      <div className="flex items-center gap-4 border-b pb-6" style={{ borderColor: activeTheme.border }}>
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center shrink-0" style={{ backgroundColor: `${osIconColor}15` }}>
          <OsIcon platform={os} size={32} color={osIconColor} />
        </div>
        <div className="flex flex-col">
          <h3 className="text-xl font-bold" style={{ color: activeTheme.text }}>{name}</h3>
          <p className="text-sm mb-1.5" style={{ color: activeTheme.textMuted }}>{email}</p>
          <div className="flex gap-2">
            <span className="px-2.5 py-1 text-[10px] font-light rounded-full border border-current/25 capitalize" style={{ backgroundColor: state === 'ACTIVE' ? `${SUCCESS}15` : `${WARNING}15`, color: state === 'ACTIVE' ? SUCCESS : WARNING }}>{state?.toLowerCase()}</span>
            <span className="px-2.5 py-1 text-[10px] font-light rounded-full border border-current/25" style={{ backgroundColor: `${isComp ? SUCCESS : DANGER}15`, color: isComp ? SUCCESS : DANGER }}>{isComp ? 'Compliant' : 'Non-compliant'}</span>
          </div>
        </div>
      </div>
      
      <div className="flex items-center justify-between px-2 pb-2">
        <div className="text-center">
          <div className="text-xl font-black" style={{ color: batteryColor }}>{battery !== undefined && battery !== null ? `${Math.round(battery)}%` : 'N/A'}</div>
          <div className="text-[10px] font-bold uppercase tracking-widest mt-1" style={{ color: activeTheme.textMuted }}>Battery</div>
        </div>
        <div className="h-8 w-px" style={{ backgroundColor: activeTheme.border }}></div>
        <div className="text-center">
          <div className="text-xl font-black" style={{ color: PRIMARY_BLUE }}>{device.summary?.osVersion || 'N/A'}</div>
          <div className="text-[10px] font-bold uppercase tracking-widest mt-1" style={{ color: activeTheme.textMuted }}>OS</div>
        </div>
        <div className="h-8 w-px" style={{ backgroundColor: activeTheme.border }}></div>
        <div className="text-center">
          <div className="text-xl font-black" style={{ color: PRIMARY_BLUE }}>{device.summary?.availableStorage ? `${(device.summary.availableStorage / 1024 / 1024 / 1024).toFixed(1)} GB` : 'N/A'}</div>
          <div className="text-[10px] font-bold uppercase tracking-widest mt-1" style={{ color: activeTheme.textMuted }}>Free Storage</div>
        </div>
      </div>

      <div className="flex items-center gap-6 border-b shrink-0 mb-6" style={{ borderColor: activeTheme.border }}>
        {['Overview', 'Compliance', 'Assets', 'Agent'].map(tab => (
          <div key={tab} onClick={() => setActiveTab(tab)} className={`pb-3 text-sm cursor-pointer transition-colors  'font-medium hover:opacity-70'`} style={{ borderColor: activeTab === tab ? PRIMARY_BLUE : 'transparent', color: activeTab === tab ? PRIMARY_BLUE : activeTheme.textMuted }}>
            {tab}
          </div>
        ))}
      </div>

      {activeTab === 'Overview' && (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div>
            <h4 className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: activeTheme.textMuted }}>Hardware & Connectivity</h4>
            <div className="p-4 rounded-xl border space-y-3" style={{ backgroundColor: activeTheme.bg, borderColor: activeTheme.border }}>
              <div className="flex justify-between"><span className="text-xs font-medium" style={{ color: activeTheme.textMuted }}>Manufacturer</span><span className="text-sm font-medium" style={{ color: activeTheme.text }}>{device.summary?.manufacturer || 'Apple'}</span></div>
              <div className="flex justify-between"><span className="text-xs font-medium" style={{ color: activeTheme.textMuted }}>Model</span><span className="text-sm font-medium" style={{ color: activeTheme.text }}>{device.summary?.model || '—'}</span></div>
              <div className="flex justify-between"><span className="text-xs font-medium" style={{ color: activeTheme.textMuted }}>Serial number</span><span className="text-sm font-medium font-mono" style={{ color: activeTheme.text }}>{device.summary?.serialNumber || device.serialNumber || '—'}</span></div>
              <div className="flex justify-between"><span className="text-xs font-medium" style={{ color: activeTheme.textMuted }}>IMEI</span><span className="text-sm font-medium font-mono" style={{ color: activeTheme.text }}>{device.summary?.imei || '—'}</span></div>
              <div className="flex justify-between"><span className="text-xs font-medium" style={{ color: activeTheme.textMuted }}>MAC address</span><span className="text-sm font-medium font-mono" style={{ color: activeTheme.text }}>{device.summary?.macAddress || device.macAddress || device.networkInfo?.mac || '—'}</span></div>
              <div className="flex items-start justify-between gap-3"><span className="text-xs font-medium shrink-0 mt-0.5" style={{ color: activeTheme.textMuted }}>UDID</span><span className="text-xs font-mono text-right break-all select-all" style={{ color: activeTheme.text }}>{device.summary?.udid || device.control?.UDID || '—'}</span></div>
              <div className="flex justify-between"><span className="text-xs font-medium" style={{ color: activeTheme.textMuted }}>IP address</span><span className="text-sm font-medium font-mono" style={{ color: activeTheme.text }}>{device.networkIp || device.summary?.ipAddress || 'N/A'}</span></div>
              <div className="flex justify-between"><span className="text-xs font-medium" style={{ color: activeTheme.textMuted }}>Management</span><span className="text-sm font-medium" style={{ color: activeTheme.text }}>{device.managementMode || device.summary?.managementMode || 'N/A'}</span></div>
            </div>
          </div>
          <div>
            <h4 className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: activeTheme.textMuted }}>Operating System</h4>
            <div className="p-4 rounded-xl border space-y-3" style={{ backgroundColor: activeTheme.bg, borderColor: activeTheme.border }}>
              <div className="flex justify-between"><span className="text-xs font-medium" style={{ color: activeTheme.textMuted }}>OS Version</span><span className="text-sm font-medium" style={{ color: activeTheme.text }}>{device.summary?.osVersion || '—'}</span></div>
            </div>
          </div>
          <div>
            <h4 className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: activeTheme.textMuted }}>Management Lifecycle</h4>
            <div className="p-4 rounded-xl border space-y-3" style={{ backgroundColor: activeTheme.bg, borderColor: activeTheme.border }}>
              <div className="flex justify-between"><span className="text-xs font-medium" style={{ color: activeTheme.textMuted }}>Enrolled</span><span className="text-sm font-medium" style={{ color: activeTheme.text }}>{device.enrolledDate ? device.enrolledDate.split('T')[0] : '—'}</span></div>
              <div className="flex justify-between"><span className="text-xs font-medium" style={{ color: activeTheme.textMuted }}>Last reported</span><span className="text-sm font-medium" style={{ color: activeTheme.text }}>{device.lastStatusReportTime ? device.lastStatusReportTime.split('T')[0] : '—'}</span></div>
            </div>
          </div>
          {activePolicies.length > 0 && (
            <div>
              <h4 className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: activeTheme.textMuted }}>Active Policies</h4>
              <div className="flex flex-wrap gap-2">
                {activePolicies.map((p, i) => (
                  <span key={i} className="px-3 py-1.5 rounded-lg text-xs font-medium border flex items-center gap-2" style={{ backgroundColor: activeTheme.bg, borderColor: activeTheme.border, color: activeTheme.text }}>
                     <ShieldAlert size={14} style={{color: activeTheme.textMuted}} /> {p}
                  </span>
                ))}
              </div>
            </div>
          )}
          {device.tags && device.tags.length > 0 && (
            <div>
              <h4 className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: activeTheme.textMuted }}>Tags</h4>
              <div className="flex flex-wrap gap-1.5">
                {device.tags.map((t, i) => (
                  <span key={i} className="px-2 py-0.5 text-[10px] font-medium rounded-full border" style={{ color: activeTheme.textMuted, borderColor: activeTheme.border }}>
                    #{typeof t === 'string' ? t : t.value || String(t)}
                  </span>
                ))}
              </div>
            </div>
          )}
          <div>
            <h4 className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: activeTheme.textMuted }}>Last Location</h4>
            {loadingExtras ? (
               <div className="animate-pulse h-24 rounded-xl" style={{ backgroundColor: activeTheme.bg }}></div>
            ) : locations.length > 0 ? (
               <div className="p-4 rounded-xl space-y-3 border transition-all" style={{ backgroundColor: `${PRIMARY_BLUE}08`, borderColor: activeTheme.border }}>
                 <div className="flex items-center justify-between">
                   <span className="px-2 py-1 text-[10px] font-bold rounded flex items-center gap-1.5" style={{ backgroundColor: `${PRIMARY_BLUE}15`, color: PRIMARY_BLUE }}><Smartphone size={12}/> Agent</span>
                   <span className="text-xs font-medium flex items-center gap-1.5" style={{ color: activeTheme.textMuted }}><Clock size={12}/> {locations[0].date ? locations[0].date.replace('T', ' ').substring(0, 16) : '—'}</span>
                 </div>
                 <div className="flex items-start gap-2 pt-2">
                   <MapPin size={16} className="mt-0.5 shrink-0" style={{ color: PRIMARY_BLUE }} />
                   <div className="flex flex-col">
                     <span className="text-sm font-bold" style={{ color: activeTheme.text }}>{locations[0].address?.address || 'Unknown Address'} {locations[0].address?.number || ''}</span>
                     <span className="text-xs" style={{ color: activeTheme.textMuted }}>{[locations[0].address?.postalCode, locations[0].address?.city, locations[0].address?.country].filter(Boolean).join(', ')}</span>
                   </div>
                 </div>
								 <div className="flex items-center gap-2 pb-2">
					  <Target size={14} className="shrink-0" style={{ color: activeTheme.textMuted }} />
					  <a 
					    href={`https://www.google.com/maps/search/?api=1&query=${locations[0].latitude},${locations[0].longitude}`}
					    target="_blank" 
					    rel="noopener noreferrer"
					    className="text-xs font-mono hover:underline transition-all" 
					    style={{ color: PRIMARY_BLUE }}
					    title="View on Google Maps"
					  >
					    {locations[0].latitude}, {locations[0].longitude}
					  </a>
		  		</div>
          {/* Mini Embedded Map */}
          <div className="w-full h-72 mt-2 rounded-lg overflow-hidden border" style={{ borderColor: activeTheme.border }}>
            <iframe 
              width="100%" 
              height="100%" 
              frameBorder="0" 
              scrolling="no" 
              marginHeight="0" 
              marginWidth="0" 
              src={`https://www.openstreetmap.org/export/embed.html?bbox=${parseFloat(locations[0].longitude)-0.005},${parseFloat(locations[0].latitude)-0.005},${parseFloat(locations[0].longitude)+0.005},${parseFloat(locations[0].latitude)+0.005}&layer=mapnik&marker=${locations[0].latitude},${locations[0].longitude}`}
            />        
          </div>          
                 {locations.length > 1 && (
                   <>
                     {showLocationHistory ? (
                       <div className="pt-4 border-t space-y-3" style={{ borderColor: activeTheme.border }}>
                         <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: activeTheme.textMuted }}>Previous Locations</div>
                         {locations.slice(1).map((loc, i) => (
                           <div key={i} className="flex items-center justify-between p-3 rounded-lg border bg-white dark:bg-black/20" style={{ borderColor: activeTheme.border }}>
                              <div className="flex flex-col">
                                 <span className="text-xs font-bold" style={{ color: activeTheme.text }}>{loc.address?.address || 'Unknown Address'}</span>
                                 <a
																	 href={`https://www.google.com/maps/search/?api=1&query=,`}
																	 target="_blank"
																	 rel="noopener noreferrer"
																	 className="text-[10px] font-mono mt-0.5 hover:underline transition-all"
																	 style={{ color: PRIMARY_BLUE }}
																	 title="View on Google Maps"
																 >
																	 {loc.latitude}, {loc.longitude}
																 </a>
                              </div>
                              <span className="text-[10px] font-medium" style={{ color: activeTheme.textMuted }}>{loc.date ? loc.date.replace('T', ' ').substring(0, 16) : ''}</span>
                           </div>
                         ))}
                         <button onClick={() => setShowLocationHistory(false)} className="w-full py-2 rounded-lg text-xs font-bold transition-colors mt-2 text-slate-500 hover:bg-black/5 dark:hover:bg-white/5">Hide history</button>
                       </div>
                     ) : (
                       <button onClick={() => setShowLocationHistory(true)} className="w-full py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2" style={{ backgroundColor: `${PRIMARY_BLUE}15`, color: PRIMARY_BLUE }}>
                          <Clock size={14} /> View location history ({locations.length - 1})
                       </button>
                     )}
                   </>
                 )}
               </div>
            ) : (
               <div className="text-sm font-medium flex items-center gap-2 p-4 rounded-xl border" style={{ backgroundColor: activeTheme.bg, borderColor: activeTheme.border, color: activeTheme.textMuted }}><MapPin size={16}/> No location data available</div>
            )}
          </div>
          <div>
            <h4 className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: activeTheme.textMuted }}>Network Status</h4>
            {loadingExtras ? (
               <div className="animate-pulse h-24 rounded-xl" style={{ backgroundColor: activeTheme.bg }}></div>
            ) : network ? (
               <div className="p-4 rounded-xl border flex flex-col gap-2.5 transition-all" style={{ backgroundColor: `${netColor}08`, borderColor: `${netColor}30` }}>
                 <div className="flex items-center justify-between">
                   <div className="flex items-center gap-2">
                     <NetIcon size={16} style={{ color: netColor }} />
                     <span className="text-sm font-bold" style={{ color: netColor }}>{netType}</span>
                   </div>
                   {signalPct !== null && (
                     <div className="flex items-center gap-2">
                       <span className="text-[11px]" style={{ color: activeTheme.textMuted }}>{Math.round(signalPct * 100)}%</span>
                       <div className="w-10 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: activeTheme.border }}>
                         <div className="h-full rounded-full" style={{ width: `${signalPct * 100}%`, backgroundColor: netColor }}></div>
                       </div>
                     </div>
                   )}
                 </div>
                 
                 {(carrierName || simState) && (
                   <div className="flex items-center gap-2 mt-1">
                     <Cpu size={12} style={{ color: activeTheme.textMuted }} />
                     <span className="text-xs" style={{ color: activeTheme.textMuted }}>{[carrierName, simState].filter(Boolean).join(' · ')}</span>
                   </div>
                 )}
                 
                 {pointCity && (
                   <div className="flex items-center gap-2">
                     <MapPin size={12} style={{ color: activeTheme.textMuted }} />
                     <span className="text-xs" style={{ color: activeTheme.textMuted }}>{pointCity}</span>
                   </div>
                 )}
                 
                 {netDate && (
                   <div className="flex items-center gap-2">
                     <Clock size={12} style={{ color: activeTheme.textMuted }} />
                     <span className="text-xs" style={{ color: activeTheme.textMuted }}>{netDate}</span>
                   </div>
                 )}
               </div>
            ) : (
               <div className="text-sm font-medium flex items-center gap-2 p-4 rounded-xl border" style={{ backgroundColor: activeTheme.bg, borderColor: activeTheme.border, color: activeTheme.textMuted }}><WifiOff size={16}/> No network data available</div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'Compliance' && (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
          {loadingCompliance ? (
            <div className="animate-pulse h-24 rounded-xl" style={{ backgroundColor: activeTheme.bg }}></div>
          ) : complianceError ? (
            <div className="text-sm font-medium flex items-center gap-2 p-4 rounded-xl border" style={{ backgroundColor: activeTheme.bg, borderColor: activeTheme.border, color: activeTheme.textMuted }}>
              <ShieldAlert size={16}/> {complianceError}
            </div>
          ) : compliance ? (
            <>
              <div>
                <h4 className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: activeTheme.textMuted }}>Risk Score</h4>
                <div className="p-4 rounded-xl border" style={{ backgroundColor: activeTheme.bg, borderColor: activeTheme.border }}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xl font-black" style={{ color: (INSIGHT_RISK_TIER_META[compliance.riskTier] || INSIGHT_RISK_TIER_META.low).color }}>
                      {typeof compliance.riskScore === 'number' ? compliance.riskScore : 'N/A'}
                      <span className="text-xs font-medium" style={{ color: activeTheme.textMuted }}>/100</span>
                    </span>
                    <span className="px-2.5 py-1 text-[10px] font-bold uppercase rounded-full" style={{ backgroundColor: `${(INSIGHT_RISK_TIER_META[compliance.riskTier] || INSIGHT_RISK_TIER_META.low).color}15`, color: (INSIGHT_RISK_TIER_META[compliance.riskTier] || INSIGHT_RISK_TIER_META.low).color }}>
                      {(INSIGHT_RISK_TIER_META[compliance.riskTier] || INSIGHT_RISK_TIER_META.low).label} risk
                    </span>
                  </div>
                  {typeof compliance.riskScore === 'number' && (
                    <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: activeTheme.border }}>
                      <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(Math.max(compliance.riskScore, 0), 100)}%`, backgroundColor: (INSIGHT_RISK_TIER_META[compliance.riskTier] || INSIGHT_RISK_TIER_META.low).color }} />
                    </div>
                  )}
                </div>
              </div>

              {(compliance.riskFactors || []).length > 0 && (
                <div>
                  <h4 className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: activeTheme.textMuted }}>Risk Factors</h4>
                  <div className="p-4 rounded-xl border space-y-2" style={{ backgroundColor: activeTheme.bg, borderColor: activeTheme.border }}>
                    {compliance.riskFactors.map((f, i) => (
                      <div key={i} className="flex items-center justify-between text-sm">
                        <span style={{ color: activeTheme.text }}>{f.label}</span>
                        <span className="text-xs font-semibold" style={{ color: (INSIGHT_RISK_TIER_META[compliance.riskTier] || INSIGHT_RISK_TIER_META.low).color }}>+{f.points}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <h4 className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: activeTheme.textMuted }}>
                  Compliance Policy Violations{(compliance.policyViolations || []).length ? ` (${compliance.policyViolations.length})` : ''}
                </h4>
                {(compliance.policyViolations || []).length > 0 ? (
                  <div className="space-y-1.5">
                    {compliance.policyViolations.map((v, i) => (
                      <div key={v.policyId || i} className="flex items-center justify-between gap-2 px-4 py-2.5 rounded-xl border text-sm" style={{ backgroundColor: activeTheme.bg, borderColor: activeTheme.border }}>
                        <span className="truncate" style={{ color: activeTheme.text }}>{v.policyName || 'Unknown policy'}</span>
                        <span className="text-[10px] font-semibold shrink-0 uppercase" style={{ color: v.status === 'pending' ? WARNING : v.status === 'auto_fired' ? PRIMARY_BLUE : activeTheme.textMuted }}>
                          {String(v.status || '').replace('_', ' ') || '—'}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-sm font-medium flex items-center gap-2 p-4 rounded-xl border" style={{ backgroundColor: activeTheme.bg, borderColor: activeTheme.border, color: SUCCESS }}>
                    <ShieldCheck size={16}/> No open Compliance Policy violations for this device.
                  </div>
                )}
              </div>

              {(compliance.openCases || []).length > 0 && (
                <div>
                  <h4 className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: activeTheme.textMuted }}>Open Cases ({compliance.openCases.length})</h4>
                  <div className="space-y-1.5">
                    {compliance.openCases.map((c) => (
                      <div key={c.id} className="flex items-center justify-between gap-2 px-4 py-2.5 rounded-xl border text-sm" style={{ backgroundColor: activeTheme.bg, borderColor: activeTheme.border }}>
                        <span className="truncate" style={{ color: activeTheme.text }}>{c.title}</span>
                        <span className="text-[10px] font-semibold shrink-0" style={{ color: PRIMARY_BLUE }}>{c.severity}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="text-sm font-medium flex items-center justify-center p-8 rounded-xl border" style={{ backgroundColor: activeTheme.bg, borderColor: activeTheme.border, color: activeTheme.textMuted }}>No compliance data available</div>
          )}
        </div>
      )}

      {activeTab === 'Assets' && (
        <div className="space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
           {loadingExtras ? (
             <div className="animate-pulse h-20 rounded-xl" style={{ backgroundColor: activeTheme.bg }}></div>
           ) : assets.length > 0 ? (
             assets.map((asset, i) => (
               <div key={i} className="p-4 rounded-xl border flex justify-between items-center" style={{ backgroundColor: activeTheme.bg, borderColor: activeTheme.border }}>
                 <div className="flex items-center gap-4">
                   <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${PRIMARY_BLUE}15`, color: PRIMARY_BLUE }}><Briefcase size={20} /></div>
                   <div className="flex flex-col">
                     <span className="text-sm font-bold" style={{ color: activeTheme.text }}>{asset.name || 'Unnamed Asset'}</span>
                     <span className="text-xs mt-0.5 uppercase tracking-wider" style={{ color: activeTheme.textMuted }}>{asset.type || 'APP'} {asset.originalExtension ? `• ${asset.originalExtension}` : ''}</span>
                   </div>
                 </div>
                 <span className="text-xs font-mono font-medium" style={{ color: activeTheme.textMuted }}>{asset.size ? (asset.size / 1024 / 1024).toFixed(2) + ' MB' : ''}</span>
               </div>
             ))
           ) : (
             <div className="text-sm font-medium flex items-center justify-center p-8 rounded-xl border" style={{ backgroundColor: activeTheme.bg, borderColor: activeTheme.border, color: activeTheme.textMuted }}>No assets found</div>
           )}
        </div>
      )}

      {activeTab === 'Agent' && (
        <div className="space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
           {loadingExtras ? (
             <div className="animate-pulse h-20 rounded-xl" style={{ backgroundColor: activeTheme.bg }}></div>
           ) : logs.length > 0 ? (
             logs.map((log, i) => (
               <div key={i} className="p-4 rounded-xl border space-y-2" style={{ backgroundColor: activeTheme.bg, borderColor: activeTheme.border }}>
                 <div className="flex justify-between items-center mb-2">
                   <span className="px-2.5 py-1 text-[10px] font-light rounded-full border border-current/25" style={{ backgroundColor: `${PRIMARY_BLUE}15`, color: PRIMARY_BLUE }}>{log.os || 'System'} Agent</span>
                   <span className="text-[11px] font-mono font-medium" style={{ color: activeTheme.textMuted }}>{log.createdAt ? log.createdAt.replace('T', ' ').substring(0, 19) : ''}</span>
                 </div>
                 <p className="text-sm font-mono break-all whitespace-pre-wrap" style={{ color: activeTheme.text }}>{log.content || log.contentError || 'Empty log entry'}</p>
               </div>
             ))
           ) : (
             <div className="text-sm font-medium flex items-center justify-center p-8 rounded-xl border" style={{ backgroundColor: activeTheme.bg, borderColor: activeTheme.border, color: activeTheme.textMuted }}>No agent logs available for this device</div>
           )}
        </div>
      )}
    </div>
  );
}

// ─── COMPONENT: ENTERPRISE APP + BUILDS INSIGHT CARD ───
function AppBuildInsightCard({ app, activeTheme, apiToken, orgSlug }) {
  const [builds, setBuilds] = useState([]);
  const [loading, setLoading] = useState(true);

  const appId = app.id || app._id || '';
  const counts = app.counts || {};

  useEffect(() => {
    if (!apiToken || !orgSlug || !appId) { setLoading(false); return; }
    const headers = { Authorization: `Bearer ${apiToken}` };
    axios.get(`https://api.applivery.io/v1/organizations/${orgSlug}/apps/${appId}/builds/?limit=20&sort=createdAt:desc&status=processed`, { headers })
      .then(res => {
        const items = res.data?.data?.items || [];
        setBuilds(items);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [appId, apiToken, orgSlug]);

  const osColor = (os) => {
    const o = String(os).toLowerCase();
    const _isDarkBuild = activeTheme === THEME.dark;
    if (o.includes('ios') || o.includes('apple') || o.includes('mac')) return getAppleColor(_isDarkBuild);
    if (o.includes('android')) return OFFICIAL_OS_COLORS.android;
    return OFFICIAL_OS_COLORS.windows;
  };

  return (
    <div className="space-y-5">
      {/* App header */}
      <div className="flex items-center gap-4 pb-4 border-b" style={{ borderColor: activeTheme.border }}>
        {app.picture ? (
          <img src={app.picture} className="w-16 h-16 rounded-2xl object-cover" alt={app.name}/>
        ) : (
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ backgroundColor: `${PRIMARY_BLUE}15`, color: PRIMARY_BLUE }}>
            <Box size={28}/>
          </div>
        )}
        <div className="min-w-0">
          <h3 className="text-lg font-bold truncate" style={{ color: activeTheme.text }}>{app.name || 'Enterprise App'}</h3>
          <p className="text-xs font-mono" style={{ color: activeTheme.textMuted }}>{app.slug}</p>
          <div className="flex gap-1.5 mt-1.5 flex-wrap">
            {(app.oss || []).map(os => {
              const c = osColor(os);
              return <span key={os} className="px-2 py-0.5 text-[9px] font-light rounded-full border border-current/25" style={{ backgroundColor: `${c}15`, color: c }}>{os.toUpperCase()}</span>;
            })}
          </div>
        </div>
      </div>

      {/* Counts */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: 'Builds', val: counts.builds || 0 },
          { label: 'Downloads', val: counts.downloads || 0 },
          { label: 'Feedback', val: counts.feedbacks || 0 },
        ].map(s => (
          <div key={s.label} className="p-3 rounded-xl border text-center" style={{ backgroundColor: activeTheme.bg, borderColor: activeTheme.border }}>
            <div className="text-xl font-black" style={{ color: PRIMARY_BLUE }}>{s.val.toLocaleString()}</div>
            <div className="text-[9px] font-bold uppercase tracking-widest mt-0.5" style={{ color: activeTheme.textMuted }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Latest builds */}
      <div>
        <div className="text-[9px] font-bold uppercase tracking-widest mb-2" style={{ color: activeTheme.textMuted }}>Latest Builds</div>
        {loading ? (
          <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="animate-pulse h-12 rounded-xl" style={{ backgroundColor: activeTheme.bg }}></div>)}</div>
        ) : builds.length === 0 ? (
          <div className="text-xs p-4 rounded-xl border text-center" style={{ backgroundColor: activeTheme.bg, borderColor: activeTheme.border, color: activeTheme.textMuted }}>No processed builds found</div>
        ) : (
          <div className="space-y-2">
            {builds.slice(0, 10).map((b, i) => {
              const c = osColor(b.os);
              const uploader = b.uploadedBy ? `${b.uploadedBy.firstName || ''} ${b.uploadedBy.lastName || ''}`.trim() || b.uploadedBy.email : '';
              return (
                <div key={b.id || i} className="flex items-center gap-3 p-3 rounded-xl border" style={{ backgroundColor: activeTheme.bg, borderColor: activeTheme.border }}>
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: `${c}15` }}>
                    <OsIcon platform={b.os} size={14} color={c}/>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold truncate" style={{ color: activeTheme.text }}>v{b.versionName} {b.versionCode ? `(${b.versionCode})` : ''}</div>
                    <div className="text-[10px]" style={{ color: activeTheme.textMuted }}>
                      {(b.createdAt || '').split('T')[0]}{uploader ? ` · ${uploader}` : ''}
                    </div>
                  </div>
                  {b.size && <span className="text-[10px] font-mono shrink-0" style={{ color: activeTheme.textMuted }}>{(b.size/1024/1024).toFixed(1)}MB</span>}
                  {b.deployer?.info?.branch && (
                    <span className="px-2 py-0.5 text-[9px] font-mono rounded shrink-0" style={{ backgroundColor: `${PRIMARY_BLUE}10`, color: PRIMARY_BLUE }}>{b.deployer.info.branch}</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function Dashboard() {
  const [themeMode, setThemeMode] = useState(() => localStorage.getItem('applivery_theme') || 'system');
  const [systemIsDark, setSystemIsDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  const [isThemeMenuOpen, setIsThemeMenuOpen] = useState(false);
  const [isWorkspaceMenuOpen, setIsWorkspaceMenuOpen] = useState(false);
  const [currentView, setCurrentView] = useState('overview');
  // Cross-view navigation intent — set by a click in one view (e.g. a Case
  // chip in the Devices detail drawer), consumed by the destination view
  // once it mounts, same lifted-state pattern as onOpenPlayground/
  // onOpenAppLists elsewhere in this file.
  const [pendingCaseId, setPendingCaseId] = useState(null);
  const [pendingAuditFilter, setPendingAuditFilter] = useState(null); // {id, label} | null
  const [pendingDeviceId, setPendingDeviceId] = useState(null); // arrived from an Audit Log entry's device link
  const [globeDevices, setGlobeDevices] = useState([]);
  const [isChartReady, setIsChartReady] = useState(true);

  // Allow the browser Garbage Collector to flush WebGL before rendering ECharts
  useEffect(() => {
    if (currentView === 'overview') {
      setIsChartReady(false);
      const timer = setTimeout(() => setIsChartReady(true), 150);
      return () => clearTimeout(timer);
    }
  }, [currentView]);

  // Idle session timeout — minutes of inactivity before auto-logout.
  // 30-480 (8h), default 60. See _clamp_session_timeout in main.py. Declared
  // here (ahead of its own value/save-load wiring further down) because the
  // idle-timer effect right below reads it in its dependency array, which
  // is evaluated synchronously during render — declaring it later would be
  // a temporal-dead-zone ReferenceError.
  const [sessionTimeoutMinutes, setSessionTimeoutMinutes] = useState(60);

  // Session Management
  const handleLogout = () => {
    // Clear the whole Applivery session, not just our own dashboard-gate
    // token — apiToken/orgSlug are personal to this user now, not a shared
    // service account, so they must not survive a logout.
    clearAppliverySession();
    window.location.reload();
  };

  useEffect(() => {
    let timeoutId;
    const resetTimer = () => {
      clearTimeout(timeoutId);
      // Auto-logout after the configured idle threshold (Platform Settings
      // > General Configuration; 30min-8h, default 60min — see
      // sessionTimeoutMinutes / _clamp_session_timeout in main.py).
      timeoutId = setTimeout(() => handleLogout(), sessionTimeoutMinutes * 60 * 1000);
    };

    // Listen for any activity to keep the session alive
    window.addEventListener('mousemove', resetTimer);
    window.addEventListener('keydown', resetTimer);
    window.addEventListener('click', resetTimer);
    window.addEventListener('scroll', resetTimer);

    resetTimer(); // Start the timer on mount (and whenever the threshold changes)

    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener('mousemove', resetTimer);
      window.removeEventListener('keydown', resetTimer);
      window.removeEventListener('click', resetTimer);
      window.removeEventListener('scroll', resetTimer);
    };
  }, [sessionTimeoutMinutes]);

  // Proactively renew the Applivery session before it expires, for tabs left
  // open a long time — the boot-time check in App() only covers page loads.
  // Checks every minute; refreshes once we're within a minute of expiry.
  useEffect(() => {
    const interval = setInterval(async () => {
      const expireAt = localStorage.getItem('applivery_apiTokenExpireAt');
      if (!expireAt) return;
      const expiringSoon = new Date(expireAt).getTime() - Date.now() < 60 * 1000;
      if (!expiringSoon) return;
      const ok = await refreshAppliverySession();
      if (ok) {
        setApiToken(localStorage.getItem('applivery_apiToken') || '');
      } else {
        console.error("🔥 Applivery session could not be renewed — signing out.");
        handleLogout();
      }
    }, 60 * 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [isLoadingGlobe, setIsLoadingGlobe] = useState(false);

  const [isSegmentPanelOpen, setIsSegmentPanelOpen] = useState(false);
  const [globalSegment] = useState({ id: 0, name: 'Global' });
  const [selectedSegment, setSelectedSegment] = useState(globalSegment);
  const [segmentsList, setSegmentsList] = useState([]);
  const [segmentSearch, setSegmentSearch] = useState('');
  const [showChildren, setShowChildren] = useState(true);
  const [expandedSegments, setExpandedSegments] = useState({});

  // ── SERVER-SIDE PERSISTENCE ──
  // stateLoaded: false while we're loading from the backend (shows a loading screen)
  const [stateLoaded, setStateLoaded] = useState(false);
  const persistTimerRef = useRef(null);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e) => setSystemIsDark(e.matches);
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, []);

  // Theme also persisted to localStorage as fast local fallback
  useEffect(() => localStorage.setItem('applivery_theme', themeMode), [themeMode]);

  const isDark = themeMode === 'dark' || (themeMode === 'system' && systemIsDark);
  const activeTheme = isDark ? THEME.dark : THEME.light;

  const [dashboard, setDashboard] = useState(DEFAULT_DASHBOARD);
  const [savedDashboardStr, setSavedDashboardStr] = useState(JSON.stringify(getCleanDashboard(DEFAULT_DASHBOARD)));

  const hasUnsavedChanges = JSON.stringify(getCleanDashboard(dashboard)) !== savedDashboardStr;
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('OFFLINE');
  
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  // Which category is showing in the left-nav Settings modal — see SETTINGS_TABS below.
  const [settingsTab, setSettingsTab] = useState('general');
  // Per-workspace automation credential (see /api/settings/automation-credential
  // in main.py) — lets background jobs (compliance scheduler, snapshots,
  // scheduled reports, workflow resumer) act on this workspace without a
  // human logged in. null = not yet fetched.
  const [automationCredentialStatus, setAutomationCredentialStatus] = useState(null);
  const [automationCredentialBusy, setAutomationCredentialBusy] = useState(false);
  // Device-report webhook secret (see /api/settings/device-report-secret) —
  // the shared token a Windows/macOS push script authenticates with when
  // it POSTs to /api/device-data/report for this workspace.
  const [deviceReportSecretStatus, setDeviceReportSecretStatus] = useState(null);
  const [deviceReportSecretBusy, setDeviceReportSecretBusy] = useState(false);
  const [isBuilderOpen, setIsBuilderOpen] = useState(false);
  const [editingWidget, setEditingWidget] = useState(null);
  const [isSourceDropdownOpen, setIsSourceDropdownOpen] = useState(false);
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const [overviewDateRange, setOverviewDateRange] = useState({ label: 'Last 30 Days', from: new Date(Date.now() - 30*24*60*60*1000), to: new Date() });
  const [isReportBuilderModalOpen, setIsReportBuilderModalOpen] = useState(false);
  const [widgetInfoModal, setWidgetInfoModal] = useState(null); // { widget, dataBlock }
  
  const [selectedOrgProfile, setSelectedOrgProfile] = useState(null);
  const [selectedWidgetItems, setSelectedWidgetItems] = useState(null);
  const [activeInsight, setActiveInsight] = useState(null);

  // apiToken also lives in localStorage so the axios interceptor works before state loads
  const [apiToken, setApiToken] = useState(() => localStorage.getItem('applivery_apiToken') || '');
  const [orgSlug, setOrgSlug] = useState(() => localStorage.getItem('applivery_orgSlug') || '');
  
  const [widgetData, setWidgetData] = useState({});
  const [containerWidth, gridRef] = useAutoWidth();

	// --- REPORTING STATE ---
  const [webhookUrl, setWebhookUrl] = useState('');
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  
  // Blank report config factory
  const _blankReportConfig = () => ({
    name: '',
    timeLapse: 'Last 30 Days',
    sources: [],
    delivery: { download: true, chat: false, email: false },
    emailRecipients: '',
    schedule: { 
      enabled: false, 
      frequency: 'weekly', 
      time: '09:00', 
      startDate: new Date(Date.now()+86400000).toISOString().split('T')[0],
      timezone: (function(){ try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch(e) { return 'UTC'; } })()
    },
    filters: { type: 'all', complianceStatus: 'all', inactive24h: false, role: 'all', authOrigin: 'all' },
    display: { trend: true, trend_type: 'line', donut: true, donut_type: 'donut', table: true, table_type: 'standard' }
  });

  // 1. Report Builder form state
  const [reportConfig, setReportConfig] = useState(_blankReportConfig());

  // Scheduled reports list — array of saved configs, each with a unique id
  const [scheduledReports, setScheduledReports] = useState([]);
  const [reportingTab, setReportingTab] = useState('scheduled'); // 'builder' | 'scheduled'
  const [editingReportId, setEditingReportId] = useState(null);

  // 2. New SMTP Config State
  const [smtpConfig, setSmtpConfig] = useState({ host: '', port: '587', user: '', pass: '', from: '' });

  // Full workspace config export/import — see EXPORTABLE_CONFIG_STORES in
  // main.py. Distinct from exportDashboard/importDashboard above, which
  // only ever covered the widget layout + webhookUrl + smtpConfig; this
  // covers Compliance Policies, Workflows, Triggers, Integrations, Case
  // Auto-Run Rules, Case SLA settings, Threat Intel providers, the
  // Applivery webhook config, the Action Library, App Lists, and the
  // Script Library — everything else an admin configures for a workspace.
  const CONFIG_STORE_LABELS = {
    compliancePolicies: 'Compliance Policies', workflows: 'Workflows', triggers: 'Inbound Webhook Triggers',
    integrations: 'Ticketing / Chat / Paging Integrations', caseAutoRunRules: 'Case Auto-Run Rules',
    caseSlaSettings: 'Case SLA thresholds', threatIntelProviders: 'Threat Intel providers',
    appliveryWebhookConfig: 'Applivery inbound webhook config', actionLibrary: 'Action Library',
    appLists: 'App Lists', scriptRepos: 'Script Library', dashboardState: 'Dashboard settings (SMTP, webhook, retention…)',
  };
  const [configImportBundle, setConfigImportBundle] = useState(null); // parsed { schemaVersion, workspaceSlug, exportedAt, data }
  const [configImportSelected, setConfigImportSelected] = useState({}); // { [storeKey]: boolean }
  const [configImporting, setConfigImporting] = useState(false);
  const [configExporting, setConfigExporting] = useState(false);

  async function handleExportWorkspaceConfig() {
    setConfigExporting(true);
    try {
      const res = await axios.get('/api/config/export', { headers: { 'X-Workspace-Slug': orgSlug } });
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(res.data, null, 2));
      const a = document.createElement('a');
      a.setAttribute("href", dataStr);
      a.setAttribute("download", `applivery_soar_config_${orgSlug}_${new Date().toISOString().slice(0, 10)}.json`);
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      alert('Export failed: ' + (e.response?.data?.detail || e.message));
    } finally {
      setConfigExporting(false);
    }
  }

  function handleConfigImportFileChosen(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsed = JSON.parse(e.target.result);
        if (!parsed.data || typeof parsed.data !== 'object') {
          alert('This does not look like a workspace config export (no "data" object found).');
          return;
        }
        setConfigImportBundle(parsed);
        setConfigImportSelected({});
      } catch (err) {
        alert('Error parsing the JSON file.');
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  }

  async function handleConfigImportConfirm() {
    if (!configImportBundle) return;
    const stores = Object.entries(configImportSelected).filter(([, v]) => v).map(([k]) => k);
    if (stores.length === 0) {
      alert('Select at least one item to import.');
      return;
    }
    if (!window.confirm(`This will OVERWRITE the current ${stores.length === 1 ? 'item' : `${stores.length} items`} in this workspace with the imported data. This cannot be undone. Continue?`)) return;
    setConfigImporting(true);
    try {
      const res = await axios.post('/api/config/import', {
        schemaVersion: configImportBundle.schemaVersion, data: configImportBundle.data, stores,
      }, { headers: { 'X-Workspace-Slug': orgSlug } });
      alert(`Imported: ${(res.data?.imported || []).map(k => CONFIG_STORE_LABELS[k] || k).join(', ') || 'nothing'}`);
      setConfigImportBundle(null);
      setConfigImportSelected({});
    } catch (e) {
      alert('Import failed: ' + (e.response?.data?.detail || e.message));
    } finally {
      setConfigImporting(false);
    }
  }

  // 3. Timezone Config State
  const [userTimezone, setUserTimezone] = useState(() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch(e) { return 'UTC'; }
  });
  
  // 3b. Custom Template State
  const [customReportTemplate, setCustomReportTemplate] = useState('');

  // Audit log retention — 0 = keep forever; see AUDIT_LOG_RETENTION_PRESETS in main.py
  const [auditLogRetentionDays, setAuditLogRetentionDays] = useState(90);
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);

  // Trigger modal when tab is selected, then reset tab so background stays valid
  useEffect(() => {
    if (reportingTab === 'template') {
      setIsTemplateModalOpen(true);
      setReportingTab('builder'); // Reset to builder so the UI behind the modal looks correct
    }
  }, [reportingTab]);

  // 4. Auth — currentUser comes straight from the Applivery login response
  // (see AuthScreen.finishLogin), not from an SSO round-trip anymore.
  const [currentUser, setCurrentUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('applivery_user') || 'null'); } catch (e) { return null; }
  });
  const [organizations, setOrganizations] = useState(() => {
    try { return JSON.parse(localStorage.getItem('applivery_organizations') || '[]'); } catch (e) { return []; }
  });

  // ── SOAR RBAC — resolved once per boot by App()'s gateAccess() before this
  // component ever mounts (see resolveSoarAccess/getStoredAccess above).
  // isSuperAdmin bypasses every gate; otherwise hasFeatureAccess/
  // hasRiskyAction read access.role.featureAccess/riskyActions, mirroring
  // require_permission in main.py exactly.
  const [access] = useState(() => getStoredAccess());
  const isSuperAdmin = !!access?.isSuperAdmin;
  const canManageWorkspaceConfig = hasRiskyAction(access, 'canExportOrImportConfig');
  const canDeletePolicyOrWorkflow = hasRiskyAction(access, 'canDeletePolicyOrWorkflow');
  const canRunDestructiveWorkflow = hasRiskyAction(access, 'canRunDestructiveWorkflow');
  const canEditIntegrationSecrets = hasRiskyAction(access, 'canEditIntegrationSecrets');
  const canBulkTriage = hasRiskyAction(access, 'canBulkTriage');

  // ── New-workspace onboarding ──
  // Checked once per landing (fresh login, or after handleSwitchOrganization's
  // full reload — both are a fresh Dashboard mount, so a single mount-time
  // effect covers both) via the cheap, non-auditing GET /api/config/
  // workspace-status. Only offered once per still-empty workspace per
  // browser — dismissing it (either "Start from scratch" or the X) sets a
  // per-workspace localStorage flag so it doesn't nag on every login while
  // the admin is still in the middle of configuring things by hand.
  const [isOnboardingModalOpen, setIsOnboardingModalOpen] = useState(false);
  useEffect(() => {
    if (!apiToken || !orgSlug) return;
    let cancelled = false;
    try {
      if (localStorage.getItem(`applivery_onboarding_dismissed_${orgSlug}`) === '1') return;
    } catch (e) { /* ignore */ }
    axios.get('/api/config/workspace-status', { headers: { Authorization: `Bearer ${apiToken}`, 'X-Workspace-Slug': orgSlug } })
      .then(res => { if (!cancelled && res.data?.isEmpty) setIsOnboardingModalOpen(true); })
      .catch(() => { /* non-critical — just skip onboarding if the check fails */ });
    return () => { cancelled = true; };
  }, [apiToken, orgSlug]);

  const userDisplayName = currentUser?.fullName || currentUser?.email || 'Signed in';
  const userInitials = userDisplayName.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() || '??';

  function handleSwitchOrganization(newSlug) {
    if (!newSlug || newSlug === orgSlug) return;
    setOrgSlug(newSlug);
    localStorage.setItem('applivery_orgSlug', newSlug);
    window.location.reload();
  }

  const handleTestSMTP = async () => {
    if (!smtpConfig.host || !smtpConfig.user) {
      return alert("Please fill in the SMTP Host and Username first.");
    }
    if (!currentUser?.email) {
      return alert("No signed-in user email to send the test to.");
    }
    try {
      await axios.post('/api/settings/test-smtp', {
        smtpConfig,
        testRecipient: currentUser.email
      }, {
        headers: { 'Authorization': `Bearer ${apiToken}`, 'X-Workspace-Slug': orgSlug }
      });
      alert(`✅ SMTP Test Successful! A test email was sent to ${currentUser.email}.`);
    } catch (err) {
      alert("SMTP Test Failed:\n\n" + (err.response?.data?.detail || err.message));
    }
  };

  // Fetch this workspace's automation credential status whenever Settings
  // opens or the active workspace changes (switching workspaces re-scopes
  // everything via a full reload, but this also covers opening Settings
  // more than once in the same session).
  useEffect(() => {
    if (!isSettingsModalOpen || !orgSlug) return;
    let cancelled = false;
    setAutomationCredentialStatus(null);
    axios.get('/api/settings/automation-credential', { headers: { 'X-Workspace-Slug': orgSlug } })
      .then(res => { if (!cancelled) setAutomationCredentialStatus(res.data); })
      .catch(() => { if (!cancelled) setAutomationCredentialStatus({ configured: false }); });
    return () => { cancelled = true; };
  }, [isSettingsModalOpen, orgSlug]);

  const handleUseSessionForAutomation = async () => {
    const refreshToken = localStorage.getItem('applivery_refreshToken');
    if (!apiToken || !refreshToken) {
      return alert("No active Applivery session to use — please sign in again.");
    }
    setAutomationCredentialBusy(true);
    try {
      await axios.post('/api/settings/automation-credential', {
        apiToken,
        refreshToken,
        apiTokenExpireAt: localStorage.getItem('applivery_apiTokenExpireAt') || null,
        refreshTokenExpireAt: localStorage.getItem('applivery_refreshTokenExpireAt') || null,
      }, { headers: { 'X-Workspace-Slug': orgSlug } });
      const res = await axios.get('/api/settings/automation-credential', { headers: { 'X-Workspace-Slug': orgSlug } });
      setAutomationCredentialStatus(res.data);
    } catch (err) {
      alert("Failed to configure automation credential:\n\n" + (err.response?.data?.detail || err.message));
    } finally {
      setAutomationCredentialBusy(false);
    }
  };

  const handleClearAutomationCredential = async () => {
    if (!confirm(`Remove the stored automation credential for "${orgSlug}"? Background jobs (compliance checks, snapshots, scheduled reports) for this workspace will stop running until a new one is configured.`)) return;
    setAutomationCredentialBusy(true);
    try {
      await axios.delete('/api/settings/automation-credential', { headers: { 'X-Workspace-Slug': orgSlug } });
      setAutomationCredentialStatus({ configured: false });
    } catch (err) {
      alert("Failed to remove automation credential:\n\n" + (err.response?.data?.detail || err.message));
    } finally {
      setAutomationCredentialBusy(false);
    }
  };

  // Same open/workspace-change trigger as the automation credential fetch above.
  useEffect(() => {
    if (!isSettingsModalOpen || !orgSlug) return;
    let cancelled = false;
    setDeviceReportSecretStatus(null);
    axios.get('/api/settings/device-report-secret', { headers: { 'X-Workspace-Slug': orgSlug } })
      .then(res => { if (!cancelled) setDeviceReportSecretStatus(res.data); })
      .catch(() => { if (!cancelled) setDeviceReportSecretStatus({ configured: false }); });
    return () => { cancelled = true; };
  }, [isSettingsModalOpen, orgSlug]);

  const handleRotateDeviceReportSecret = async () => {
    const isRotating = deviceReportSecretStatus?.configured;
    if (isRotating && !confirm(`Generate a new webhook secret for "${orgSlug}"? Any script still using the old one will start getting rejected (401) immediately.`)) return;
    setDeviceReportSecretBusy(true);
    try {
      const res = await axios.post('/api/settings/device-report-secret', {}, { headers: { 'X-Workspace-Slug': orgSlug } });
      setDeviceReportSecretStatus(res.data);
    } catch (err) {
      alert("Failed to generate webhook secret:\n\n" + (err.response?.data?.detail || err.message));
    } finally {
      setDeviceReportSecretBusy(false);
    }
  };

  const handleClearDeviceReportSecret = async () => {
    if (!confirm(`Remove the device-report webhook secret for "${orgSlug}"? The webhook will reject every report from this workspace's devices until a new secret is generated.`)) return;
    setDeviceReportSecretBusy(true);
    try {
      await axios.delete('/api/settings/device-report-secret', { headers: { 'X-Workspace-Slug': orgSlug } });
      setDeviceReportSecretStatus({ configured: false });
    } catch (err) {
      alert("Failed to remove webhook secret:\n\n" + (err.response?.data?.detail || err.message));
    } finally {
      setDeviceReportSecretBusy(false);
    }
  };

  // Installed-app inventory reporter scripts (macOS .sh / Windows .ps1) —
  // fetches the raw template (placeholders intact) from the backend, fills
  // in the three values the browser already knows (public origin, workspace
  // slug, the fetched secret), and triggers a download. Substitution happens
  // here rather than server-side because the backend has no reliable way to
  // know the public URL an admin's device fleet should actually reach.
  const [downloadingScript, setDownloadingScript] = useState(null); // 'macos' | 'windows' | null
  const handleDownloadReportScript = async (platform) => {
    if (!deviceReportSecretStatus?.secret) return;
    setDownloadingScript(platform);
    try {
      const res = await axios.get(`/api/settings/device-report-scripts/${platform}`, {
        headers: { 'X-Workspace-Slug': orgSlug },
        responseType: 'text',
      });
      const webhookUrl = `${window.location.origin}/api/device-data/report-apps`;
      const filled = res.data
        .replaceAll('__WEBHOOK_URL__', webhookUrl)
        .replaceAll('__WORKSPACE_SLUG__', orgSlug)
        .replaceAll('__REPORT_SECRET__', deviceReportSecretStatus.secret);
      const filename = platform === 'macos' ? 'report-installed-apps.sh' : 'report-installed-apps.ps1';
      const blob = new Blob([filled], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      alert("Failed to download script:\n\n" + (err.response?.data?.detail || err.message));
    } finally {
      setDownloadingScript(null);
    }
  };

  // Security-attestation reporter script — same fetch-template/
  // fill-placeholders/download pattern as the app-inventory script above,
  // but posts to the generic /api/device-data/report webhook (not
  // /report-apps) since these attributes flow through WINDOWS_ATTR_ALIASES/
  // MACOS_ATTR_ALIASES into the Self-Reported Attribute compliance
  // condition type, not the app-inventory store. Android/iOS have no
  // equivalent — see SECURITY_REPORT_SCRIPT_FILES comment in main.py.
  const [downloadingSecurityScript, setDownloadingSecurityScript] = useState(null); // null | 'windows' | 'macos'
  const handleDownloadSecurityReportScript = async (platform) => {
    if (!deviceReportSecretStatus?.secret) return;
    setDownloadingSecurityScript(platform);
    try {
      const res = await axios.get(`/api/settings/device-report-scripts-security/${platform}`, {
        headers: { 'X-Workspace-Slug': orgSlug },
        responseType: 'text',
      });
      const webhookUrl = `${window.location.origin}/api/device-data/report`;
      const filled = res.data
        .replaceAll('__WEBHOOK_URL__', webhookUrl)
        .replaceAll('__WORKSPACE_SLUG__', orgSlug)
        .replaceAll('__REPORT_SECRET__', deviceReportSecretStatus.secret);
      const filename = platform === 'macos' ? 'report-security-attributes.sh' : 'report-security-attributes.ps1';
      const blob = new Blob([filled], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      alert("Failed to download script:\n\n" + (err.response?.data?.detail || err.message));
    } finally {
      setDownloadingSecurityScript(null);
    }
  };

  // --- PLAYGROUND SYNC STATE ---
  const [isSyncingLocations, setIsSyncingLocations] = useState(false);
  const [isGlobeRotationPaused, setIsGlobeRotationPaused] = useState(false);
  // 'globe' (default 3D view) or 'map' (flat, zoomed-in, clustered — see
  // PlaygroundMapView). Switches automatically once the user zooms the
  // globe in past GLOBE_TO_MAP_ALTITUDE_THRESHOLD, or manually via the
  // toolbar toggle either direction.
  const [playgroundMode, setPlaygroundMode] = useState('globe');
  const [playgroundMapCenter, setPlaygroundMapCenter] = useState({ lat: 20, lng: 0 });
  const handleGlobeZoom = useCallback((pov) => {
    if (pov && pov.altitude < GLOBE_TO_MAP_ALTITUDE_THRESHOLD) {
      setPlaygroundMapCenter({ lat: pov.lat, lng: pov.lng });
      setPlaygroundMode('map');
    }
  }, []);
  const [showOnlyNonCompliantGlobe, setShowOnlyNonCompliantGlobe] = useState(false);
  const [globeCompliancePolicies, setGlobeCompliancePolicies] = useState([]);
  const [selectedGlobePolicyId, setSelectedGlobePolicyId] = useState('');
  const [globePolicyViolatingIds, setGlobePolicyViolatingIds] = useState(null); // null = no policy filter active
  const [isLoadingGlobePolicyFilter, setIsLoadingGlobePolicyFilter] = useState(false);

  const handleSyncLocations = async () => {
    setIsSyncingLocations(true);
    try {
        await axios.post('/api/analytics/locations/sync', {}, {
            headers: { 'Authorization': `Bearer ${apiToken}`, 'X-Workspace-Slug': orgSlug }
        });
        const res = await axios.get(`/api/analytics/widget`, {
            params: { source: 'mdm_devices', chart_type: 'list', filters: "{}" },
            headers: { 'Authorization': `Bearer ${apiToken}`, 'X-Workspace-Slug': orgSlug }
        });
        setGlobeDevices(res.data?.items || []);
    } catch (err) {
        console.error("Location sync failed", err);
        alert(err.response?.data?.detail || "Failed to sync GPS coordinates.");
    } finally {
        setIsSyncingLocations(false);
    }
  };
 
  // ── LOAD STATE FROM SERVER ON MOUNT ──
  useEffect(() => {
    axios.get('/api/state', {
      headers: { 'X-Workspace-Slug': 'global' }
    }).then(res => {
      const s = res.data || {};
      if (s.dashboard && s.dashboard.widgets && s.dashboard.layout) {
        setDashboard(s.dashboard);
        setSavedDashboardStr(JSON.stringify(getCleanDashboard(s.dashboard)));
      }
      if (s.themeMode) setThemeMode(s.themeMode);
      // orgSlug/apiToken are personal (set at login, from localStorage only)
      // and intentionally NOT part of this shared, cross-user state blob.
      if (s.webhookUrl !== undefined) setWebhookUrl(s.webhookUrl);
      if (s.smtpConfig) setSmtpConfig(s.smtpConfig);
      if (Array.isArray(s.scheduledReports)) setScheduledReports(s.scheduledReports);
      if (s.timezone) setUserTimezone(s.timezone);
      if (s.customReportTemplate !== undefined) setCustomReportTemplate(s.customReportTemplate);
      if (s.auditLogRetentionDays !== undefined && s.auditLogRetentionDays !== null) setAuditLogRetentionDays(s.auditLogRetentionDays);
      if (s.sessionTimeoutMinutes !== undefined && s.sessionTimeoutMinutes !== null) setSessionTimeoutMinutes(s.sessionTimeoutMinutes);
    }).catch(err => {
      console.warn('Could not load server state, using defaults:', err.message);
    }).finally(() => setStateLoaded(true));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── AUTO-PERSIST STATE TO SERVER (debounced 1.5s) ──
  useEffect(() => {
    if (!stateLoaded) return;
    
    // CRITICAL FIX: Prevent new devices with empty localStorage from wiping the global backend config!
    if (!apiToken || !orgSlug) return; 

    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => {
      const payload = {
        dashboard: getCleanDashboard(dashboard),
        themeMode,
        webhookUrl,
        smtpConfig,
        scheduledReports,
        timezone: userTimezone,
        customReportTemplate,
        auditLogRetentionDays,
        sessionTimeoutMinutes,
      };
      axios.post('/api/state', payload, {
        headers: { 'X-Workspace-Slug': 'global' }
      }).catch(err => console.warn('Auto-persist failed:', err.message));
    }, 1500);
    return () => clearTimeout(persistTimerRef.current);
  }, [dashboard, themeMode, apiToken, orgSlug, webhookUrl, smtpConfig, scheduledReports, userTimezone, customReportTemplate, auditLogRetentionDays, sessionTimeoutMinutes, stateLoaded]);

  useEffect(() => {
    // Keep apiToken in localStorage for the axios interceptor (needed before async load)
    localStorage.setItem('applivery_apiToken', apiToken);
    localStorage.setItem('applivery_orgSlug', orgSlug);
    if (apiToken && orgSlug) setConnectionStatus('ONLINE');
  }, [apiToken, orgSlug]);

  useEffect(() => {
    if (!apiToken || !orgSlug) return;
    const fetchSegments = async () => {
      try {
        const headers = { Authorization: `Bearer ${apiToken}` };
        let orgId = orgSlug;
        if (!/^[a-fA-F0-9]{24}$/.test(orgId)) {
          const orgRes = await axios.get(`https://api.applivery.io/v1/organizations/${orgSlug}`, { headers });
          const orgData = orgRes.data?.data || orgRes.data;
          orgId = orgData.id || orgData._id || orgSlug;
        }
        const treeRes = await axios.get(`https://api.applivery.io/v1/organizations/${orgId}/segments/0`, { headers });
        const rootSegment = treeRes.data?.data;
        if (rootSegment && rootSegment.children) {
           setSegmentsList(rootSegment.children);
           return; 
        }
      } catch (err) {
        console.error("Tree fetch failed, trying fallback", err);
      }
      
      try {
        const fallbackRes = await axios.get(`https://api.applivery.io/v1/organizations/${orgSlug}/segments/by-user`, {
          headers: { Authorization: `Bearer ${apiToken}` }
        });
        const rawList = fallbackRes.data?.data;
        const items = Array.isArray(rawList) ? rawList : (rawList?.items || []);
        const map = new Map();
        items.forEach(n => map.set(n.id !== undefined ? n.id : n._id, { ...n, children: [] }));
        const roots = [];
        items.forEach(n => {
          const id = n.id !== undefined ? n.id : n._id;
          const pId = n.parentId !== undefined ? n.parentId : (n.parent || n.parentSegment);
          const parentId = typeof pId === 'object' && pId ? (pId.id || pId._id) : pId;
          if (parentId != null && map.has(parentId)) map.get(parentId).children.push(map.get(id));
          else roots.push(map.get(id));
        });
        setSegmentsList(roots);
      } catch (e) {
        console.error("Fallback fetch failed", e);
      }
    };
    fetchSegments();
  }, [apiToken, orgSlug]);

  const saveDashboard = async () => {
    setIsSaving(true);
    try {
      const clean = getCleanDashboard(dashboard);
      await axios.post('/api/state', { dashboard: clean }, {
        headers: { 'X-Workspace-Slug': 'global' }
      });
      setSavedDashboardStr(JSON.stringify(clean));
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (err) {
      console.error('Save dashboard failed:', err);
    } finally {
      setIsSaving(false);
    }
  };

	const exportDashboard = () => {
	  // Pack the layout and the non-sensitive settings into the JSON
	  const exportPayload = {
	    ...getCleanDashboard(dashboard),
	    webhookUrl: webhookUrl,
	    smtpConfig: smtpConfig
	  };
	  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportPayload, null, 2));
	  const downloadAnchorNode = document.createElement('a');
	  downloadAnchorNode.setAttribute("href", dataStr);
	  downloadAnchorNode.setAttribute("download", "applivery_dashboard_backup.json");
	  document.body.appendChild(downloadAnchorNode);
	  downloadAnchorNode.click();
	  downloadAnchorNode.remove();
	};

  const importDashboard = (event) => {
      const file = event.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const importedData = JSON.parse(e.target.result);
          if (importedData.widgets && importedData.layout) {
            // 1. Restore Dashboard
            setDashboard(importedData);
            setSavedDashboardStr(JSON.stringify(getCleanDashboard(importedData)));
            // Persist to server immediately
            axios.post('/api/state', { dashboard: getCleanDashboard(importedData) }, {
              headers: { 'X-Workspace-Slug': 'global' }
            }).catch(e => console.warn('Import persist failed:', e));
            
            // 2. Restore Settings
            if (importedData.webhookUrl !== undefined) {
              setWebhookUrl(importedData.webhookUrl);
              localStorage.setItem('applivery_webhookUrl', importedData.webhookUrl);
            }
            if (importedData.smtpConfig !== undefined) {
              setSmtpConfig(importedData.smtpConfig);
              localStorage.setItem('applivery_smtp', JSON.stringify(importedData.smtpConfig));
            }
            setIsSettingsModalOpen(false);
            alert("Dashboard layout and settings successfully imported!");
          } else {
            alert("Invalid dashboard format. Make sure you are using an Applivery Backup JSON.");
          }
        } catch (error) {
          alert("Error parsing the JSON file.");
        }
      };
      reader.readAsText(file);
      event.target.value = '';
    };
  	
  const fetchWidgetData = async (dateRangeOverride) => {
      if (!apiToken || !orgSlug) return;
      const activeRange = dateRangeOverride || overviewDateRange;
      setWidgetData({});
      const results = {};
      // Convert date range to timeLapse string (backend's expected format, same as reports)
      // Also send raw ISO dates + label for backends that support them
      const timeLapse = activeRange.label || 'Last 30 Days';
      await Promise.all(dashboard.widgets.map(async (w) => {
        try {
          const filters = JSON.stringify({
            ...w.filters,
            segmentId: selectedSegment && selectedSegment.id !== 0 ? (selectedSegment.id || selectedSegment._id) : undefined
          });
          const res = await axios.get(`/api/analytics/widget`, {
            params: {
              source: w.stat,
              chart_type: w.type,
              filters,
              timeLapse,
              dateIni: activeRange.from.toISOString().split('T')[0],
              dateEnd: activeRange.to.toISOString().split('T')[0],
            },
            headers: { 'Authorization': `Bearer ${apiToken}`, 'X-Workspace-Slug': orgSlug }
          });
          results[w.id] = res.data;
        } catch (err) {
          console.error(`Error fetching widget ${w.id}:`, err);
          results[w.id] = { error: true };
        }
      }));
      setWidgetData(results);
      setConnectionStatus('ONLINE');
    };

  useEffect(() => {
    if (currentView === 'overview') {
       fetchWidgetData();
       const id = setInterval(fetchWidgetData, 60000);
       return () => clearInterval(id);
    }
  }, [dashboard.widgets, apiToken, orgSlug, currentView, selectedSegment, overviewDateRange.from?.toISOString(), overviewDateRange.to?.toISOString()]);

  useEffect(() => {
    if (currentView === 'playground' && apiToken && orgSlug && globeDevices.length === 0) {
      setIsLoadingGlobe(true);
      axios.get(`/api/analytics/widget`, {
        params: { source: 'mdm_devices', chart_type: 'list', filters: "{}" },
        headers: { 'Authorization': `Bearer ${apiToken}`, 'X-Workspace-Slug': orgSlug }
      }).then(res => {
        const items = res.data?.items || [];
        setGlobeDevices(items);
      }).catch(console.error).finally(() => setIsLoadingGlobe(false));
    }
  }, [currentView, apiToken, orgSlug]);

  // Compliance Policies for the Playground globe's "filter by policy" dropdown
  useEffect(() => {
    if (currentView === 'playground' && apiToken && orgSlug && globeCompliancePolicies.length === 0) {
      axios.get('/api/compliance/policies', { headers: { Authorization: `Bearer ${apiToken}`, 'X-Workspace-Slug': orgSlug } })
        .then(res => setGlobeCompliancePolicies(res.data?.items || []))
        .catch(() => {});
    }
  }, [currentView, apiToken, orgSlug]);

  // When a policy is selected, fetch which devices are *currently* violating it —
  // the globe then shows just those, so admins can see where a specific
  // policy's non-compliance is concentrated geographically.
  useEffect(() => {
    if (!selectedGlobePolicyId) { setGlobePolicyViolatingIds(null); return; }
    let cancelled = false;
    setIsLoadingGlobePolicyFilter(true);
    axios.get(`/api/compliance/policies/${selectedGlobePolicyId}/violating-device-ids`, {
      headers: { Authorization: `Bearer ${apiToken}`, 'X-Workspace-Slug': orgSlug },
    }).then(res => {
      if (!cancelled) setGlobePolicyViolatingIds(new Set(res.data?.deviceIds || []));
    }).catch(() => { if (!cancelled) setGlobePolicyViolatingIds(new Set()); })
      .finally(() => { if (!cancelled) setIsLoadingGlobePolicyFilter(false); });
    return () => { cancelled = true; };
  }, [selectedGlobePolicyId, apiToken, orgSlug]);

  const toggleLock = (id) => {
    setDashboard(prev => {
      const newLayout = prev.layout.map(l => l.i === id ? { ...l, static: !l.static } : l);
      return { ...prev, layout: newLayout };
    });
    setSavedDashboardStr(""); 
  };

  const saveWidgetForm = () => {
    const sizeConfig = SIZES.find(s => s.id === editingWidget.size);
    if (editingWidget.id) {
      setDashboard({
        widgets: dashboard.widgets.map(w => w.id === editingWidget.id ? { ...editingWidget } : w),
        layout: dashboard.layout.map(l => l.i === editingWidget.id ? { ...l, w: sizeConfig.w, h: sizeConfig.h } : l)
      });
    } else {
      const newId = `w-${Date.now()}`;
      setDashboard({
        widgets: [...dashboard.widgets, { ...editingWidget, id: newId }],
        layout: [...dashboard.layout, { i: newId, x: 0, y: Infinity, w: sizeConfig.w, h: sizeConfig.h }]
      });
    }
    setIsBuilderOpen(false);
  };

  const openBuilder = (widget = null) => {
    if (widget) {
      setEditingWidget({ ...widget, filters: widget.filters || {} });
    } else {
      setEditingWidget({ title: 'New metric', stat: 'mdm_devices', type: 'scorecard', size: 'small', filters: {} });
    }
    setIsSourceDropdownOpen(false);
    setIsBuilderOpen(true);
  };

  const updateFilter = (key, value) => {
    setEditingWidget(prev => ({ ...prev, filters: { ...prev.filters, [key]: value } }));
  };

  const selectSource = (item) => {
    const shape = SOURCE_SHAPES[item.stat] || 'listCountOnly';
    const availableCharts = SHAPES[shape] || ['scorecard'];
    // Prefer 'list' as default for grouped/app/user sources, otherwise first in list
    const defaultChart = availableCharts.includes('list') && shape !== 'analyticsKeyed' && shape !== 'analyticsDiscrete'
      ? 'list' : availableCharts[0];
    setEditingWidget(prev => ({
      ...prev, stat: item.stat, type: availableCharts.includes(prev.type) ? prev.type : defaultChart, filters: {} 
    }));
    setIsSourceDropdownOpen(false);
  };

  const removeWidget = (id) => {
    setDashboard({ widgets: dashboard.widgets.filter(w => w.id !== id), layout: dashboard.layout.filter(l => l.i !== id) });
  };

  const handleChartClick = (widget, sliceName = null) => {
    const data = widgetData[widget.id];
    if (!data || !data.items || data.items.length === 0) return;
    let filtered = data.items;
    
    if (sliceName) {
      const name = String(sliceName).toLowerCase().trim();
      
      if (widget.stat === 'stats_compliance') {
        const wantComp = name === 'compliant' || name === 'compliance';
        filtered = filtered.filter(i => i.is_compliant_normalized === wantComp);
      } 
      else if (widget.stat === 'stats_devices_os' || widget.stat === 'mdm_devices' || widget.stat === 'stats_builds_os' || widget.stat === 'app_dist_apps') {
        filtered = filtered.filter(i => {
           // Support arrays (for apps) and single strings (for devices/builds)
           const p_str = JSON.stringify(i.oss || [i.platform_normalized || i.os]).toLowerCase();
           if (name.includes('ios') || name.includes('apple') || name.includes('ipad') || name.includes('mac')) return p_str.includes('apple') || p_str.includes('ios') || p_str.includes('mac');
           if (name.includes('win')) return p_str.includes('windows') || p_str.includes('win');
           if (name.includes('android')) return p_str.includes('android');
           return p_str.includes('other');
        });
      } 
      else if (widget.stat === 'stats_devices_status') {
        filtered = filtered.filter(i => i.state_normalized === name);
      } 
      else if (widget.stat.includes('collaborator') || widget.stat.includes('role') || widget.stat === 'mdm_users' || widget.stat === 'app_dist_store_users') {
        filtered = filtered.filter(i => String(i.role_normalized || 'user').toLowerCase() === name);
      } 
      else if (widget.stat === 'stats_models') {
        filtered = filtered.filter(i => {
          const mfr = String(i.summary?.manufacturer || i.summary?.brand || '').toLowerCase();
          const mod = String(i.summary?.model || i.summary?.name || '').toLowerCase();
          const combined = `${mfr} ${mod}`;
          return combined.includes(name) || name.includes(mod);
        });
      }
      else if (widget.stat === 'mdm_segments') {
        filtered = filtered.filter(i => String(i.name || '').toLowerCase() === name);
      }
      else if (widget.stat === 'stats_battery') {
        filtered = filtered.filter(i => {
          const bat = parseFloat(i.summary?.battery);
          if (isNaN(bat)) return false;
          if (name.includes('less than 20')) return bat >= 0 && bat <= 20;
          if (name.includes('between')) return bat > 20 && bat <= 70;
          if (name.includes('more than 70')) return bat > 70;
          return false;
        });
      }
      else if (widget.stat === 'stats_os_updates_all' || widget.stat === 'stats_os_versions') {
        filtered = filtered.filter(i => {
          const ver = String(i.version || i.osVersion || i.targetVersion || i.value || i.summary?.osVersion || "Unknown").toLowerCase().trim();
          return name.includes(ver);
        });
      }
      else if (widget.stat === 'stats_sync_errors') {
        filtered = filtered.filter(i => {
          const target = String(i.target || "Unknown").replace(/device/i, "").toLowerCase().trim();
          return name.includes(target);
        });
      }
      else if (widget.stat === 'cases_summary') {
        const statusByLabel = { open: 'open', investigating: 'investigating', resolved: 'resolved', closed: 'closed', 'false positive': 'false_positive' };
        const wantStatus = statusByLabel[name] || name;
        filtered = filtered.filter(i => String(i.status || '').toLowerCase() === wantStatus);
      }
    }
    setSelectedWidgetItems({ title: sliceName ? `${widget.title} - ${sliceName}` : widget.title, items: filtered, stat: widget.stat });
  };

  const openInsight = (item) => {
    setSelectedWidgetItems(null);
    setActiveInsight(item);
  };

  const _colorFor = (stat, key, i) => {
    const p = activeTheme.chartPalette;
    const k = String(key).toUpperCase();
    // Battery levels
    if (k.includes('MORE THAN 70')) return '#22C55E';
    if (k.includes('BETWEEN'))      return '#F59E0B';
    if (k.includes('LESS THAN 20')) return '#EF4444';
    // Compliance
    if (k.includes('NON') || k.includes('NOT COMPLI')) return DANGER;
    if (k === 'COMPLIANT' || k === 'COMPLIANCE' || k.includes('COMPLIAN')) return SUCCESS;
    // Device status — each gets a distinct semantic colour
    if (k === 'ACTIVE')   return '#22C55E';   // green
    if (k === 'INACTIVE') return '#F59E0B';   // amber
    if (k === 'PENDING')  return '#3B82F6';   // blue
    if (k === 'DISABLED') return '#9CA3AF';   // grey
    if (k === 'BLOCKED')  return '#EF4444';   // red
    if (k.includes('MEDIUM')) return WARNING;
    // OS colours
    if (k.includes('APPLE') || k.includes('IOS') || k.includes('MAC')) return getAppleColor(isDark);
    if (k.includes('ANDROID')) return OFFICIAL_OS_COLORS.android;
    if (k.includes('WINDOWS') || k.includes('WIN')) return OFFICIAL_OS_COLORS.windows;
    // Collaborator roles
    if (k === 'ADMIN')      return '#A855F7'; // Distinct Purple
    if (k === 'EDITOR')     return '#3B82F6'; // Blue
    if (k === 'VIEWER')     return '#06B6D4'; // Cyan
    if (k === 'OWNER')      return PRIMARY_BLUE; // Deep Blue
    if (k === 'UNASSIGNED') return '#9CA3AF'; // Neutral Gray (matches Applivery 'Temporal' style)
    
    if (stat === 'stats_os_updates_all' || stat === 'stats_models') return p[i % p.length];
    return p[i % p.length];
  };

  const _humanLabel = (raw) => {
    const k = String(raw).toUpperCase();
    if (k.includes('APPLE') || k.includes('IOS')) return 'Apple';
    if (k.includes('ANDROID')) return 'Android';
    if (k.includes('WIN')) return 'Windows';
    if (k.includes('MAC')) return 'macOS';
    if (k === 'ACTIVE') return 'Active';
    if (k === 'INACTIVE') return 'Inactive';
    if (k === 'DISABLED') return 'Disabled';
    if (k.includes('COMPLIANCE') || k.includes('COMPLIANT')) return raw;
    if (k.includes('ADMIN')) return 'Admin';
    if (k.includes('EDITOR')) return 'Editor';
    if (k.includes('VIEWER')) return 'Viewer';
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  };

  const _getOsPlatform = (stat, name, itemOs) => {
      if (itemOs) return itemOs;
      const n = String(name).toLowerCase();
      if (n === 'apple' || n === 'ios' || n.includes('mac') || n.includes('ipad')) return 'apple';
      if (n === 'android') return 'android';
      if (n === 'windows' || n === 'win') return 'windows';
      return null;
  };

  const renderWidgetContent = (widget) => {
    const dataBlock = widgetData[widget.id];
    if (!dataBlock) return <LoadingChartState />;

    const { chartData, trendData, scorecardValue, orgProfile, items } = dataBlock;
    const isClickable = items && items.length > 0;
    const eChartsEvents = { click: (e) => handleChartClick(widget, e.name) };
    const common = { backgroundColor: 'transparent', tooltip: { trigger: 'item', backgroundColor: activeTheme.card, borderColor: activeTheme.border, textStyle: { color: activeTheme.text }, borderRadius: 8, padding: 12 } };

    if (widget.stat === 'org_profile' && orgProfile) {
      const logo = orgProfile.branding?.logo || orgProfile.branding?.picture || '';
      return (
        <div className="flex flex-col items-center justify-center h-full p-4 cursor-pointer hover:opacity-80 transition-opacity gap-2" onClick={() => setSelectedOrgProfile(orgProfile)}>
          {/* Large logo — fills the card nicely */}
          <div className="flex-1 flex items-center justify-center w-full min-h-0 overflow-hidden">
            {logo ? (
              <img src={logo} alt={orgProfile.name} className="max-w-full max-h-full object-contain"
                style={{ maxHeight: '80px' }}
                onError={e => { e.target.style.display = 'none'; }}
              />
            ) : (
              <div className="flex items-center justify-center w-20 h-20 rounded-2xl" style={{ backgroundColor: `${PRIMARY_BLUE}15` }}>
                <Building2 size={44} style={{ color: PRIMARY_BLUE, opacity: 0.7 }} />
              </div>
            )}
          </div>
          {/* Name + slug */}
          <div className="text-center shrink-0 mt-1">
            <div className="text-sm font-bold leading-tight truncate max-w-full" style={{ color: activeTheme.text }}>{orgProfile.name}</div>
            <div className="text-[11px] mt-0.5" style={{ color: activeTheme.textMuted }}>{orgProfile.slug}</div>
          </div>
          <div className="flex items-center gap-1 shrink-0" style={{ color: activeTheme.textMuted }}>
            <Info size={9} /><span className="text-[9px]">Tap for details</span>
          </div>
        </div>
      );
    }

    if (widget.type === 'scorecard') {
      return (
        <ScorecardContent
          value={scorecardValue}
          theme={activeTheme}
          isClickable={isClickable}
          onClick={() => handleChartClick(widget)}
        />
      );
    }

    if (widget.type === 'donut' || widget.type === 'pie') {
      if (!chartData || chartData.length === 0) return <EmptyChartState theme={activeTheme} />;
      const isDonut = widget.type === 'donut';
      const total = chartData.reduce((acc, curr) => acc + curr.value, 0);

      return <DonutPieWidget
        key={widget.id}
        widget={widget}
        chartData={chartData}
        isDonut={isDonut}
        total={total}
        activeTheme={activeTheme}
        isClickable={isClickable}
        handleChartClick={handleChartClick}
        _colorFor={_colorFor}
        _humanLabel={_humanLabel}
        isDark={isDark}
      />;
    }

    if (widget.type === 'line') {
      if (!trendData || trendData.series.length === 0) return <EmptyChartState theme={activeTheme} />;
      const osTotals = trendData.os_totals || {};
      const totalSum = (osTotals.apple || 0) + (osTotals.android || 0) + (osTotals.windows || 0) || scorecardValue;
      return (
        <div className="flex flex-col h-full w-full">
          <div className={`flex-1 w-full min-h-[100px] ${isClickable ? 'cursor-pointer' : ''}`} onClick={isClickable ? () => handleChartClick(widget) : undefined}>
            <ReactECharts opts={{ renderer: 'svg' }} option={{ ...common, tooltip: { trigger: 'axis', backgroundColor: activeTheme.card, borderColor: activeTheme.border, textStyle: { color: activeTheme.text } }, grid: { top: 8, bottom: 28, left: 32, right: 12 }, xAxis: { type: 'category', data: trendData.labels, axisLabel: { color: activeTheme.textMuted, fontSize: 11 }, axisLine: { lineStyle: { color: activeTheme.border } } }, yAxis: { type: 'value', splitLine: { lineStyle: { color: activeTheme.gridLine } }, axisLabel: { color: activeTheme.textMuted, fontSize: 11 } }, series: [{ data: trendData.series, type: 'line', smooth: true, symbolSize: 5, itemStyle: { color: PRIMARY_BLUE }, lineStyle: { width: 2.5, color: PRIMARY_BLUE }, areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: `${PRIMARY_BLUE}33` }, { offset: 1, color: `${PRIMARY_BLUE}00` }] }, opacity: 1 } }] }} style={{ height: '100%', width: '100%' }} notMerge={true} />
          </div>
          {/* OS totals footer */}
          <div className="flex items-center justify-around border-t pt-2.5 pb-1 px-2 shrink-0" style={{ borderColor: activeTheme.border }}>
            {[
              { key: 'TOTAL', val: totalSum, color: activeTheme.text },
              osTotals.apple !== undefined && { key: 'iOS', val: osTotals.apple, color: getAppleColor(isDark) },
              osTotals.android !== undefined && { key: 'Android', val: osTotals.android, color: OFFICIAL_OS_COLORS.android },
              osTotals.windows > 0 && { key: 'Windows', val: osTotals.windows, color: OFFICIAL_OS_COLORS.windows },
            ].filter(Boolean).map(({ key, val, color }) => (
              <div key={key} className="flex flex-col items-center gap-0.5">
                <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: activeTheme.textMuted }}>{key}</span>
                <span className="text-[14px] font-bold tabular-nums" style={{ color }}>{val}</span>
              </div>
            ))}
          </div>
        </div>
      );
    }

    if (widget.type === 'bar') {
      if (!chartData || chartData.length === 0) return <EmptyChartState theme={activeTheme} />;
      return <BarWidget
        key={widget.id}
        widget={widget}
        chartData={chartData}
        activeTheme={activeTheme}
        isClickable={isClickable}
        handleChartClick={handleChartClick}
        _colorFor={_colorFor}
        _humanLabel={_humanLabel}
      />;
    }

    if (widget.type === 'gauge') {
      if (!chartData || chartData.length === 0) return <EmptyChartState theme={activeTheme} />;
      const total = chartData.reduce((acc, curr) => acc + curr.value, 0);
      const primaryItem = chartData[0];
      const val = total > 0 ? Math.round((primaryItem.value / total) * 100) : 0;
      const color = _colorFor(widget.stat, primaryItem.name, 0);
      return (
        <div className="h-full w-full flex items-center justify-center" style={{ cursor: isClickable ? 'pointer' : 'default' }} onClick={isClickable ? () => handleChartClick(widget, primaryItem.name) : undefined}>
          <ReactECharts
            opts={{ renderer: 'svg' }}
            onEvents={eChartsEvents}
            option={{ ...common, series: [{ type: 'gauge', startAngle: 180, endAngle: 0, min: 0, max: 100, pointer: { show: false }, progress: { show: true, overlap: false, roundCap: true, clip: false, itemStyle: { color, borderWidth: 0 } }, axisLine: { lineStyle: { width: 18, color: [[1, activeTheme.border]] } }, splitLine: { show: false }, axisTick: { show: false }, axisLabel: { show: false }, data: [{ value: val, name: _humanLabel(primaryItem.name) }], title: { fontSize: 13, color: activeTheme.textMuted, offsetCenter: [0, '30%'], fontFamily: 'Outfit, sans-serif' }, detail: { fontSize: 34, color: activeTheme.text, fontWeight: 'bold', offsetCenter: [0, '-5%'], formatter: '{value}%', fontFamily: 'Outfit, sans-serif' } }] }}
            style={{ height: '100%', width: '100%', minHeight: '120px' }}
            notMerge={true}
          />
        </div>
      );
    }

    if (widget.type === 'radar') {
      if (!chartData || chartData.length === 0) return <EmptyChartState theme={activeTheme} />;
      const maxVal = Math.max(...chartData.map(d => d.value)) * 1.2 || 10;
      return (
        <div className={`h-full w-full ${isClickable ? 'cursor-pointer hover:opacity-80' : ''}`} onClick={isClickable ? () => handleChartClick(widget) : undefined}>
          <ReactECharts opts={{ renderer: 'svg' }} option={{ ...common, radar: { indicator: chartData.map(d => ({ name: d.name, max: maxVal })), radius: '65%', axisName: { color: activeTheme.textMuted, fontSize: 11 }, splitLine: { lineStyle: { color: activeTheme.gridLine } }, splitArea: { show: false }, axisLine: { lineStyle: { color: activeTheme.border } } }, series: [{ type: 'radar', data: [{ value: chartData.map(d => d.value), name: widget.title, areaStyle: { color: `${PRIMARY_BLUE}40` }, lineStyle: { color: PRIMARY_BLUE, width: 2 }, itemStyle: { color: PRIMARY_BLUE, borderColor: `${PRIMARY_BLUE}40`, borderWidth: 5 }, emphasis: { itemStyle: { color: PRIMARY_BLUE, borderColor: `${PRIMARY_BLUE}40`, borderWidth: 8 }, lineStyle: { width: 3 } } }] }] }} style={{ height: '100%', width: '100%' }} notMerge={true} />
        </div>
      );
    }

    if (widget.type === 'globe') {
      if (!items || items.length === 0) return <EmptyChartState theme={activeTheme} />;
      return <GlobeWidget items={items} activeTheme={activeTheme} onDeviceClick={(item) => openInsight(item)} />;
    }

    if (widget.type === 'list' || widget.type === 'progress') {
      if (!chartData || chartData.length === 0) return <EmptyChartState theme={activeTheme} />;
      const maxVal = Math.max(...chartData.map(d => d.value)) || 1;
      return (
        <div className="h-full overflow-y-auto flex flex-col gap-1 custom-scrollbar">
          {chartData.map((item, idx) => (
            <ListProgressRow
              key={idx}
              item={item}
              index={idx}
              isClickable={isClickable}
              onClick={isClickable ? (e) => { e.stopPropagation(); handleChartClick(widget, item.name); } : undefined}
              showBar={widget.type === 'progress'}
              maxVal={maxVal}
              theme={activeTheme}
              colorFor={_colorFor}
              getOsPlatform={_getOsPlatform}
              humanLabel={_humanLabel}
              stat={widget.stat}
            />
          ))}
        </div>
      );
    }
  };

  const _emptyChart = () => <EmptyChartState theme={activeTheme} />;


  const renderInsightContent = () => {
    if (!activeInsight) return null;

    const isSegment = activeInsight.type_normalized === 'segment';
    if (isSegment) {
       const s = activeInsight;
       return (
          <div className="space-y-6">
            <div className="flex items-center gap-4 border-b pb-6" style={{ borderColor: activeTheme.border }}>
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ backgroundColor: s.color ? `${s.color}15` : `${PRIMARY_BLUE}15`, color: s.color || PRIMARY_BLUE }}>
                <Layout size={28} />
              </div>
              <div>
                <h3 className="text-xl font-bold" style={{ color: activeTheme.text }}>{s.name || 'Unnamed Segment'}</h3>
                <p className="text-sm" style={{ color: activeTheme.textMuted }}>ID: {s.id}</p>
                <div className="flex gap-2 mt-2">
                  <span className="px-2.5 py-1 text-[10px] font-light rounded-full border border-current/25" style={{ backgroundColor: `${PRIMARY_BLUE}15`, color: PRIMARY_BLUE }}>Segment</span>
                </div>
              </div>
            </div>
            <div>
              <h4 className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: activeTheme.textMuted }}>Details</h4>
              <div className="p-4 rounded-xl border space-y-3" style={{ backgroundColor: activeTheme.bg, borderColor: activeTheme.border }}>
                <div className="flex justify-between"><span className="text-xs font-medium uppercase" style={{ color: activeTheme.textMuted }}>Sub-Segments</span><span className="text-sm font-medium" style={{ color: activeTheme.text }}>{s.children?.length || 0}</span></div>
                <div className="flex justify-between"><span className="text-xs font-medium uppercase" style={{ color: activeTheme.textMuted }}>Color Code</span><span className="text-sm font-medium font-mono" style={{ color: activeTheme.text }}>{s.color || 'Default'}</span></div>
              </div>
            </div>
          </div>
       );
    }

    const isDownload = activeInsight.member !== undefined && activeInsight.networkInfo !== undefined;
    if (isDownload) {
      const dl = activeInsight;
      const name = `${dl.member?.firstName || ''} ${dl.member?.lastName || ''}`.trim() || dl.member?.email || 'Unknown Downloader';
      const os = dl.build?.os || 'unknown';
      const osIconColor = os === 'ios' || os === 'apple' ? getAppleColor(isDark) : os === 'android' ? OFFICIAL_OS_COLORS.android : OFFICIAL_OS_COLORS.windows;
      return (
        <div className="space-y-6">
          <div className="flex items-center gap-4 border-b pb-6" style={{ borderColor: activeTheme.border }}>
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ backgroundColor: `${osIconColor}15` }}><OsIcon platform={os} size={32} color={osIconColor} /></div>
            <div>
              <h3 className="text-xl font-bold" style={{ color: activeTheme.text }}>{name}</h3>
              <p className="text-sm" style={{ color: activeTheme.textMuted }}>{dl.applicationInfo?.name || 'App Download'}</p>
              <div className="flex gap-2 mt-2">
                <span className="px-2.5 py-1 text-[10px] font-light rounded-full border border-current/25" style={{ backgroundColor: `${SUCCESS}15`, color: SUCCESS }}>v{dl.build?.versionName}</span>
                <span className="px-2.5 py-1 text-[10px] font-light rounded-full border border-current/25 capitalize" style={{ backgroundColor: `${PRIMARY_BLUE}15`, color: PRIMARY_BLUE }}>{dl.from}</span>
              </div>
            </div>
          </div>
          <div>
            <h4 className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: activeTheme.textMuted }}>Network & Location</h4>
            <div className="p-4 rounded-xl border space-y-3" style={{ backgroundColor: activeTheme.bg, borderColor: activeTheme.border }}>
              <div className="flex justify-between"><span className="text-xs font-medium uppercase" style={{ color: activeTheme.textMuted }}>IP Address</span><span className="text-sm font-medium font-mono" style={{ color: activeTheme.text }}>{dl.networkInfo?.ip || '—'}</span></div>
              <div className="flex justify-between"><span className="text-xs font-medium uppercase" style={{ color: activeTheme.textMuted }}>Location</span><span className="text-sm font-medium" style={{ color: activeTheme.text }}>{[dl.networkInfo?.city, dl.networkInfo?.country].filter(Boolean).join(', ') || '—'}</span></div>
            </div>
          </div>
          <div>
            <h4 className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: activeTheme.textMuted }}>Device Details</h4>
            <div className="p-4 rounded-xl border space-y-3" style={{ backgroundColor: activeTheme.bg, borderColor: activeTheme.border }}>
              <div className="flex justify-between"><span className="text-xs font-medium uppercase" style={{ color: activeTheme.textMuted }}>Model</span><span className="text-sm font-medium" style={{ color: activeTheme.text }}>{dl.device?.model || '—'}</span></div>
              <div className="flex justify-between"><span className="text-xs font-medium uppercase" style={{ color: activeTheme.textMuted }}>OS Version</span><span className="text-sm font-medium" style={{ color: activeTheme.text }}>{dl.os?.name || os} {dl.os?.version || ''}</span></div>
              <div className="flex justify-between"><span className="text-xs font-medium uppercase" style={{ color: activeTheme.textMuted }}>Downloaded At</span><span className="text-sm font-medium" style={{ color: activeTheme.text }}>{dl.createdAt ? dl.createdAt.split('T')[0] + ' ' + dl.createdAt.split('T')[1].substring(0,5) : '—'}</span></div>
            </div>
          </div>
        </div>
      );
    }

    const isBuild = activeInsight.versionName !== undefined && (activeInsight.applicationInfo !== undefined || activeInsight.os !== undefined || activeInsight.originalExtension !== undefined);
    if (isBuild) {
      const b = activeInsight;
      const os = b.platform_normalized || 'other';
      const osIconColor = os === 'apple' ? getAppleColor(isDark) : os === 'android' ? OFFICIAL_OS_COLORS.android : OFFICIAL_OS_COLORS.windows;
      return (
        <div className="space-y-6">
          <div className="flex items-center gap-4 border-b pb-6" style={{ borderColor: activeTheme.border }}>
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ backgroundColor: `${osIconColor}15` }}><OsIcon platform={os} size={32} color={osIconColor} /></div>
            <div>
              <h3 className="text-xl font-bold" style={{ color: activeTheme.text }}>{b.applicationInfo?.name || 'App Build'}</h3>
              <p className="text-sm" style={{ color: activeTheme.textMuted }}>Version: {b.versionName} ({b.versionCode})</p>
              <div className="flex gap-2 mt-2">
                <span className="px-2.5 py-1 text-[10px] font-light rounded-full border border-current/25 capitalize" style={{ backgroundColor: `${PRIMARY_BLUE}15`, color: PRIMARY_BLUE }}>{os}</span>
                <span className="px-2.5 py-1 text-[10px] font-light rounded-full border border-current/25 capitalize" style={{ backgroundColor: b.status === 'processed' ? `${SUCCESS}15` : `${WARNING}15`, color: b.status === 'processed' ? SUCCESS : WARNING }}>{b.status}</span>
              </div>
            </div>
          </div>
          <div>
            <h4 className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: activeTheme.textMuted }}>Build Details</h4>
            <div className="p-4 rounded-xl border space-y-3" style={{ backgroundColor: activeTheme.bg, borderColor: activeTheme.border }}>
              <div className="flex justify-between"><span className="text-xs font-medium uppercase" style={{ color: activeTheme.textMuted }}>Size</span><span className="text-sm font-medium" style={{ color: activeTheme.text }}>{b.size ? (b.size / 1024 / 1024).toFixed(2) + ' MB' : 'N/A'}</span></div>
              <div className="flex justify-between"><span className="text-xs font-medium uppercase" style={{ color: activeTheme.textMuted }}>Uploaded By</span><span className="text-sm font-medium" style={{ color: activeTheme.text }}>{b.uploadedBy?.email || '—'}</span></div>
              <div className="flex justify-between"><span className="text-xs font-medium uppercase" style={{ color: activeTheme.textMuted }}>Created At</span><span className="text-sm font-medium" style={{ color: activeTheme.text }}>{b.createdAt ? b.createdAt.split('T')[0] : '—'}</span></div>
            </div>
          </div>
        </div>
      );
    }

    // Detect by presence of device-specific fields (cross platform)
    const isDevice = !!(
      activeInsight.platform_normalized ||
      activeInsight.summary?.serialNumber ||
      activeInsight.summary?.udid ||
      activeInsight.control?.UDID ||
      activeInsight.emmDevice ||
      activeInsight.admEnterprise ||
      activeInsight.winId ||
      (activeInsight.type && ['android','apple','ios','windows','macos'].includes(String(activeInsight.type).toLowerCase()))
    );
    if (isDevice) {
      return <DeviceInsightCard device={activeInsight} activeTheme={activeTheme} apiToken={apiToken} orgSlug={orgSlug} />;
    } 
    
    // Detect Enterprise Apps (they have an OS array and Build Platforms)
    const isApp = activeInsight.oss !== undefined && activeInsight.buildPlatforms !== undefined;
    if (isApp) {
      return <AppBuildInsightCard app={activeInsight} activeTheme={activeTheme} apiToken={apiToken} orgSlug={orgSlug} />;
    }
    
    else {
      const u = activeInsight;
			
      // Detect context from which widget/source opened this insight
      const widgetStat = selectedWidgetItems?.stat || '';
      const isUEMCollab    = widgetStat === 'mdm_collaborators' || widgetStat === 'mdm_users';
      const isDistCollab   = widgetStat === 'app_dist_collaborators' || widgetStat === 'stats_collaborators';
      const isStoreUser    = widgetStat === 'app_dist_store_users';

      // Resolve name from nested objects — collaborators: user{}, store users: employee{}
      const target  = u.user || u.employee || u.mdmUser || u;
      const empSub  = u.employee || {};
      const userSub = u.user     || {};

      const firstName = target.firstName || empSub.firstName || userSub.firstName || u.firstName || '';
      const lastName  = target.lastName  || empSub.lastName  || userSub.lastName  || u.lastName  || '';
      let name = `${firstName} ${lastName}`.trim();
      if (!name) name = u.display_name || u.displayName || target.name || u.name || target.email || u.email || 'Unknown';

      const email     = target.email || empSub.email || userSub.email || u.email || 'No email';
      const isSSO     = u.sso_normalized || target.ssoUser || false;
      const language  = target.language  || u.language || 'EN';
      const createdAt = (target.createdAt || u.createdAt || '').split('T')[0];
      const picture   = target.picture || u.picture || '';
      const tags      = u.tags || target.tags || [];

      // Role differs by context:
      // UEM collaborator  → u.role_normalized (org-level role: admin, editor, viewer...)
      // App Dist collab   → same role, but label it "Distribution Role"
      // Store user        → no distribution role (they're end-users/employees)
      // UEM segment role  → u.segmentRole (if present — additional segment-level permission)
      const distRole    = u.role_normalized || target.role || '';
      const segmentRole = u.segmentRole || u.segmentPermissions || '';

      // Activity trace
      const actTrace     = target.activityTrace || u.activityTrace || {};
      const lastDashLogin  = actTrace.lastLogin?.dashboard || '';
      const lastStoreLogin = actTrace.lastLogin?.store     || '';

      // UEM user device counts (from mdmUser shape)
      const androidDevices = u.android?.devices || {};
      const appleDevices   = u.apple?.devices;
      const winDevices     = u.windows?.devices;
      const totalDevices   = (typeof appleDevices === 'number' ? appleDevices : 0)
        + (typeof winDevices === 'number' ? winDevices : 0)
        + (typeof androidDevices === 'number' ? androidDevices : Object.values(androidDevices || {}).reduce((s,v) => s + (Number(v)||0), 0));

      const orgWidget = Object.values(widgetData).find(d => d && d.orgProfile && d.orgProfile.name);
      const orgLogo   = orgWidget?.orgProfile?.branding?.logo || orgWidget?.orgProfile?.branding?.picture;
      const orgName   = orgWidget?.orgProfile?.name || 'WORKSPACE';

      // Context label for the header badge
      const contextLabel = isStoreUser ? 'STORE USER' : isDistCollab ? 'APP DISTRIBUTION' : isUEMCollab ? 'UEM COLLABORATOR' : 'USER';
      const contextColor = isStoreUser ? '#10B981' : isDistCollab ? '#A855F7' : PRIMARY_BLUE;

      return (
        <div className="w-full relative space-y-5">
          {/* Org header */}
          <div className="flex flex-col items-center pb-4 border-b" style={{ borderColor: activeTheme.border }}>
            {orgLogo ? <img src={orgLogo} className="h-8 object-contain mb-1.5" alt="Org"/> : <Building2 size={24} className="mb-1.5 opacity-40" style={{ color: activeTheme.textMuted }}/>}
            <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: activeTheme.textMuted }}>{orgName}</span>
          </div>

          {/* Avatar + name */}
          <div className="flex flex-col items-center gap-2">
            {picture ? (
              <img src={picture} className="w-20 h-20 rounded-full object-cover shadow-sm" alt={name}/>
            ) : (
              <div className="w-20 h-20 rounded-full flex items-center justify-center text-2xl font-black" style={{ backgroundColor: `${contextColor}18`, color: contextColor }}>
                {name.charAt(0).toUpperCase() || '?'}
              </div>
            )}
            <div className="text-center">
              <h3 className="text-xl font-bold" style={{ color: activeTheme.text }}>{name}</h3>
              <p className="text-sm" style={{ color: activeTheme.textMuted }}>{email}</p>
            </div>
            <div className="flex flex-wrap justify-center gap-1.5 mt-1">
              <span className="px-2.5 py-1 text-[10px] font-light rounded-full border border-current/25" style={{ backgroundColor: `${contextColor}18`, color: contextColor }}>{contextLabel}</span>
              <span className="px-2.5 py-1 text-[10px] font-light rounded-full border border-current/25" style={{ backgroundColor: `${PRIMARY_BLUE}12`, color: PRIMARY_BLUE }}>{isSSO ? 'Federated' : 'Standard login'}</span>
              {language && <span className="px-2.5 py-1 text-[10px] font-light rounded-full border" style={{ color: activeTheme.textMuted, borderColor: activeTheme.border }}>{language.toUpperCase()}</span>}
            </div>
          </div>

          {/* Role section — context-aware */}
          {(distRole || segmentRole) && (
            <div className="rounded-xl border" style={{ backgroundColor: activeTheme.bg, borderColor: activeTheme.border }}>
              {distRole && (
                <div className="flex justify-between items-center px-4 py-3 border-b" style={{ borderColor: activeTheme.border }}>
                  <span className="text-xs font-medium" style={{ color: activeTheme.textMuted }}>
                    {isUEMCollab ? 'UEM Role' : isDistCollab ? 'Distribution Role' : 'Role'}
                  </span>
                  <span className="text-xs font-bold uppercase px-2 py-0.5 rounded" style={{ backgroundColor: `${WARNING}15`, color: WARNING }}>{distRole}</span>
                </div>
              )}
              {segmentRole && (
                <div className="flex justify-between items-center px-4 py-3">
                  <span className="text-xs font-medium" style={{ color: activeTheme.textMuted }}>Segment Role</span>
                  <span className="text-xs font-bold uppercase px-2 py-0.5 rounded" style={{ backgroundColor: `${PRIMARY_BLUE}15`, color: PRIMARY_BLUE }}>{segmentRole}</span>
                </div>
              )}
            </div>
          )}

          {/* UEM device counts (only for mdm_users) */}
          {isUEMCollab && !isStoreUser && totalDevices > 0 && (
            <div className="rounded-xl border overflow-hidden" style={{ borderColor: activeTheme.border }}>
              <div className="px-4 py-2.5 text-[9px] font-bold uppercase tracking-widest border-b" style={{ color: activeTheme.textMuted, borderColor: activeTheme.border }}>Managed Devices</div>
              <div className="flex" style={{ backgroundColor: activeTheme.bg }}>
                {typeof appleDevices === 'number' && appleDevices > 0 && (
                  <div className="flex-1 flex flex-col items-center py-3 border-r" style={{ borderColor: activeTheme.border }}>
                    <OsIcon platform="apple" size={16} color={getAppleColor(isDark)}/>
                    <span className="text-sm font-black mt-1" style={{ color: activeTheme.text }}>{appleDevices}</span>
                    <span className="text-[9px]" style={{ color: activeTheme.textMuted }}>Apple</span>
                  </div>
                )}
                {typeof winDevices === 'number' && winDevices > 0 && (
                  <div className="flex-1 flex flex-col items-center py-3 border-r" style={{ borderColor: activeTheme.border }}>
                    <OsIcon platform="windows" size={16} color={OFFICIAL_OS_COLORS.windows}/>
                    <span className="text-sm font-black mt-1" style={{ color: activeTheme.text }}>{winDevices}</span>
                    <span className="text-[9px]" style={{ color: activeTheme.textMuted }}>Windows</span>
                  </div>
                )}
                {(androidDevices.DEVICE_OWNER || androidDevices.PROFILE_OWNER || 0) > 0 && (
                  <div className="flex-1 flex flex-col items-center py-3">
                    <OsIcon platform="android" size={16} color={OFFICIAL_OS_COLORS.android}/>
                    <span className="text-sm font-black mt-1" style={{ color: activeTheme.text }}>{(androidDevices.DEVICE_OWNER || 0) + (androidDevices.PROFILE_OWNER || 0)}</span>
                    <span className="text-[9px]" style={{ color: activeTheme.textMuted }}>Android</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Tags */}
          {tags.length > 0 && (
            <div>
              <div className="text-[9px] font-bold uppercase tracking-widest mb-2" style={{ color: activeTheme.textMuted }}>Tags</div>
              <div className="flex flex-wrap gap-1.5">
                {tags.map((g, i) => (
                  <span key={i} className="px-2 py-0.5 text-[10px] font-medium rounded-full border" style={{ color: activeTheme.textMuted, borderColor: activeTheme.border }}>
                    #{typeof g === 'string' ? g : g.value || String(g)}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Activity Trace */}
          <div className="rounded-xl border overflow-hidden" style={{ borderColor: activeTheme.border }}>
            <div className="px-4 py-2.5 text-[9px] font-bold uppercase tracking-widest border-b" style={{ color: activeTheme.textMuted, borderColor: activeTheme.border }}>Activity Trace</div>
            <div style={{ backgroundColor: activeTheme.bg }}>
              <div className="flex justify-between items-center px-4 py-2.5 border-b" style={{ borderColor: activeTheme.border }}>
                <span className="text-xs" style={{ color: activeTheme.textMuted }}>Created At</span>
                <span className="text-xs font-medium" style={{ color: activeTheme.text }}>{createdAt || '—'}</span>
              </div>
              {!isStoreUser && (
                <div className="flex justify-between items-center px-4 py-2.5 border-b" style={{ borderColor: activeTheme.border }}>
                  <span className="text-xs" style={{ color: activeTheme.textMuted }}>Dashboard Login</span>
                  <span className="text-xs font-medium" style={{ color: lastDashLogin ? activeTheme.text : activeTheme.textMuted }}>{lastDashLogin ? lastDashLogin.split('T')[0] : 'Never'}</span>
                </div>
              )}
              <div className="flex justify-between items-center px-4 py-2.5">
                <span className="text-xs" style={{ color: activeTheme.textMuted }}>Store Login</span>
                <span className="text-xs font-medium" style={{ color: lastStoreLogin ? activeTheme.text : activeTheme.textMuted }}>{lastStoreLogin ? lastStoreLogin.split('T')[0] : 'Never'}</span>
              </div>
            </div>
          </div>
        </div>
      );
    }
  };

  const renderSegmentNode = (seg, level = 0) => {
       const segId = seg.id !== undefined ? seg.id : (seg._id || Math.random());
       const isSelected = selectedSegment.id === segId;
       const actualChildren = seg.children || [];
       const hasChildren = actualChildren.length > 0;
       const isExpanded = expandedSegments[segId] !== false;
       const iconVal = seg.icon !== undefined ? seg.icon : seg.iconId;
       const colorVal = seg.color !== undefined ? seg.color : seg.colorId;
       const IconComp = getSegmentIcon(iconVal);
       const iconColor = getSegmentColor(colorVal, activeTheme);
     
       return (
         <React.Fragment key={segId}>
           <div onClick={() => setSelectedSegment(seg)} className={`flex items-center py-2 cursor-pointer transition-colors mx-4 rounded-lg ${isSelected ? 'font-medium' : (isDark ? 'hover:bg-white/5' : 'hover:bg-black/5')}`} style={{ paddingLeft: `${4 + (level * 24)}px`, paddingRight: '12px', backgroundColor: isSelected ? `${PRIMARY_BLUE}15` : 'transparent' }}>
             <div className="w-5 h-5 flex items-center justify-center shrink-0 mr-1" onClick={(e) => { if(hasChildren) { e.stopPropagation(); setExpandedSegments(prev => ({ ...prev, [segId]: !isExpanded })); } }}>
               {hasChildren ? (
                 isExpanded ? <ChevronDown size={14} className="opacity-50 hover:opacity-100" style={{ color: activeTheme.text }} /> : <ChevronRight size={14} className="opacity-50 hover:opacity-100" style={{ color: activeTheme.text }} />
               ) : <div className="w-3.5" />}
             </div>
             <div className="flex items-center gap-2 overflow-hidden w-full">
               <IconComp size={16} color={isSelected ? PRIMARY_BLUE : iconColor} style={{ color: isSelected ? PRIMARY_BLUE : iconColor }} className={isSelected ? "" : "opacity-80"} />
               <span className="text-sm truncate" style={{ color: isSelected ? PRIMARY_BLUE : activeTheme.text }}>{seg.name}</span>
             </div>
           </div>
           {showChildren && hasChildren && isExpanded && (
             <div className="flex flex-col">
                {(() => {
                   const filterTree = (nodes, term) => {
                      if (!term) return nodes;
                      return nodes.map(n => {
                          const matches = n.name?.toLowerCase().includes(term);
                          const filteredChildren = filterTree(n.children || [], term);
                          if (matches || filteredChildren.length > 0) return { ...n, children: filteredChildren };
                          return null;
                      }).filter(Boolean);
                   };
                   const displayNodes = filterTree(actualChildren, segmentSearch.toLowerCase());
                   return displayNodes.map(child => renderSegmentNode(child, level + 1));
                })()}
             </div>
           )}
         </React.Fragment>
       );
    };

  if (!stateLoaded) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center" style={{ backgroundColor: '#020817' }}>
        <img src="https://dashboard.applivery.io/images/logo-combined-white.svg" className="h-7 object-contain mb-6 opacity-70" alt="Applivery"/>
        <div className="w-7 h-7 border-2 border-blue-500/20 border-t-blue-500 rounded-full animate-spin mb-3"/>
        <span className="text-sm text-white/30 uppercase tracking-widest font-medium">Loading workspace…</span>
      </div>
    );
  }

  return (
    <>
    <div className="w-full overflow-x-hidden h-screen flex flex-col font-sans transition-colors duration-300" style={{ backgroundColor: activeTheme.bg, color: activeTheme.text }}>
      {/* ── TOP BAR — h-16 (64px) matching Applivery UEM console ──
          Sits directly in the h-screen flex column below, as a shrink-0
          row, so it never scrolls out of view — every view's own <main>
          (flex-1 overflow-y-auto) is what scrolls, not the page itself.
          Previously the outer wrapper was min-h-screen (grows past 100vh
          to fit tall content instead of capping at it), which let the
          whole page — nav bar included — scroll together. */}
      <nav className="h-[64px] min-h-[64px] flex items-center justify-between pl-4 pr-4 z-50 shrink-0 relative" style={{ backgroundColor: PRIMARY_BLUE }}>

        {/* Left: brand + nav tabs + gear right after Reporting */}
        <div className="flex items-center h-full">
          <div className="flex items-center gap-3 mr-4 shrink-0">
            <img src="https://dashboard.applivery.io/images/logo-combined-white.svg" className="h-[22px] object-contain block" alt="Applivery" />
            <div className="h-4 w-px bg-white/25" />
            <span className="text-[19px] text-white/90 select-none" style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 300, letterSpacing: '-0.1px' }}>SOAR</span>
          </div>

          {/* Nav items — h-10 per Applivery UEM spec */}
          <div className="flex items-center h-full gap-4">
            {[
              { view: 'overview',   Icon: LayoutGrid, label: 'Overview'   },
              { view: 'devices',    Icon: Smartphone,  label: 'Devices',    area: 'devices' },
              { view: 'compliance', Icon: ShieldAlert, label: 'Compliance', area: 'compliance' },
              { view: 'cases',       Icon: Folder,      label: 'Cases',      area: 'cases' },
              { view: 'workflows',      Icon: Workflow,    label: 'Workflows', area: 'workflows' },
              { view: 'reporting',  Icon: FileText,    label: 'Reporting',  area: 'reporting' },
            ].filter(tab => !tab.area || hasFeatureAccess(access, tab.area, 'read')).map(({ view, Icon, label }) => (
              <button
                key={view}
                onClick={() => setCurrentView(view)}
                className={`relative flex h-10 items-center gap-2 rounded-md px-4 text-[15px] font-light leading-none transition select-none ${currentView === view ? 'bg-white/15' : 'bg-transparent hover:bg-white/10'}`}
                style={{ color: 'white' }}
              >
                <Icon size={19} strokeWidth={1.5} />
                {label}
              </button>
            ))}

            {/* ⚙ Gear — sits right after Reporting, matching Applivery UEM */}
            <button
              onClick={() => setIsSettingsModalOpen(true)}
              className="relative flex h-10 w-10 items-center justify-center rounded-md transition select-none hover:bg-white/10"
              style={{ color: 'white' }}
              title="Settings"
            >
              <Settings size={19} strokeWidth={1.5} />
            </button>
          </div>
        </div>

        {/* Right: workspace only — theme/status moved to footer */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="relative ml-1">
            <button onClick={() => { setIsWorkspaceMenuOpen(!isWorkspaceMenuOpen); setIsThemeMenuOpen(false); }} type="button" className="contents">
              <div className={`relative flex h-12 cursor-pointer items-center justify-between rounded-md px-3 text-left transition-colors ${isWorkspaceMenuOpen ? 'bg-white/20' : 'bg-white/10 hover:bg-white/15'}`}>
                <div className="mr-3">
                  <div className="text-[10px] tracking-wider text-white/80 uppercase">WORKSPACE</div>
                  <div className="truncate font-light max-w-[160px] text-white">
                    {Object.values(widgetData).find(d => d?.orgProfile?.name)?.orgProfile.name || 'Intelligence Force'}
                  </div>
                </div>
                <div className="relative flex-none overflow-hidden bg-white after:absolute after:inset-0 after:ring-inset after:ring-slate-200 after:ring-opacity-40 w-8 h-8 after:ring-[2px] rounded-full after:rounded-full">
                  <div className="flex h-full w-full items-center justify-center uppercase bg-emerald-800 text-emerald-200/80 text-xs hue-rotate-30">
                    {currentUser ? userInitials : '??'}
                  </div>
                </div>
              </div>
            </button>

            {isWorkspaceMenuOpen && (
              <div className="absolute right-0 top-full mt-2 w-64 rounded-xl shadow-xl overflow-hidden z-[200] border" style={{ backgroundColor: activeTheme.card, borderColor: activeTheme.border }}>
                <button
                  onClick={() => { setCurrentView('auditLogs'); setIsWorkspaceMenuOpen(false); }}
                  className="w-full text-left px-4 py-2.5 flex items-center gap-2.5 transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                >
                  <ScrollText size={15} strokeWidth={1.75} style={{ color: activeTheme.textMuted }} />
                  <span className="text-[14px] font-normal" style={{ color: activeTheme.text }}>Audit Logs</span>
                </button>

                {organizations.length > 1 && (
                  <>
                    <div className="h-px" style={{ backgroundColor: activeTheme.border }} />
                    <div className="px-4 pt-2.5 pb-1">
                      <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: activeTheme.textMuted }}>Workspaces</span>
                    </div>
                    <div className="max-h-52 overflow-y-auto pb-1">
                      {organizations.map(org => {
                        const isActive = org.slug === orgSlug;
                        return (
                          <button
                            key={org.id}
                            onClick={() => { setIsWorkspaceMenuOpen(false); handleSwitchOrganization(org.slug); }}
                            className="w-full text-left px-4 py-2 flex items-center gap-2.5 transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                          >
                            <div className="shrink-0 w-6 h-6 rounded-md overflow-hidden flex items-center justify-center text-white text-[10px] font-bold" style={{ backgroundColor: PRIMARY_BLUE }}>
                              {org.picture ? <img src={org.picture} alt="" className="w-full h-full object-cover" /> : (org.name || '?').slice(0, 2).toUpperCase()}
                            </div>
                            <span className="text-[13px] truncate flex-1" style={{ color: isActive ? PRIMARY_BLUE : activeTheme.text, fontWeight: isActive ? 600 : 400 }}>
                              {org.name}
                            </span>
                            {isActive && <Check size={13} style={{ color: PRIMARY_BLUE }} className="shrink-0" />}
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}

                <div className="h-px" style={{ backgroundColor: activeTheme.border }} />
                <button onClick={handleLogout} className="w-full text-left px-4 py-3 flex items-center gap-3 transition-colors hover:bg-black/5 dark:hover:bg-white/5 group">
                  <div className="w-9 h-9 rounded-full flex items-center justify-center uppercase bg-emerald-800 text-emerald-200/80 text-xs hue-rotate-30 shrink-0">
                    {currentUser ? userInitials : '??'}
                  </div>
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="text-[14px] font-medium truncate" style={{ color: activeTheme.text }}>{currentUser?.fullName || currentUser?.email || 'Signed in'}</span>
                    <span className="text-[12px] truncate" style={{ color: activeTheme.textMuted }}>{currentUser?.email || ''}</span>
                  </div>
                  <LogOut size={15} style={{ color: activeTheme.textMuted }} className="group-hover:text-[#0055FF] transition-colors shrink-0" />
                </button>
              </div>
            )}
          </div>
        </div>
      </nav>

      <div className="fixed left-0 top-0 bottom-0 w-4 z-[140]" onMouseEnter={() => { if (!isBuilderOpen && (currentView === 'overview' || currentView === 'devices' || currentView === 'compliance' || currentView === 'cases')) setIsSegmentPanelOpen(true); }} />

      <div onMouseLeave={() => setIsSegmentPanelOpen(false)} className={"fixed left-0 top-0 bottom-0 w-80 shadow-2xl z-[150] transform transition-transform duration-300 flex flex-col border-r " + (isSegmentPanelOpen ? "translate-x-0" : "-translate-x-full")} style={{ backgroundColor: activeTheme.card, borderColor: activeTheme.border }}>
        <div className="p-6 border-b shrink-0" style={{ backgroundColor: activeTheme.card, borderColor: activeTheme.border }}>
           <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${PRIMARY_BLUE}15`, color: PRIMARY_BLUE }}><Layers size={15}/></div>
                <h2 className="text-base font-bold" style={{ color: activeTheme.text }}>Segments</h2>
              </div>
              {selectedSegment && selectedSegment.id !== 0 && (
                <button onClick={() => setSelectedSegment({ id: 0, name: 'Global' })} className="text-[10px] font-semibold px-2 py-0.5 rounded-full transition-colors hover:opacity-80" style={{ backgroundColor: `${PRIMARY_BLUE}12`, color: PRIMARY_BLUE }}>
                  Reset
                </button>
              )}
           </div>
           <div className="relative mb-4">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 opacity-50" style={{ color: activeTheme.text }}/>
              <input type="text" placeholder="Search segments..." value={segmentSearch} onChange={e => setSegmentSearch(e.target.value)} className="w-full pl-9 pr-4 py-2 rounded-lg text-sm border outline-none focus:border-blue-500 transition-colors bg-transparent focus:ring-2 focus:ring-brand-500" style={{ borderColor: activeTheme.border, color: activeTheme.text }} />
           </div>
           <div className="flex items-center justify-between mt-2">
              <span className="text-sm font-medium" style={{ color: activeTheme.text }}>Show children elements</span>
              <button onClick={() => setShowChildren(!showChildren)} className={`w-10 h-5 rounded-full relative transition-colors ${showChildren ? 'bg-blue-600' : (isDark ? 'bg-gray-600' : 'bg-gray-300')}`}>
                 <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${showChildren ? 'translate-x-5.5 left-0.5' : 'translate-x-0.5'}`} style={{ transform: showChildren ? 'translateX(22px)' : 'translateX(2px)' }} />
              </button>
           </div>
        </div>
        <div className="flex-1 overflow-y-auto py-4 custom-scrollbar" style={{ backgroundColor: activeTheme.card }}>
           <div onClick={() => setSelectedSegment(globalSegment)} className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors mx-4 rounded-lg mb-2 ${selectedSegment.id === 0 ? 'font-medium' : (isDark ? 'hover:bg-white/5' : 'hover:bg-black/5')}`} style={{ color: selectedSegment.id === 0 ? PRIMARY_BLUE : activeTheme.text, backgroundColor: selectedSegment.id === 0 ? `${PRIMARY_BLUE}15` : 'transparent' }}>
             <Globe size={16} />
             <span className="text-sm">Global</span>
           </div>
           <div className="flex flex-col mt-2">
             {(() => {
                 const filterTree = (nodes, term) => {
                    if (!term) return nodes;
                    return nodes.map(n => {
                        const matches = n.name?.toLowerCase().includes(term);
                        const children = filterTree(n._realChildren || [], term);
                        if (matches || children.length > 0) return { ...n, _realChildren: children };
                        return null;
                    }).filter(Boolean);
                 };
                 const displayNodes = filterTree(segmentsList, segmentSearch.toLowerCase());
                 return displayNodes.map(seg => renderSegmentNode(seg, 0));
             })()}
           </div>
        </div>
        <button onClick={() => setIsSegmentPanelOpen(false)} className="absolute -right-4 bottom-10 w-8 h-8 border rounded-full shadow-md flex items-center justify-center z-50 hover:opacity-80 transition-opacity" style={{ backgroundColor: activeTheme.card, borderColor: activeTheme.border, color: PRIMARY_BLUE }}><ChevronLeft size={16} /></button>
      </div>

      {currentView === 'overview' && (
        <main className="p-8 pb-16 flex-1 relative overflow-y-auto">
          <div ref={gridRef} style={{ width: '100%' }}>
          <header className="flex justify-between items-start mb-8">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h1 className="text-2xl font-semibold leading-tight" style={{ color: activeTheme.text }}>Dashboard Overview</h1>
                <HelpIcon slug="overview" theme={activeTheme} title="Overview admin guide" />
                {selectedSegment && selectedSegment.id !== 0 && (
                  <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium" style={{ backgroundColor: `${PRIMARY_BLUE}12`, color: PRIMARY_BLUE }}>
                    <Layers size={10}/> {selectedSegment.name}
                  </span>
                )}
              </div>
              <p className="text-sm mt-1" style={{ color: activeTheme.textMuted }}>
                {selectedSegment && selectedSegment.id !== 0
                  ? `Filtered to segment: ${selectedSegment.name}`
                  : "Welcome back! Here's what's happening today."}
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              {/* Add Widget button — styled like image 4 */}
              <button
                onClick={() => openBuilder()}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors hover:opacity-80"
                style={{ color: PRIMARY_BLUE }}
              >
                <Plus size={15} /> Add Widget
              </button>
              {/* Date range button */}
              <div className="relative">
                <button
                  onClick={() => setIsDatePickerOpen(p => !p)}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white bg-brand-600 transition-all duration-200 hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2"
                >
                  <Calendar size={15} />
                  <span>
                    {overviewDateRange.from.toLocaleDateString('en-GB', { day:'2-digit', month:'2-digit', year:'2-digit' })}
                    {' – '}
                    {overviewDateRange.to.toLocaleDateString('en-GB', { day:'2-digit', month:'2-digit', year:'2-digit' })}
                  </span>
                </button>
                {isDatePickerOpen && (
                  <DateRangePickerDropdown
                    value={overviewDateRange}
                    onApply={(range) => {
                      setOverviewDateRange(range);
                      setIsDatePickerOpen(false);
                      // Force full reload cycle: clear data → show loading → re-fetch with new range
                      setWidgetData({});
                      setIsChartReady(false);
                      setTimeout(() => {
                        setIsChartReady(true);
                        fetchWidgetData(range);
                      }, 150);
                    }}
                    onCancel={() => setIsDatePickerOpen(false)}
                    theme={activeTheme}
                    primaryBlue={PRIMARY_BLUE}
                  />
                )}
              </div>
              {hasUnsavedChanges && (
                <button onClick={saveDashboard} disabled={isSaving || saveSuccess} className={`flex items-center gap-2 px-5 py-2 rounded-lg font-medium text-sm transition-colors ${saveSuccess ? 'bg-emerald-600 text-white' : 'text-white'}`} style={{ backgroundColor: saveSuccess ? undefined : PRIMARY_BLUE }}>
                  <Save size={15} /> {isSaving ? 'Saving...' : saveSuccess ? 'Saved' : 'Save Changes'}
                </button>
              )}
            </div>
          </header>

          {!isChartReady ? (
            <div className="flex-1 flex flex-col items-center justify-center min-h-[400px]">
              <div className="w-8 h-8 border-2 border-[#0055FF]/30 border-t-[#0055FF] rounded-full animate-spin mb-4" />
              <span className="text-xs uppercase tracking-widest font-bold" style={{ color: activeTheme.textMuted }}>Allocating Graphics...</span>
            </div>
          ) : (
					<Responsive 
            className="layout"
						width={containerWidth}
            layouts={{ lg: dashboard.layout }}
            breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }} 
            cols={{ lg: 12, md: 12, sm: 8, xs: 4, xxs: 4 }} 
            rowHeight={120}  
            onLayoutChange={(currentLayout, allLayouts) => {
              if (allLayouts.lg) {
                setDashboard(prev => ({ ...prev, layout: allLayouts.lg }));
              } else {
                setDashboard(prev => ({ ...prev, layout: currentLayout }));
              }
            }} 
            draggableHandle=".drag-handle"
          >
            {dashboard.widgets.map(w => {
               const dataBlock = widgetData[w.id] || {};
               const isTrend = ['stats_downloads_trend', 'stats_builds_trend', 'stats_devices_trend', 'compliance_violations_trend'].includes(w.stat);
               const isLocked = dashboard.layout.find(l => l.i === w.id)?.static;
               const osTotals = isTrend && dataBlock.trendData?.os_totals ? dataBlock.trendData.os_totals : null;
               // Determine icon/color from widget stat
               const iconMap = {
                 'stats_devices_os': { icon: Smartphone, color: PRIMARY_BLUE, bg: `${PRIMARY_BLUE}15` },
                 'stats_devices_status': { icon: Activity, color: SUCCESS, bg: `${SUCCESS}15` },
                 'stats_builds_os': { icon: Smartphone, color: PRIMARY_BLUE, bg: `${PRIMARY_BLUE}15` },
                 'stats_collaborators': { icon: Users, color: PRIMARY_BLUE, bg: `${PRIMARY_BLUE}15` },
                 'stats_downloads_trend': { icon: TrendingUp, color: '#8B5CF6', bg: '#8B5CF615' },
                 'stats_builds_trend': { icon: TrendingUp, color: '#06B6D4', bg: '#06B6D415' },
                 'stats_devices_trend': { icon: TrendingUp, color: PRIMARY_BLUE, bg: `${PRIMARY_BLUE}15` },
                 'stats_compliance': { icon: ShieldAlert, color: SUCCESS, bg: `${SUCCESS}15` },
                 'stats_battery': { icon: BatteryCharging, color: WARNING, bg: `${WARNING}15` },
                 'stats_models': { icon: Smartphone, color: activeTheme.textMuted, bg: `${activeTheme.textMuted}15` },
                 'stats_os_updates_all': { icon: RefreshCw, color: WARNING, bg: `${WARNING}15` },
                 'stats_os_versions': { icon: LayoutGrid, color: '#06B6D4', bg: '#06B6D415' },
                 'stats_sync_errors': { icon: AlertTriangle, color: DANGER, bg: `${DANGER}15` },
                 'mdm_devices': { icon: Smartphone, color: PRIMARY_BLUE, bg: `${PRIMARY_BLUE}15` },
                 'mdm_users': { icon: Users, color: '#8B5CF6', bg: '#8B5CF615' },
                 'mdm_collaborators': { icon: Briefcase, color: '#06B6D4', bg: '#06B6D415' },
                 'app_dist_store_users': { icon: Users, color: SUCCESS, bg: `${SUCCESS}15` },
                 'app_dist_apps': { icon: Box, color: PRIMARY_BLUE, bg: `${PRIMARY_BLUE}15` },
                 'app_dist_collaborators': { icon: Briefcase, color: '#F59E0B', bg: '#F59E0B15' },
                 'org_profile': { icon: Building2, color: PRIMARY_BLUE, bg: `${PRIMARY_BLUE}15` },
                 'mdm_segments': { icon: Layers, color: '#8B5CF6', bg: '#8B5CF615' },
                 'compliance_policies_summary': { icon: ShieldCheck, color: PRIMARY_BLUE, bg: `${PRIMARY_BLUE}15` },
                 'compliance_devices_violating': { icon: ShieldAlert, color: DANGER, bg: `${DANGER}15` },
                 'compliance_violations_by_policy': { icon: BarChart3, color: WARNING, bg: `${WARNING}15` },
                 'compliance_violations_trend': { icon: TrendingUp, color: DANGER, bg: `${DANGER}15` },
                 'compliance_review_queue': { icon: ListChecks, color: '#8B5CF6', bg: '#8B5CF615' },
                 'autorun_safety_summary': { icon: ShieldCheck, color: WARNING, bg: `${WARNING}15` },
                 'compliance_framework_coverage': { icon: ShieldCheck, color: PRIMARY_BLUE, bg: `${PRIMARY_BLUE}15` },
                 'iso27001_compliance_status': { icon: ScrollText, color: '#14B8A6', bg: '#14B8A615' },
                 'ens_compliance_status': { icon: Flag, color: '#DC2626', bg: '#DC262615' },
                 'nis2_compliance_status': { icon: Globe, color: '#3B82F6', bg: '#3B82F615' },
                 'cases_summary': { icon: Folder, color: PRIMARY_BLUE, bg: `${PRIMARY_BLUE}15` },
                 'cases_by_severity': { icon: AlertTriangle, color: DANGER, bg: `${DANGER}15` },
                 'cases_by_source': { icon: BarChart3, color: '#8B5CF6', bg: '#8B5CF615' },
                 'cases_trend': { icon: TrendingUp, color: PRIMARY_BLUE, bg: `${PRIMARY_BLUE}15` },
                 'cases_sla_summary': { icon: Clock, color: WARNING, bg: `${WARNING}15` },
                 'cases_mttr_trend': { icon: TrendingUp, color: '#8B5CF6', bg: '#8B5CF615' },
                 'applivery_events_by_type': { icon: Satellite, color: PRIMARY_BLUE, bg: `${PRIMARY_BLUE}15` },
                 'applivery_events_trend': { icon: TrendingUp, color: PRIMARY_BLUE, bg: `${PRIMARY_BLUE}15` },
                 'applivery_automation_outcomes': { icon: ListChecks, color: '#8B5CF6', bg: '#8B5CF615' },
                 'system_health_summary': { icon: Activity, color: SUCCESS, bg: `${SUCCESS}15` },
                 'os_updates_catalog_summary': { icon: Cpu, color: '#0078D4', bg: '#0078D415' },
                 'os_updates_device_status_summary': { icon: ShieldAlert, color: '#0078D4', bg: '#0078D415' },
                 'vuln_catalog_summary': { icon: Bug, color: '#8B5CF6', bg: '#8B5CF615' },
                 'vuln_device_status_summary': { icon: ShieldAlert, color: '#8B5CF6', bg: '#8B5CF615' },
                 'vuln_service_device_status_summary': { icon: ShieldAlert, color: '#DC2626', bg: '#DC262615' },
                 'os_lifecycle_summary': { icon: Hourglass, color: '#EC4899', bg: '#EC489915' },
                 'os_lifecycle_device_status_summary': { icon: Hourglass, color: '#EC4899', bg: '#EC489915' },
                 'apple_app_updates_summary': { icon: Package, color: '#22C55E', bg: '#22C55E15' },
                 'triggers_summary': { icon: Webhook, color: '#F97316', bg: '#F9731615' },
                 'triggers_fired_trend': { icon: TrendingUp, color: '#F97316', bg: '#F9731615' },
                 'workflow_runs_summary': { icon: Workflow, color: PRIMARY_BLUE, bg: `${PRIMARY_BLUE}15` },
                 'workflow_runs_trend': { icon: TrendingUp, color: PRIMARY_BLUE, bg: `${PRIMARY_BLUE}15` },
                 'device_risk_distribution': { icon: ShieldAlert, color: DANGER, bg: `${DANGER}15` },
                 'device_risk_trend': { icon: TrendingUp, color: DANGER, bg: `${DANGER}15` },
                 'mitre_coverage': { icon: Target, color: '#8B5CF6', bg: '#8B5CF615' },
                 'threat_intel_summary': { icon: Radar, color: '#8B5CF6', bg: '#8B5CF615' },
                 'ticketing_summary': { icon: MessageCircle, color: PRIMARY_BLUE, bg: `${PRIMARY_BLUE}15` },
               };
               const wIcon = iconMap[w.stat] || { icon: BarChart3, color: PRIMARY_BLUE, bg: `${PRIMARY_BLUE}15` };
               return (
                <div key={w.id} className="h-full">
                  <WidgetCardShell theme={activeTheme}>
                    <WidgetHeader
                      title={w.title}
                      isTrend={isTrend}
                      osTotals={osTotals}
                      icon={wIcon.icon}
                      iconColor={wIcon.color}
                      iconBg={wIcon.bg}
                      theme={activeTheme}
                      isLocked={isLocked}
                      widgetId={w.id}
                      onInfoClick={() => setWidgetInfoModal({ widget: w, dataBlock: dataBlock || {} })}
                      onToggleLock={toggleLock}
                      onEdit={() => openBuilder(w)}
                      onRemove={removeWidget}
                    />
                    <div className={`flex-1 px-4 pb-4 pt-3 relative ${!isLocked ? 'drag-handle cursor-move' : ''}`}>
                      {renderWidgetContent(w)}
                    </div>
                  </WidgetCardShell>
                </div>
               )
            })}
          </Responsive>
          )}
          </div>
        </main>
      )}

      {currentView === 'devices' && (
        <DevicesView
          apiToken={apiToken} orgSlug={orgSlug} theme={activeTheme} segmentsList={segmentsList} selectedSegment={selectedSegment}
          onOpenPlayground={() => setCurrentView('playground')}
          onOpenCase={(caseId) => { setPendingCaseId(caseId); setCurrentView('cases'); }}
          onOpenDeviceAudit={(deviceId, deviceLabel) => { setPendingAuditFilter({ id: deviceId, label: deviceLabel }); setCurrentView('auditLogs'); }}
          openDeviceId={pendingDeviceId}
        />
      )}

      {currentView === 'workflows' && (
        <WorkflowsView apiToken={apiToken} orgSlug={orgSlug} theme={activeTheme} canDelete={canDeletePolicyOrWorkflow} canRunDestructive={canRunDestructiveWorkflow} />
      )}

      {currentView === 'compliance' && (
        <CompliancePoliciesView apiToken={apiToken} orgSlug={orgSlug} theme={activeTheme} onOpenAppLists={() => setCurrentView('appLists')} selectedSegment={selectedSegment} segmentsList={segmentsList} canDelete={canDeletePolicyOrWorkflow} canBulkTriage={canBulkTriage} />
      )}

      {currentView === 'cases' && (
        <CasesView apiToken={apiToken} orgSlug={orgSlug} theme={activeTheme} selectedSegment={selectedSegment} segmentsList={segmentsList} currentUserEmail={currentUser?.email} openCaseId={pendingCaseId} canBulkTriage={canBulkTriage} canRunDestructive={canRunDestructiveWorkflow} />
      )}

      {currentView === 'appLists' && (
        <AppListsView apiToken={apiToken} orgSlug={orgSlug} theme={activeTheme} onBack={() => setCurrentView('compliance')} />
      )}

      {currentView === 'auditLogs' && (
        <AuditLogsView
          apiToken={apiToken} orgSlug={orgSlug} theme={activeTheme}
          initialTargetId={pendingAuditFilter?.id} initialTargetLabel={pendingAuditFilter?.label}
          onOpenDevice={(deviceId) => { setPendingDeviceId(deviceId); setCurrentView('devices'); }}
        />
      )}

      {currentView === 'playground' && (
        <main className="flex-1 relative flex flex-col overflow-hidden" style={{ backgroundColor: '#020817' }}>
          {/* Playground header bar */}
          <div className="shrink-0 flex items-center justify-between px-6 py-3 border-b z-10" style={{ borderColor: 'rgba(255,255,255,0.07)', backgroundColor: 'rgba(2,8,23,0.8)', backdropFilter: 'blur(12px)' }}>
            <div className="flex items-center gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <Globe size={15} className="text-blue-400"/>
                  <span className="text-base font-semibold text-white tracking-wide">Playground</span>
                  <HelpIcon slug="playground" theme={{ ...activeTheme, textMuted: 'rgba(255,255,255,0.6)' }} title="Playground admin guide" className="hover:bg-white/10" />
                </div>
                <p className="text-xs text-white/40 mt-0.5" style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 300 }}>Live 3D visualization — {globeDevices.length} devices tracked</p>
              </div>
              <div className="h-8 w-px bg-white/10"/>
              {/* Fleet quick-stats */}
              {(() => {
                const comp = globeDevices.filter(d => d.is_compliant_normalized === true).length;
                const nc   = globeDevices.filter(d => d.is_compliant_normalized === false).length;
                const apple = globeDevices.filter(d => String(d.platform_normalized||'').toLowerCase().includes('apple')||String(d.platform_normalized||'').toLowerCase().includes('ios')).length;
                const android = globeDevices.filter(d => String(d.platform_normalized||'').toLowerCase().includes('android')).length;
                const win = globeDevices.filter(d => String(d.platform_normalized||'').toLowerCase().includes('win')).length;
                return (
                  <div className="flex items-center gap-3">
                    {comp > 0 && <div className="flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-emerald-400"/><span className="text-[11px] font-medium text-white/70">{comp} Compliant</span></div>}
                    {nc  > 0 && <div className="flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-red-400"/><span className="text-[11px] font-medium text-white/70">{nc} Non-compliant</span></div>}
                    {apple > 0 && <div className="flex items-center gap-1.5"><OsIcon platform="apple" size={11} color="#79C6E8"/><span className="text-[11px] text-white/50">{apple}</span></div>}
                    {android > 0 && <div className="flex items-center gap-1.5"><OsIcon platform="android" size={11} color="#3DDC84"/><span className="text-[11px] text-white/50">{android}</span></div>}
                    {win > 0 && <div className="flex items-center gap-1.5"><OsIcon platform="windows" size={11} color="#0078D4"/><span className="text-[11px] text-white/50">{win}</span></div>}
                  </div>
                );
              })()}
            </div>
            <div className="flex items-center gap-3">
              {/* Same shared ViewSwitcher as Devices/Workflows/Compliance/
                  Reporting, right-aligned to match — just recolored for
                  Playground's dark cosmic backdrop, since the component's
                  default theme colors (light-mode bg/card) would be
                  invisible against #020817. Shape, spacing and active-pill
                  behavior are untouched. */}
              <ViewSwitcher
                theme={{
                  bg: 'rgba(255,255,255,0.05)',
                  card: 'rgba(255,255,255,0.14)',
                  border: 'rgba(255,255,255,0.12)',
                  text: '#FFFFFF',
                  textMuted: 'rgba(255,255,255,0.6)',
                }}
                active="playground"
                onChange={(id) => { if (id === 'devices') setCurrentView('devices'); }}
                tabs={[
                  { id: 'devices', label: 'Devices', Icon: Smartphone },
                  { id: 'playground', label: 'Playground', Icon: Globe },
                ]}
              />
              <select
                value={selectedGlobePolicyId}
                onChange={(e) => setSelectedGlobePolicyId(e.target.value)}
                className="px-3 py-1.5 rounded-lg text-[11px] font-medium border outline-none focus:ring-2 focus:ring-brand-500"
                style={{
                  color: selectedGlobePolicyId ? '#A855F7' : 'rgba(255,255,255,0.6)',
                  borderColor: selectedGlobePolicyId ? '#A855F740' : 'rgba(255,255,255,0.1)',
                  backgroundColor: selectedGlobePolicyId ? '#A855F715' : 'rgba(255,255,255,0.05)',
                }}
              >
                <option value="" style={{ color: '#000' }}>All policies</option>
                {globeCompliancePolicies.map(p => <option key={p.id} value={p.id} style={{ color: '#000' }}>{p.name}</option>)}
              </select>
              <label className="flex items-center gap-2 cursor-pointer px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all border" style={{ color: showOnlyNonCompliantGlobe ? '#EF4444' : 'rgba(255,255,255,0.6)', borderColor: showOnlyNonCompliantGlobe ? '#EF444440' : 'rgba(255,255,255,0.1)', backgroundColor: showOnlyNonCompliantGlobe ? '#EF444415' : 'rgba(255,255,255,0.05)' }}>
                <input type="checkbox" checked={showOnlyNonCompliantGlobe} onChange={(e) => setShowOnlyNonCompliantGlobe(e.target.checked)} className="w-3 h-3 rounded border-gray-600 text-red-500 focus:ring-red-500" />
                Non-Compliant Only
              </label>
              <button onClick={handleSyncLocations} disabled={isSyncingLocations} className="flex items-center gap-2 px-3 py-1.5 rounded-lg font-medium text-[11px] transition-all border border-white/10 hover:bg-white/10" style={{ color: 'rgba(255,255,255,0.7)', backgroundColor: 'rgba(255,255,255,0.05)' }}>
                {isSyncingLocations ? <RefreshCw size={12} className="animate-spin text-blue-400"/> : <MapPin size={12} className="text-blue-400"/>}
                {isSyncingLocations ? 'Syncing...' : 'Sync Locations'}
              </button>
              <button
                onClick={() => setIsGlobeRotationPaused(p => !p)}
                title={isGlobeRotationPaused ? 'Resume globe rotation' : 'Pause globe rotation — easier to click devices in a busy region'}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg font-medium text-[11px] transition-all border"
                style={{
                  color: isGlobeRotationPaused ? '#FBBF24' : 'rgba(255,255,255,0.7)',
                  borderColor: isGlobeRotationPaused ? '#FBBF2440' : 'rgba(255,255,255,0.1)',
                  backgroundColor: isGlobeRotationPaused ? '#FBBF2415' : 'rgba(255,255,255,0.05)',
                }}
              >
                {isGlobeRotationPaused ? (
                  // Play glyph — rotation is currently paused
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                ) : (
                  // Pause glyph — rotation is currently active
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/></svg>
                )}
                {isGlobeRotationPaused ? 'Rotation Paused' : 'Pause Rotation'}
              </button>
              <button
                onClick={() => setPlaygroundMode(m => (m === 'map' ? 'globe' : 'map'))}
                title={playgroundMode === 'map' ? 'Switch back to the 3D globe' : 'Switch to a flat, clustered map — easier to click devices packed into the same region'}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg font-medium text-[11px] transition-all border"
                style={{
                  color: playgroundMode === 'map' ? '#38BDF8' : 'rgba(255,255,255,0.7)',
                  borderColor: playgroundMode === 'map' ? '#38BDF840' : 'rgba(255,255,255,0.1)',
                  backgroundColor: playgroundMode === 'map' ? '#38BDF815' : 'rgba(255,255,255,0.05)',
                }}
              >
                {playgroundMode === 'map' ? <Globe size={12}/> : <MapPin size={12}/>}
                {playgroundMode === 'map' ? 'Globe View' : 'Map View'}
              </button>
            </div>
          </div>
          {/* Globe (or, in map mode, the flat clustered map) fills remaining space edge-to-edge */}
          <div className="flex-1 relative">
            {isLoadingGlobe || isLoadingGlobePolicyFilter ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ backgroundColor: '#020817' }}>
                <div className="w-10 h-10 border-2 border-blue-500/20 border-t-blue-500 rounded-full animate-spin mb-4" />
                <span className="text-sm font-medium text-white/40 uppercase tracking-widest">Loading fleet data…</span>
              </div>
            ) : globeDevices.length > 0 ? (
              <div className="absolute inset-0">
                {(() => {
                  let filtered = globeDevices;
                  if (globePolicyViolatingIds) filtered = filtered.filter(d => globePolicyViolatingIds.has(String(d.id || d._id || '')));
                  if (showOnlyNonCompliantGlobe) filtered = filtered.filter(d => d.is_compliant_normalized === false);
                  return playgroundMode === 'map' ? (
                    <PlaygroundMapView
                      items={filtered}
                      activeTheme={activeTheme}
                      onDeviceClick={(item) => openInsight(item)}
                      center={playgroundMapCenter}
                      onBackToGlobe={() => setPlaygroundMode('globe')}
                    />
                  ) : (
                    <GlobeWidget
                      items={filtered}
                      activeTheme={activeTheme}
                      onDeviceClick={(item) => openInsight(item)}
                      filterActive={showOnlyNonCompliantGlobe || !!selectedGlobePolicyId}
                      totalDevices={globeDevices.length}
                      paused={isGlobeRotationPaused}
                      onZoom={handleGlobeZoom}
                    />
                  );
                })()}
              </div>
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3" style={{ backgroundColor: '#020817' }}>
                <Globe size={40} className="text-white/10"/>
                <span className="text-sm text-white/30 uppercase tracking-widest font-medium">No devices found</span>
                <button onClick={handleSyncLocations} className="mt-2 px-4 py-2 rounded-lg bg-blue-600/20 border border-blue-500/30 text-blue-400 text-xs font-semibold hover:bg-blue-600/30 transition-colors">
                  Sync device locations
                </button>
              </div>
            )}
          </div>
        </main>
      )}

      {currentView === 'reporting' && (
        <main className="p-8 pb-16 flex-1 relative overflow-y-auto custom-scrollbar">
          <header className="mb-6 flex items-start justify-between flex-wrap gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h1 className="text-2xl font-semibold leading-tight" style={{ color: activeTheme.text }}>Reporting</h1>
                <HelpIcon slug="reporting" anchor={{ builder: 'builder-tab', scheduled: 'schedules-tab', template: 'template-tab' }[reportingTab]} theme={activeTheme} title="Reporting admin guide" />
              </div>
              <p className="text-sm" style={{ color: activeTheme.textMuted }}>Build, schedule, and manage automated reports.</p>
            </div>
            <ViewSwitcher
              theme={activeTheme}
              active={reportingTab}
              onChange={setReportingTab}
              className="ml-auto"
              tabs={[
                { id: 'builder',   label: 'Builder',    Icon: FileText  },
                { id: 'scheduled', label: `Schedules (${scheduledReports.length})`, Icon: Calendar },
                { id: 'template',  label: 'Template',   Icon: Code },
              ]}
            />
          </header>

          {/* ── SCHEDULES LIST ── */}
          {reportingTab === 'scheduled' && (
            <div className="max-w-4xl mx-auto pb-12 space-y-4">
              {scheduledReports.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-24 rounded-2xl border" style={{ backgroundColor: activeTheme.card, borderColor: activeTheme.border }}>
                  <Calendar size={40} className="mb-4 opacity-20" style={{ color: activeTheme.textMuted }}/>
                  <p className="text-sm font-medium mb-1" style={{ color: activeTheme.textMuted }}>No scheduled reports yet</p>
                  <p className="text-xs mb-6" style={{ color: activeTheme.textMuted }}>Use the Builder tab to create and save a schedule.</p>
                  <button onClick={() => setReportingTab('builder')} className="px-5 py-2.5 rounded-xl bg-[#0055FF] text-white text-sm font-semibold hover:bg-blue-600 transition-colors">Open Builder</button>
                </div>
              ) : scheduledReports.map(sr => {
                const freqLabel = { daily: 'Daily', weekly: 'Weekly (Mon)', monthly: 'Monthly (1st)' }[sr.schedule?.frequency] || 'Weekly';
                return (
                  <div key={sr.id} className="p-5 rounded-2xl border flex items-start gap-4" style={{ backgroundColor: activeTheme.card, borderColor: activeTheme.border }}>
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: `${PRIMARY_BLUE}15`, color: PRIMARY_BLUE }}>
                      <Calendar size={18}/>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="font-semibold text-sm" style={{ color: activeTheme.text }}>{sr.name || 'Unnamed Report'}</span>
                        <span className="text-[10px] font-light px-2.5 py-0.5 rounded-full border border-current/25 shrink-0" style={{ backgroundColor: `${PRIMARY_BLUE}15`, color: PRIMARY_BLUE }}>{freqLabel}</span>
                      </div>
                      <div className="text-xs space-y-0.5" style={{ color: activeTheme.textMuted }}>
                        <div>at {sr.schedule?.time || '09:00'} ({sr.schedule?.timezone || 'UTC'}){sr.schedule?.startDate ? ` · from ` : ''}</div>
                        <div>{sr.sources?.length || 0} data source{sr.sources?.length !== 1 ? 's' : ''} · {sr.timeLapse}</div>
                        {sr.delivery?.email && sr.emailRecipients && <div>📧 {sr.emailRecipients}</div>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {/* Run now */}
                      <button title="Run now" disabled={isGeneratingReport}
                        onClick={async () => {
                          setIsGeneratingReport(true);
                          try {
                            const af = { ...sr.filters };
                            if (selectedSegment && selectedSegment.id !== 0) af.segmentId = selectedSegment.id || selectedSegment._id;
                            const res = await axios.post('/api/reports/generate', { workspace: orgSlug, sources: sr.sources, timeLapse: sr.timeLapse, filters: af, display: sr.display, webhookUrl: sr.delivery?.chat ? webhookUrl : null, emailRecipients: sr.delivery?.email ? sr.emailRecipients : null, smtp: sr.delivery?.email ? smtpConfig : null }, { headers: { 'Authorization': `Bearer ${apiToken}`, 'X-Workspace-Slug': orgSlug }, responseType: 'blob' });
                            const url = window.URL.createObjectURL(new Blob([res.data]));
                            const a = document.createElement('a'); a.href = url; a.setAttribute('download', `Applivery_Report_${orgSlug}_${new Date().toISOString().split('T')[0]}.pdf`); document.body.appendChild(a); a.click(); a.remove();
                          } catch { alert('Failed to generate report.'); } finally { setIsGeneratingReport(false); }
                        }}
                        className="p-2 rounded-lg hover:opacity-70 transition-opacity disabled:opacity-30" style={{ backgroundColor: `${SUCCESS}15`, color: SUCCESS }}>
                        <Activity size={15}/>
                      </button>
                      {/* Edit */}
                      <button title="Edit" onClick={() => { setReportConfig({ ...sr }); setEditingReportId(sr.id); setReportingTab('builder'); setIsReportBuilderModalOpen(true); }}
                        className="p-2 rounded-lg hover:opacity-70 transition-opacity" style={{ backgroundColor: `${PRIMARY_BLUE}15`, color: PRIMARY_BLUE }}>
                        <Edit3 size={15}/>
                      </button>
                      {/* Delete */}
                      <button title="Delete" onClick={() => { if (window.confirm(`Delete "${sr.name || 'this schedule'}"?`)) setScheduledReports(prev => prev.filter(r => r.id !== sr.id)); }}
                        className="p-2 rounded-lg hover:opacity-70 transition-opacity" style={{ backgroundColor: `${DANGER}15`, color: DANGER }}>
                        <Trash2 size={15}/>
                      </button>
                    </div>
                  </div>
                );
              })}
              {scheduledReports.length > 0 && (
                <button onClick={() => { setReportConfig(_blankReportConfig()); setEditingReportId(null); setIsReportBuilderModalOpen(true); }}
                  className="w-full py-3 rounded-xl border font-medium text-sm flex items-center justify-center gap-2 hover:opacity-80 transition-opacity"
                  style={{ borderColor: PRIMARY_BLUE, color: PRIMARY_BLUE }}>
                  <Plus size={15}/> Add Another Schedule
                </button>
              )}
            </div>
          )}

          {/* ── BUILDER ── */}
          {reportingTab === 'builder' && (
          <div className="flex flex-col items-center justify-center py-16 gap-6">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ backgroundColor: `${PRIMARY_BLUE}12` }}>
              <FileText size={28} style={{ color: PRIMARY_BLUE }} />
            </div>
            <div className="text-center">
              <h2 className="text-lg font-semibold mb-1" style={{ color: activeTheme.text }}>Build a Report</h2>
              <p className="text-sm" style={{ color: activeTheme.textMuted }}>Configure data sources, filters, and delivery to generate a PDF report.</p>
            </div>
            <button
              onClick={() => { setIsReportBuilderModalOpen(true); }}
              className="flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold text-white bg-brand-600 transition-all duration-200 hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2"
            >
              <Plus size={16} /> Create Report
            </button>
            {scheduledReports.length > 0 && (
              <button onClick={() => setReportingTab('scheduled')} className="text-sm hover:opacity-70 transition-opacity" style={{ color: PRIMARY_BLUE }}>
                View {scheduledReports.length} scheduled report{scheduledReports.length !== 1 ? 's' : ''}
              </button>
            )}
          </div>
          )} {/* end builder tab */}

      {/* ── REPORT BUILDER MODAL ── */}
      {isReportBuilderModalOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4 overflow-y-auto" onClick={e => { if (e.target === e.currentTarget) setIsReportBuilderModalOpen(false); }}>
          <div className="w-full max-w-2xl rounded-2xl shadow-2xl flex flex-col max-h-[90vh]" style={{ backgroundColor: activeTheme.card, border: `1px solid ${activeTheme.border}` }}>
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-5 border-b shrink-0" style={{ borderColor: activeTheme.border }}>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${PRIMARY_BLUE}15`, color: PRIMARY_BLUE }}>
                  <FileText size={18} />
                </div>
                <div>
                  <h2 className="text-base font-bold leading-tight" style={{ color: activeTheme.text }}>
                    {editingReportId ? 'Edit Report' : 'Build a Report'}
                  </h2>
                  <p className="text-xs mt-0.5" style={{ color: activeTheme.textMuted }}>Configure your report and generate or schedule it</p>
                </div>
              </div>
              <button onClick={() => setIsReportBuilderModalOpen(false)} className="w-8 h-8 flex items-center justify-center rounded-full hover:opacity-70 transition-opacity" style={{ color: activeTheme.textMuted, backgroundColor: `${activeTheme.textMuted}12` }}>
                <X size={15} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto custom-scrollbar">
              <div className="p-6 flex flex-col gap-6">

                {/* Report Name */}
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: activeTheme.textMuted }}>Report Name</label>
                  <input type="text" placeholder="e.g. Weekly Compliance Report" value={reportConfig.name || ''} onChange={e => setReportConfig({ ...reportConfig, name: e.target.value })}
                    className="w-full rounded-xl px-4 py-3 text-sm border outline-none focus:border-blue-500 transition-colors focus:ring-2 focus:ring-brand-500"
                    style={{ backgroundColor: activeTheme.bg, borderColor: activeTheme.border, color: activeTheme.text }} />
                </div>

                {/* 1. Data Sources */}
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: activeTheme.textMuted }}>1. Select Data Sources</label>
                  <div className="grid grid-cols-2 gap-2">
                    {CATALOG.flatMap(g => g.items).filter(i => SOURCE_SHAPES[i.stat] !== 'orgProfile').map(item => (
                      <label key={item.stat} className="flex items-center gap-2.5 p-2.5 rounded-xl border cursor-pointer transition-colors hover:border-blue-500"
                        style={{ backgroundColor: activeTheme.bg, borderColor: reportConfig.sources.includes(item.stat) ? PRIMARY_BLUE : activeTheme.border }}>
                        <input type="checkbox" className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" checked={reportConfig.sources.includes(item.stat)}
                          onChange={e => { const s = e.target.checked ? [...reportConfig.sources, item.stat] : reportConfig.sources.filter(x => x !== item.stat); setReportConfig({...reportConfig, sources: s}); }} />
                        <item.icon size={14} style={{ color: reportConfig.sources.includes(item.stat) ? PRIMARY_BLUE : activeTheme.textMuted }} />
                        <span className="text-xs font-medium" style={{ color: activeTheme.text }}>{item.label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* 2. Time Lapse */}
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: activeTheme.textMuted }}>2. Time Lapse</label>
                  <select value={reportConfig.timeLapse} onChange={e => setReportConfig({...reportConfig, timeLapse: e.target.value})}
                    className="w-full rounded-xl px-4 py-2.5 outline-none text-sm border focus:border-blue-500 transition-colors focus:ring-2 focus:ring-brand-500"
                    style={{ backgroundColor: activeTheme.bg, color: activeTheme.text, borderColor: activeTheme.border }}>
                    <option value="Last 7 Days">Last 7 Days</option>
                    <option value="Last 30 Days">Last 30 Days</option>
                    <option value="All Time">All Time</option>
                  </select>
                </div>

                {/* 3. Filters */}
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: activeTheme.textMuted }}>3. Filters</label>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium mb-1.5" style={{ color: activeTheme.textMuted }}>Operating System</label>
                      <select value={reportConfig.filters.type} onChange={e => setReportConfig({...reportConfig, filters: {...reportConfig.filters, type: e.target.value}})}
                        className="w-full rounded-lg px-3 py-2 text-sm border outline-none focus:border-blue-500 focus:ring-2 focus:ring-brand-500" style={{ backgroundColor: activeTheme.bg, color: activeTheme.text, borderColor: activeTheme.border }}>
                        <option value="all">All OS</option><option value="apple">iOS / macOS</option><option value="android">Android</option><option value="windows">Windows</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1.5" style={{ color: activeTheme.textMuted }}>Compliance</label>
                      <select value={reportConfig.filters.complianceStatus} onChange={e => setReportConfig({...reportConfig, filters: {...reportConfig.filters, complianceStatus: e.target.value}})}
                        className="w-full rounded-lg px-3 py-2 text-sm border outline-none focus:border-blue-500 focus:ring-2 focus:ring-brand-500" style={{ backgroundColor: activeTheme.bg, color: activeTheme.text, borderColor: activeTheme.border }}>
                        <option value="all">All devices</option><option value="compliant">Compliant only</option><option value="non_compliant">Non-compliant only</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1.5" style={{ color: activeTheme.textMuted }}>Role</label>
                      <select value={reportConfig.filters.role} onChange={e => setReportConfig({...reportConfig, filters: {...reportConfig.filters, role: e.target.value}})}
                        className="w-full rounded-lg px-3 py-2 text-sm border outline-none focus:border-blue-500 focus:ring-2 focus:ring-brand-500" style={{ backgroundColor: activeTheme.bg, color: activeTheme.text, borderColor: activeTheme.border }}>
                        <option value="all">All roles</option><option value="owner">Owner</option><option value="admin">Admin</option><option value="editor">Editor</option><option value="viewer">Viewer</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1.5" style={{ color: activeTheme.textMuted }}>Auth Origin</label>
                      <select value={reportConfig.filters.authOrigin} onChange={e => setReportConfig({...reportConfig, filters: {...reportConfig.filters, authOrigin: e.target.value}})}
                        className="w-full rounded-lg px-3 py-2 text-sm border outline-none focus:border-blue-500 focus:ring-2 focus:ring-brand-500" style={{ backgroundColor: activeTheme.bg, color: activeTheme.text, borderColor: activeTheme.border }}>
                        <option value="all">All origins</option><option value="dashboard">Dashboard</option><option value="sso">SSO</option>
                      </select>
                    </div>
                  </div>
                  <label className="flex items-center gap-2.5 cursor-pointer mt-3">
                    <input type="checkbox" checked={reportConfig.filters.inactive24h} onChange={e => setReportConfig({...reportConfig, filters: {...reportConfig.filters, inactive24h: e.target.checked}})} className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                    <span className="text-xs font-medium" style={{ color: activeTheme.text }}>Hide devices not reported in last 24h</span>
                  </label>
                </div>

                {/* 4. Display Options */}
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: activeTheme.textMuted }}>4. Display Options</label>
                  <div className="flex flex-col gap-3">
                    {[
                      { key: 'trend',  label: 'Trend Charts',         Icon: TrendingUp, typeKey: 'trend_type',  types: [['line','Line Graph'],['bar','Bar Chart']] },
                      { key: 'donut',  label: 'Distribution Charts',  Icon: PieIcon,    typeKey: 'donut_type',  types: [['donut','Donut'],['pie','Pie'],['bar','Bar'],['radar','Radar']] },
                      { key: 'table',  label: 'Data Tables',          Icon: List,       typeKey: 'table_type',  types: [['standard','Standard'],['progress','Progress Bars']] },
                    ].map(({ key, label, Icon, typeKey, types }) => (
                      <div key={key}>
                        <label className="flex items-center gap-2.5 cursor-pointer">
                          <input type="checkbox" checked={reportConfig.display[key]} onChange={e => setReportConfig({...reportConfig, display: {...reportConfig.display, [key]: e.target.checked}})} className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                          <Icon size={14} style={{ color: activeTheme.textMuted }} />
                          <span className="text-sm font-medium" style={{ color: activeTheme.text }}>{label}</span>
                          {reportConfig.display[key] && (
                            <select value={reportConfig.display[typeKey] || types[0][0]} onChange={e => setReportConfig({...reportConfig, display: {...reportConfig.display, [typeKey]: e.target.value}})}
                              className="ml-auto rounded-lg px-2.5 py-1 outline-none text-xs border focus:border-blue-500 focus:ring-2 focus:ring-brand-500" style={{ backgroundColor: activeTheme.bg, color: activeTheme.text, borderColor: activeTheme.border }}>
                              {types.map(([v,l]) => <option key={v} value={v}>{l}</option>)}
                            </select>
                          )}
                        </label>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 5. Delivery */}
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: activeTheme.textMuted }}>5. Delivery</label>
                  <div className="flex flex-col gap-3">
                    <label className="flex items-center gap-2.5 cursor-pointer">
                      <input type="checkbox" checked={reportConfig.delivery.download} onChange={e => setReportConfig({...reportConfig, delivery: {...reportConfig.delivery, download: e.target.checked}})} className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                      <Download size={14} style={{ color: activeTheme.textMuted }} />
                      <span className="text-sm font-medium" style={{ color: activeTheme.text }}>Download PDF directly</span>
                    </label>
                    <label className="flex items-center gap-2.5 cursor-pointer">
                      <input type="checkbox" checked={reportConfig.delivery.chat} onChange={e => setReportConfig({...reportConfig, delivery: {...reportConfig.delivery, chat: e.target.checked}})} className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                      <MessageCircle size={14} style={{ color: activeTheme.textMuted }} />
                      <span className="text-sm font-medium" style={{ color: activeTheme.text }}>Send to Webhook</span>
                    </label>
                    {reportConfig.delivery.chat && !webhookUrl && <span className="text-xs text-red-500 ml-7">No Webhook URL configured in Settings.</span>}
                    <label className="flex items-center gap-2.5 cursor-pointer">
                      <input type="checkbox" checked={reportConfig.delivery.email} onChange={e => setReportConfig({...reportConfig, delivery: {...reportConfig.delivery, email: e.target.checked}})} className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                      <Mail size={14} style={{ color: activeTheme.textMuted }} />
                      <span className="text-sm font-medium" style={{ color: activeTheme.text }}>Send via Email</span>
                    </label>
                    {reportConfig.delivery.email && (
                      <div className="ml-7">
                        <input type="text" placeholder="team@example.com, boss@example.com" value={reportConfig.emailRecipients} onChange={e => setReportConfig({...reportConfig, emailRecipients: e.target.value})}
                          className="w-full rounded-lg px-3 py-2 text-sm border focus:border-blue-500 outline-none focus:ring-2 focus:ring-brand-500" style={{ backgroundColor: activeTheme.bg, borderColor: activeTheme.border, color: activeTheme.text }} />
                        {(!smtpConfig.host || !smtpConfig.user) && <span className="text-xs text-red-500 mt-1 block">SMTP not configured in Settings.</span>}
                      </div>
                    )}
                  </div>
                </div>

                {/* 6. Scheduling */}
                <div className="rounded-xl border p-4 transition-all" style={{ borderColor: reportConfig.schedule.enabled ? PRIMARY_BLUE : activeTheme.border, backgroundColor: reportConfig.schedule.enabled ? `${PRIMARY_BLUE}06` : activeTheme.bg }}>
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: activeTheme.textMuted }}>6. Automation & Scheduling</span>
                      <p className="text-xs mt-0.5" style={{ color: activeTheme.textMuted }}>Run automatically on a recurring schedule.</p>
                    </div>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <span className="text-xs font-bold" style={{ color: reportConfig.schedule.enabled ? PRIMARY_BLUE : activeTheme.textMuted }}>{reportConfig.schedule.enabled ? 'ON' : 'OFF'}</span>
                      <input type="checkbox" checked={reportConfig.schedule.enabled} onChange={e => setReportConfig({...reportConfig, schedule: {...reportConfig.schedule, enabled: e.target.checked}})} className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                    </label>
                  </div>
                  {reportConfig.schedule.enabled && (
                    <div className="grid grid-cols-2 gap-3 mt-4 pt-4 border-t" style={{ borderColor: activeTheme.border }}>
                      <div>
                        <label className="block text-xs font-medium mb-1.5" style={{ color: activeTheme.textMuted }}>Frequency</label>
                        <select value={reportConfig.schedule.frequency} onChange={e => setReportConfig({...reportConfig, schedule: {...reportConfig.schedule, frequency: e.target.value}})}
                          className="w-full rounded-lg px-3 py-2 text-sm border outline-none focus:border-blue-500 focus:ring-2 focus:ring-brand-500" style={{ backgroundColor: activeTheme.card, color: activeTheme.text, borderColor: activeTheme.border }}>
                          <option value="daily">Daily</option><option value="weekly">Weekly (Mon)</option><option value="monthly">Monthly (1st)</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1.5" style={{ color: activeTheme.textMuted }}>Execution Time</label>
                        <input type="time" value={reportConfig.schedule.time || '09:00'} onChange={e => setReportConfig({...reportConfig, schedule: {...reportConfig.schedule, time: e.target.value}})}
                          className="w-full rounded-lg px-3 py-2 text-sm border outline-none focus:border-blue-500 focus:ring-2 focus:ring-brand-500" style={{ backgroundColor: activeTheme.card, color: activeTheme.text, borderColor: activeTheme.border }} />
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1.5" style={{ color: activeTheme.textMuted }}>Timezone</label>
                        <select value={reportConfig.schedule.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'}
                          onChange={e => setReportConfig({...reportConfig, schedule: {...reportConfig.schedule, timezone: e.target.value}})}
                          className="w-full rounded-lg px-3 py-2 text-sm border outline-none focus:border-blue-500 focus:ring-2 focus:ring-brand-500" style={{ backgroundColor: activeTheme.card, color: activeTheme.text, borderColor: activeTheme.border }}>
                          {[
                            'UTC',
                            'Europe/Madrid','Europe/London','Europe/Paris','Europe/Berlin','Europe/Rome','Europe/Amsterdam',
                            'Europe/Lisbon','Europe/Stockholm','Europe/Zurich','Europe/Warsaw','Europe/Prague',
                            'America/New_York','America/Chicago','America/Denver','America/Los_Angeles',
                            'America/Sao_Paulo','America/Argentina/Buenos_Aires','America/Mexico_City','America/Bogota',
                            'Asia/Tokyo','Asia/Shanghai','Asia/Singapore','Asia/Dubai','Asia/Kolkata','Asia/Seoul',
                            'Asia/Jakarta','Asia/Bangkok','Asia/Hong_Kong',
                            'Australia/Sydney','Australia/Melbourne','Pacific/Auckland',
                            'Africa/Cairo','Africa/Johannesburg','Africa/Lagos',
                          ].map(tz => <option key={tz} value={tz}>{tz.replace(/_/g, ' ')}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1.5" style={{ color: activeTheme.textMuted }}>Start Date</label>
                        <input type="date" value={reportConfig.schedule.startDate || ''} onChange={e => setReportConfig({...reportConfig, schedule: {...reportConfig.schedule, startDate: e.target.value}})}
                          className="w-full rounded-lg px-3 py-2 text-sm border outline-none focus:border-blue-500 focus:ring-2 focus:ring-brand-500" style={{ backgroundColor: activeTheme.card, color: activeTheme.text, borderColor: activeTheme.border }} />
                      </div>
                    </div>
                  )}
                </div>

              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 border-t flex items-center justify-between gap-3 shrink-0" style={{ borderColor: activeTheme.border }}>
              <div className="flex items-center gap-2">
                {editingReportId && (
                  <button onClick={() => { setEditingReportId(null); setReportConfig(_blankReportConfig()); setIsReportBuilderModalOpen(false); }}
                    className="px-4 py-2.5 rounded-xl text-sm font-medium border transition-colors hover:opacity-70" style={{ color: DANGER, borderColor: `${DANGER}30` }}>
                    Cancel Edit
                  </button>
                )}
                <button onClick={() => setIsReportBuilderModalOpen(false)} className="px-4 py-2.5 rounded-xl text-sm font-medium transition-colors hover:opacity-70" style={{ color: activeTheme.textMuted, border: `1px solid ${activeTheme.border}` }}>
                  Cancel
                </button>
              </div>
              <div className="flex items-center gap-2">
                {reportConfig.schedule.enabled && (
                  <button onClick={() => {
                    // workspaceSlug pins this schedule to whichever workspace it was
                    // built in, so the backend report_scheduler_loop can resolve the
                    // right automation credential for it — Applivery tokens are
                    // per-workspace, so a schedule created under one workspace can't
                    // run correctly under another's credential.
                    const saved = { ...reportConfig, id: editingReportId || `sched_${Date.now()}`, name: reportConfig.name || `Report ${scheduledReports.length + 1}`, workspaceSlug: orgSlug };
                    if (editingReportId) { setScheduledReports(prev => prev.map(r => r.id === editingReportId ? saved : r)); }
                    else { setScheduledReports(prev => [...prev, saved]); }
                    setEditingReportId(null); setReportConfig(_blankReportConfig()); setIsReportBuilderModalOpen(false); setReportingTab('scheduled');
                  }} className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold border transition-colors hover:opacity-80"
                    style={{ color: PRIMARY_BLUE, borderColor: PRIMARY_BLUE, backgroundColor: `${PRIMARY_BLUE}10` }}>
                    <Calendar size={14}/> {editingReportId ? 'Update Schedule' : 'Save Schedule'}
                  </button>
                )}
                <button onClick={async () => {
                  setIsGeneratingReport(true);
                  try {
                    const appliedFilters = { ...reportConfig.filters };
                    if (selectedSegment && selectedSegment.id !== 0) appliedFilters.segmentId = selectedSegment.id || selectedSegment._id;
                    const payload = { workspace: orgSlug, sources: reportConfig.sources, timeLapse: reportConfig.timeLapse, filters: appliedFilters, display: reportConfig.display, webhookUrl: reportConfig.delivery.chat ? webhookUrl : null, emailRecipients: reportConfig.delivery.email ? reportConfig.emailRecipients : null, smtp: reportConfig.delivery.email ? smtpConfig : null };
                    const res = await axios.post('/api/reports/generate', payload, { headers: { 'Authorization': `Bearer ${apiToken}`, 'X-Workspace-Slug': orgSlug }, responseType: 'blob' });
                    if (reportConfig.delivery.download) {
                      const url = window.URL.createObjectURL(new Blob([res.data]));
                      const link = document.createElement('a'); link.href = url;
                      link.setAttribute('download', `Applivery_Report_${orgSlug}_${new Date().toISOString().split('T')[0]}.pdf`);
                      document.body.appendChild(link); link.click(); link.remove();
                    }
                    setIsReportBuilderModalOpen(false);
                  } catch (err) { console.error(err); alert('Failed to generate report.'); }
                  finally { setIsGeneratingReport(false); }
                }} disabled={isGeneratingReport} className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold text-white bg-brand-600 transition-all duration-200 disabled:opacity-50 hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2">
                  {isGeneratingReport ? <Activity size={14} className="animate-spin"/> : <FileText size={14}/>}
                  {isGeneratingReport ? 'Generating...' : 'Generate Now'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

        </main>
      )}

      {/* ── FOOTER — theme selector + status + operational pill ── */}
      <footer
        className="fixed bottom-0 left-0 right-0 z-[50] flex items-center justify-between px-6 py-2.5 border-t"
        style={{ backgroundColor: activeTheme.card, borderColor: activeTheme.border, height: '44px' }}
      >
        {/* Left: copyright */}
        <span className="text-[11px]" style={{ color: activeTheme.textMuted }}>
          ©{new Date().getFullYear()} Applivery S.L. All rights reserved
        </span>

        {/* Right: links + operational + theme + language stub */}
        <div className="flex items-center gap-4">
          {[
            { label: 'Documentation', href: 'https://www.applivery.com/docs/' },
            { label: 'Legal', href: 'https://www.applivery.com/legal/terms-of-service/' },
            { label: 'Service status', href: null },
          ].map(({ label, href }) => (
            href
              ? <a key={label} href={href} target="_blank" rel="noopener noreferrer" className="text-[11px] hover:opacity-80 transition-opacity hidden sm:block" style={{ color: activeTheme.textMuted, textDecoration: 'none' }}>{label}</a>
              : <span key={label} className="text-[11px] cursor-pointer hover:opacity-80 transition-opacity hidden sm:block" style={{ color: activeTheme.textMuted }}>{label}</span>
          ))}

          {/* Operational pill */}
          <div
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border"
            style={{
              backgroundColor: `${SUCCESS}12`,
              borderColor: `${SUCCESS}30`,
            }}
          >
            <div className={`h-1.5 w-1.5 rounded-full ${connectionStatus === 'ONLINE' ? 'bg-emerald-500' : 'bg-red-500'}`}
              style={{ boxShadow: connectionStatus === 'ONLINE' ? '0 0 5px #22c55e' : 'none' }}
            />
            <span className="text-[10px] font-semibold" style={{ color: SUCCESS }}>
              {connectionStatus === 'ONLINE' ? 'Operational' : connectionStatus}
            </span>
          </div>

          {/* Language stub */}
          <div className="flex items-center gap-1.5 cursor-pointer hover:opacity-80 transition-opacity">
            <Globe size={13} style={{ color: activeTheme.textMuted }} />
            <span className="text-[11px]" style={{ color: activeTheme.textMuted }}>English</span>
          </div>

          {/* Theme toggle */}
          <div className="relative flex items-center">
            <button
              onClick={() => { setIsThemeMenuOpen(!isThemeMenuOpen); setIsWorkspaceMenuOpen(false); }}
              className="flex items-center justify-center w-7 h-7 rounded-md transition hover:opacity-70"
              style={{ color: activeTheme.textMuted }}
            >
              {themeMode === 'light' ? <Sun size={14} strokeWidth={1.5}/> : themeMode === 'dark' ? <Moon size={14} strokeWidth={1.5}/> : <Monitor size={14} strokeWidth={1.5}/>}
            </button>
            {isThemeMenuOpen && (
              <div className="absolute right-0 bottom-full mb-2 w-48 rounded-xl shadow-xl overflow-hidden z-[200] border" style={{ backgroundColor: activeTheme.card, borderColor: activeTheme.border }}>
                {[
                  { mode: 'system', Icon: Monitor, label: 'System default' },
                  { mode: 'light',  Icon: Sun,     label: 'Light mode'     },
                  { mode: 'dark',   Icon: Moon,    label: 'Dark mode'      },
                ].map(({ mode, Icon, label }) => (
                  <button key={mode} onClick={() => { setThemeMode(mode); setIsThemeMenuOpen(false); }}
                    className="w-full text-left px-4 py-3 text-sm flex items-center gap-3 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                    style={{ color: activeTheme.text }}>
                    <Icon size={14}/> {label} {themeMode === mode && <Check size={13} className="ml-auto" style={{ color: PRIMARY_BLUE }}/>}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </footer>

      {selectedWidgetItems && (
        <ModalBackdrop onClose={() => setSelectedWidgetItems(null)}>
          <ModalShell theme={activeTheme}>
            <ModalHeader
              title={selectedWidgetItems.title}
              subtitle={`${selectedWidgetItems.items.length} items found`}
              onClose={() => setSelectedWidgetItems(null)}
              theme={activeTheme}
              icon={List}
              iconColor={PRIMARY_BLUE}
              iconBg={`${PRIMARY_BLUE}15`}
            />
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-2 custom-scrollbar">
              {selectedWidgetItems.items.map((item, idx) => {
                const isBuild = item.versionName !== undefined && (item.applicationInfo !== undefined || item.os !== undefined || item.originalExtension !== undefined);
                const isDownload = item.member !== undefined && item.networkInfo !== undefined;
                const getDisplayName = (item) => {
                  if (item.display_name) return item.display_name;
                  if (item.type_normalized === 'segment') return item.name || 'Unnamed Segment';
                  if (isBuild) return item.applicationInfo?.name || item.application || 'Unknown App';
                  if (isDownload) return `${item.member?.firstName || ''} ${item.member?.lastName || ''}`.trim() || item.member?.email || 'Unknown Downloader';
                  const target = item.user || item.employee || item;
                  if (target.firstName || target.lastName) return `${target.firstName || ''} ${target.lastName || ''}`.trim();
                  if (target.name) return target.name;
                  if (item.name) return item.name;
                  if (item.displayName) return item.displayName;
                  return target.email || item.email || item.summary?.model || 'Unknown Item';
                };
                const label = getDisplayName(item);
                let subLabel = '';
                if (item.type_normalized === 'segment') { subLabel = `ID: ${item.id} · Children: ${item.children?.length || 0}`; }
                else if (isBuild) { subLabel = `v${item.versionName} (${item.versionCode}) · ${item.os || 'Unknown'}`; }
                else if (isDownload) { subLabel = `IP: ${item.networkInfo?.ip || 'N/A'} · ${item.applicationInfo?.name || 'App'}`; }
                else {
                  if (item.oss && Array.isArray(item.oss)) { subLabel = item.oss.join(' · ').toUpperCase(); }
                  else { subLabel = item.display_email || item.email || item.user?.email || item.employee?.email || item.platform_normalized || item.summary?.osVersion || ''; }
                }
                const iconToUse = isBuild ? <Box size={16} /> : isDownload ? <Download size={16} /> : item.type_normalized === 'segment' ? <Layout size={16} /> : <List size={16} />;
                return (
                  <ModalListItem
                    key={item.id || item._id || idx}
                    label={label}
                    subLabel={subLabel}
                    icon={iconToUse}
                    theme={activeTheme}
                    onClick={() => openInsight(item)}
                  />
                );
              })}
            </div>
          </ModalShell>
        </ModalBackdrop>
      )}

      {activeInsight && (
        <ModalBackdrop onClose={() => setActiveInsight(null)}>
          <ModalShell theme={activeTheme} maxWidth="max-w-xl" maxHeight="max-h-[85vh]">
            <ModalHeader
              title="Details"
              onClose={() => setActiveInsight(null)}
              theme={activeTheme}
              icon={Info}
              iconColor={PRIMARY_BLUE}
              iconBg={`${PRIMARY_BLUE}15`}
            />
            <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">{renderInsightContent()}</div>
          </ModalShell>
        </ModalBackdrop>
      )}

      {selectedOrgProfile && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-3xl rounded-2xl shadow-2xl flex flex-col max-h-[90vh] transition-colors duration-300 overflow-hidden" style={{ backgroundColor: activeTheme.card, border: `1px solid ` }}>
            <div className="flex justify-between items-center p-6 border-b shrink-0" style={{ borderColor: activeTheme.border, backgroundColor: activeTheme.card }}>
              <h2 className="text-xl font-bold" style={{ color: activeTheme.text }}>Workspace Profile</h2>
              <button onClick={() => setSelectedOrgProfile(null)} className="hover:text-red-500 transition-colors" style={{ color: activeTheme.textMuted }}><X size={20} /></button>
            </div>
            
            <div className="p-8 overflow-y-auto custom-scrollbar flex-1">
              {/* Header: Branding */}
              <div className="flex flex-col items-center justify-center mb-10">
                 {selectedOrgProfile.branding?.logo ? ( 
                   <img src={selectedOrgProfile.branding.logo} alt="Logo" className="h-20 object-contain mb-4" /> 
                 ) : ( 
                   <div className="w-20 h-20 rounded-2xl flex items-center justify-center mb-4" style={{ backgroundColor: `${PRIMARY_BLUE}15` }}>
                     <Building2 size={40} className="text-blue-500" />
                   </div>
                 )}
                <h2 className="text-2xl font-black text-center" style={{ color: activeTheme.text }}>{selectedOrgProfile.name}</h2>
                <p className="text-sm font-medium text-center mt-1" style={{ color: activeTheme.textMuted }}>{selectedOrgProfile.slug}</p>
                <div className="flex items-center gap-3 mt-4">
                   <span className="px-3 py-1 rounded-full text-[10px] font-light border border-current/25 capitalize" style={{ borderColor: activeTheme.border, color: activeTheme.textMuted }}>{selectedOrgProfile.type || 'Company'}</span>
                   <span className="px-3 py-1 rounded-full text-[10px] font-light bg-brand-600 text-white capitalize">Plan: {selectedOrgProfile.lastPlan?.replace('-', ' ') || 'Enterprise'}</span>
                </div>
              </div>

              {/* SECTION: Usage, Allows and Limits */}
              <div className="mb-10">
                <h3 className="text-[11px] font-bold uppercase tracking-widest mb-6" style={{ color: activeTheme.textMuted }}>Usage, allows and limits</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-8">
							{[
							  { 
							    label: 'Apps', 
							    usage: selectedOrgProfile.counts?.apps || 0, 
							    limit: selectedOrgProfile.limits?.apps || 0 
							  },
								{ 
								  label: 'Installations', 
								  usage: selectedOrgProfile.counts?.builds || 0, 
								  limit: selectedOrgProfile.limits?.installations || selectedOrgProfile.limits?.builds || 5000 
								},
							  { 
							    label: 'Collaborators', 
							    usage: selectedOrgProfile.counts?.collaborators || 0, 
							    limit: selectedOrgProfile.limits?.collaborators || 0 
							  },
							  { 
							    label: 'Employees', 
							    usage: selectedOrgProfile.counts?.employees || 0, 
							    limit: selectedOrgProfile.limits?.employees || 0 
							  },
							  { 
							    label: 'Devices', 
							  // Summing up the nested OS device counts from the API
                  usage: (selectedOrgProfile.counts?.mdm?.android?.devices || 0) + 
                         (selectedOrgProfile.counts?.mdm?.apple?.devices || 0) + 
                         (selectedOrgProfile.counts?.mdm?.windows?.devices || 0), 
                  limit: selectedOrgProfile.limits?.mdmDevices || 0 
							  },
							  { 
							    label: 'Assets storage', 
									// Pulling the real storage decimals and limits!
                  usage: selectedOrgProfile.counts?.mdm?.assets?.storage || 0, 
                  limit: selectedOrgProfile.limits?.mdmAssetsStorageSize || 0,
							    isStorage: true 
							  },
							].map((item) => {
							  // Dynamic calculation based on API limits
							  const usageNum = parseFloat(item.usage) || 0;
								const limitNum = parseFloat(item.limit) || 0;
								const pct = limitNum > 0 ? Math.min((usageNum / limitNum) * 100, 100) : 0;
  
							  return (
							    <div key={item.label} className="space-y-2">
							      <div className="flex justify-between items-baseline">
							        <span className="text-sm font-semibold" style={{ color: activeTheme.text }}>{item.label}</span>
							        <span className="text-sm font-bold" style={{ color: activeTheme.text }}>
							          {item.usage} {item.isStorage && 'GB'} <span className="text-xs font-medium opacity-40">of {item.limit} {item.isStorage && 'GB'}</span>
							        </span>
							      </div>
							      <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: isDark ? '#1F2937' : '#E5E7EB' }}>
							        <div 
							          className="h-full bg-blue-600 rounded-full transition-all duration-500" 
							          style={{ width: `${pct}%` }} 
							        />
							      </div>
							    </div>
							  );
							})}
                </div>
              </div>

              {selectedOrgProfile.mdmInfo && (
                <div className="mb-10">
                  <h3 className="text-[11px] font-bold uppercase tracking-widest mb-6" style={{ color: activeTheme.textMuted }}>UEM Ecosystem & Policies</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                     <div className="p-4 rounded-xl border" style={{ backgroundColor: activeTheme.bg, borderColor: activeTheme.border }}>
                       <div className="flex items-center gap-2 mb-3"><OsIcon platform="apple" size={16} color={getAppleColor(isDark)} isDarkMode={isDark}/><span className="text-sm font-bold" style={{ color: activeTheme.text }}>Apple</span></div>
                       <div className="text-[11px] space-y-1.5" style={{ color: activeTheme.textMuted }}>
                         <div className="flex justify-between"><span>Devices</span><span className="font-bold" style={{ color: activeTheme.text }}>{selectedOrgProfile.mdmInfo.apple?.devices || 0}</span></div>
                         <div className="flex justify-between"><span>Enrollments</span><span className="font-bold" style={{ color: activeTheme.text }}>{selectedOrgProfile.mdmInfo.apple?.enrollments || 0}</span></div>
                         <div className="flex justify-between"><span>Profiles</span><span className="font-bold" style={{ color: activeTheme.text }}>{selectedOrgProfile.mdmInfo.apple?.profiles || 0}</span></div>
                         <div className="flex justify-between"><span>Policies</span><span className="font-bold" style={{ color: activeTheme.text }}>{selectedOrgProfile.mdmInfo.apple?.policies || 0}</span></div>
                         <div className="flex justify-between"><span>VPP Apps</span><span className="font-bold" style={{ color: activeTheme.text }}>{selectedOrgProfile.mdmInfo.apple?.applications || 0}</span></div>
                       </div>
                     </div>
                     <div className="p-4 rounded-xl border" style={{ backgroundColor: activeTheme.bg, borderColor: activeTheme.border }}>
                       <div className="flex items-center gap-2 mb-3"><OsIcon platform="android" size={16} color={OFFICIAL_OS_COLORS.android}/><span className="text-sm font-bold" style={{ color: activeTheme.text }}>Android</span></div>
                       <div className="text-[11px] space-y-1.5" style={{ color: activeTheme.textMuted }}>
                         <div className="flex justify-between"><span>Devices</span><span className="font-bold" style={{ color: activeTheme.text }}>{selectedOrgProfile.mdmInfo.android?.devices || 0}</span></div>
                         <div className="flex justify-between"><span>Tokens</span><span className="font-bold" style={{ color: activeTheme.text }}>{selectedOrgProfile.mdmInfo.android?.pendingEnrollmentTokens || 0}</span></div>
                         <div className="flex justify-between"><span>Policies</span><span className="font-bold" style={{ color: activeTheme.text }}>{selectedOrgProfile.mdmInfo.android?.policies || 0}</span></div>
                       </div>
                     </div>
                     <div className="p-4 rounded-xl border" style={{ backgroundColor: activeTheme.bg, borderColor: activeTheme.border }}>
                       <div className="flex items-center gap-2 mb-3"><OsIcon platform="windows" size={16} color={OFFICIAL_OS_COLORS.windows}/><span className="text-sm font-bold" style={{ color: activeTheme.text }}>Windows</span></div>
                       <div className="text-[11px] space-y-1.5" style={{ color: activeTheme.textMuted }}>
                         <div className="flex justify-between"><span>Devices</span><span className="font-bold" style={{ color: activeTheme.text }}>{selectedOrgProfile.mdmInfo.windows?.devices || 0}</span></div>
                         <div className="flex justify-between"><span>Tokens</span><span className="font-bold" style={{ color: activeTheme.text }}>{selectedOrgProfile.mdmInfo.windows?.pendingEnrollmentTokens || 0}</span></div>
                         <div className="flex justify-between"><span>Policies</span><span className="font-bold" style={{ color: activeTheme.text }}>{selectedOrgProfile.mdmInfo.windows?.policies || 0}</span></div>
                       </div>
                     </div>
                     <div className="flex flex-col gap-4">
                       <div className="p-4 rounded-xl border flex-1" style={{ backgroundColor: activeTheme.bg, borderColor: activeTheme.border }}>
                         <div className="flex items-center gap-2 mb-3"><Briefcase size={16} style={{ color: PRIMARY_BLUE }}/><span className="text-sm font-bold" style={{ color: activeTheme.text }}>Assets</span></div>
                         <div className="text-[11px] space-y-1.5" style={{ color: activeTheme.textMuted }}>
                           <div className="flex justify-between"><span>Enterprise Apps</span><span className="font-bold" style={{ color: activeTheme.text }}>{selectedOrgProfile.mdmInfo.assets?.apps || 0}</span></div>
                           <div className="flex justify-between"><span>Scripts</span><span className="font-bold" style={{ color: activeTheme.text }}>{selectedOrgProfile.mdmInfo.assets?.scripts || 0}</span></div>
                           <div className="flex justify-between"><span>Certificates</span><span className="font-bold" style={{ color: activeTheme.text }}>{selectedOrgProfile.mdmInfo.assets?.certificates || 0}</span></div>
                         </div>
                       </div>
                       <div className="p-4 rounded-xl border" style={{ backgroundColor: `10`, borderColor: activeTheme.border }}>
                         <div className="flex items-center justify-between">
                           <div className="flex items-center gap-2"><Users size={16} style={{ color: SUCCESS }}/><span className="text-sm font-bold" style={{ color: activeTheme.text }}>Users</span></div>
                           <span className="text-sm font-black" style={{ color: activeTheme.text }}>{selectedOrgProfile.mdmInfo.users || 0}</span>
                         </div>
                       </div>
                     </div>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-10 border-t pt-8" style={{ borderColor: activeTheme.border }}>
                {/* Active Privileges */}
                <div className="space-y-4">
                   <h3 className="text-[10px] font-bold uppercase tracking-widest" style={{ color: activeTheme.textMuted }}>Platform Privileges</h3>
                   <div className="flex flex-wrap gap-2">
                      {selectedOrgProfile.allows?.ssoLogin && <span className="px-2 py-1 text-[9px] font-bold rounded bg-purple-500/15 text-purple-500 uppercase">SSO Login</span>}
                      {selectedOrgProfile.allows?.customBranding && <span className="px-2 py-1 text-[9px] font-bold rounded bg-blue-500/15 text-blue-500 uppercase">Custom Branding</span>}
                      {selectedOrgProfile.allows?.androidAgent && <span className="px-2 py-1 text-[9px] font-bold rounded bg-green-500/15 text-green-500 uppercase">Android Agent</span>}
                      {selectedOrgProfile.allows?.iosAgent && <span className="px-2 py-1 text-[9px] font-bold rounded bg-slate-500/15 text-slate-500 uppercase">iOS Agent</span>}
                   </div>
                </div>

                {/* Contact Details */}
                <div className="space-y-4">
                  <h3 className="text-[10px] font-bold uppercase tracking-widest" style={{ color: activeTheme.textMuted }}>Contact Details</h3>
                  <div className="space-y-2">
                    <div className="flex justify-between items-center"><span className="text-xs" style={{ color: activeTheme.textMuted }}>Email</span><span className="text-xs font-medium" style={{ color: activeTheme.text }}>{selectedOrgProfile.contactInfo?.email || '—'}</span></div>
                    <div className="flex justify-between items-center"><span className="text-xs" style={{ color: activeTheme.textMuted }}>Support Phone</span><span className="text-xs font-medium" style={{ color: activeTheme.text }}>{selectedOrgProfile.contactInfo?.phoneNumber || '—'}</span></div>
                  </div>
                </div>
              </div>
            </div>
            
            <div className="p-6 border-t shrink-0 flex justify-center bg-gray-50/50 dark:bg-gray-900/50" style={{ borderColor: activeTheme.border }}>
               <p className="text-[10px] font-medium uppercase tracking-widest opacity-40">Workspace ID: {selectedOrgProfile.id}</p>
            </div>
          </div>
        </div>
      )}

      {/* Builder panel — always rendered so CSS transition works; hidden via translateX */}
      {editingWidget && (
        <>
          {/* Transparent click-off layer — no blur, no dark tint */}
          {isBuilderOpen && (
            <div
              className="fixed inset-0 z-[108]"
              onClick={() => setIsBuilderOpen(false)}
            />
          )}
          {/* Sliding panel from left — full height, matches segment panel animation */}
          <div
            className="fixed top-0 bottom-0 z-[109] flex flex-col shadow-2xl border-r transition-transform duration-300"
            style={{
              left: '0px',
              width: '400px',
              backgroundColor: activeTheme.card,
              borderColor: activeTheme.border,
              transform: isBuilderOpen ? 'translateX(0)' : 'translateX(-100%)',
            }}
          >
            {/* Panel Header */}
            <div className="flex items-center justify-between px-6 py-5 border-b shrink-0" style={{ borderColor: activeTheme.border }}>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${PRIMARY_BLUE}15`, color: PRIMARY_BLUE }}>
                  {editingWidget.id ? <Edit3 size={16} /> : <Plus size={16} />}
                </div>
                <h2 className="text-base font-bold" style={{ color: activeTheme.text }}>
                  {editingWidget.id ? 'Edit Widget' : 'Add Widget'}
                </h2>
              </div>
              <button
                onClick={() => setIsBuilderOpen(false)}
                className="w-8 h-8 flex items-center justify-center rounded-full transition-colors hover:opacity-70"
                style={{ color: activeTheme.textMuted, backgroundColor: `${activeTheme.textMuted}12` }}
              >
                <X size={15} />
              </button>
            </div>

            {/* Panel Content */}
            <div className="flex-1 overflow-y-auto custom-scrollbar">
              <div className="p-6 flex flex-col gap-7">
                {/* Widget Title */}
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest mb-2.5 block" style={{ color: activeTheme.textMuted }}>Widget Title</label>
                  <input
                    type="text"
                    value={editingWidget.title}
                    onChange={e => setEditingWidget({...editingWidget, title: e.target.value})}
                    className="w-full rounded-xl px-4 py-3 outline-none text-sm border focus:border-blue-500 transition-colors focus:ring-2 focus:ring-brand-500"
                    style={{ backgroundColor: activeTheme.bg, color: activeTheme.text, borderColor: activeTheme.border }}
                    placeholder="e.g. Current Fleet Status"
                  />
                </div>

                {/* Data Source */}
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest mb-2.5 block" style={{ color: activeTheme.textMuted }}>Data Source</label>
                  <div className="relative">
                    <div
                      onClick={() => setIsSourceDropdownOpen(!isSourceDropdownOpen)}
                      className="w-full rounded-xl px-4 py-3 flex justify-between items-center border cursor-pointer transition-colors"
                      style={{ backgroundColor: activeTheme.bg, borderColor: activeTheme.border }}
                    >
                      <span className="text-sm font-medium" style={{ color: activeTheme.text }}>
                        {CATALOG.flatMap(g => g.items).find(i => i.stat === editingWidget.stat)?.label || 'Select a metric...'}
                      </span>
                      <ChevronDown size={16} style={{ color: activeTheme.textMuted }} />
                    </div>
                    {isSourceDropdownOpen && (
                      <div className="absolute top-full left-0 w-full mt-2 rounded-xl shadow-xl border z-50 overflow-y-auto max-h-64 custom-scrollbar" style={{ backgroundColor: activeTheme.card, borderColor: activeTheme.border }}>
                        {CATALOG.map(group => (
                          <div key={group.group}>
                            {group.group && <div className="px-4 py-2 mt-2 text-[10px] font-bold uppercase tracking-widest" style={{ color: activeTheme.textMuted }}>{group.group}</div>}
                            {group.items.map(item => (
                              <button key={item.stat} onClick={() => selectSource(item)} className="w-full text-left px-5 py-2.5 text-sm hover:bg-black/5 dark:hover:bg-white/5 transition-colors flex items-center gap-3" style={{ color: editingWidget.stat === item.stat ? PRIMARY_BLUE : activeTheme.text }}>
                                <item.icon size={15} /> {item.label}
                              </button>
                            ))}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Filters */}
                {(editingWidget.stat === 'mdm_devices' || editingWidget.stat === 'app_dist_apps' || editingWidget.stat === 'app_dist_collaborators' || editingWidget.stat === 'mdm_collaborators' || editingWidget.stat === 'app_dist_store_users') && (
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-widest mb-2.5 block" style={{ color: activeTheme.textMuted }}>Filters</label>
                    <div className="p-4 rounded-xl border flex flex-col gap-4" style={{ backgroundColor: activeTheme.bg, borderColor: activeTheme.border }}>
                      {(editingWidget.stat === 'mdm_devices' || editingWidget.stat === 'app_dist_apps') && (
                        <div>
                          <label className="block text-xs font-medium mb-2" style={{ color: activeTheme.textMuted }}>{editingWidget.stat === 'mdm_devices' ? 'Operating System' : 'Target OS'}</label>
                          <select value={editingWidget.filters.type || 'all'} onChange={e => updateFilter('type', e.target.value)} className="w-full rounded-lg px-3 py-2.5 text-sm outline-none border focus:border-blue-500 transition-colors focus:ring-2 focus:ring-brand-500" style={{ backgroundColor: activeTheme.card, color: activeTheme.text, borderColor: activeTheme.border }}>
                            <option value="all">All OS</option><option value="apple">iOS / iPadOS</option><option value="macos">macOS</option><option value="android">Android</option><option value="windows">Windows</option>
                          </select>
                        </div>
                      )}
                      {editingWidget.stat === 'mdm_devices' && (
                        <>
                          <div>
                            <label className="block text-xs font-medium mb-2" style={{ color: activeTheme.textMuted }}>Compliance Status</label>
                            <select value={editingWidget.filters.complianceStatus || 'all'} onChange={e => updateFilter('complianceStatus', e.target.value)} className="w-full rounded-lg px-3 py-2.5 text-sm outline-none border focus:border-blue-500 transition-colors focus:ring-2 focus:ring-brand-500" style={{ backgroundColor: activeTheme.card, color: activeTheme.text, borderColor: activeTheme.border }}>
                              <option value="all">All devices</option><option value="compliant">Compliant only</option><option value="non_compliant">Non-compliant only</option>
                            </select>
                          </div>
                          <label className="flex items-center gap-3 cursor-pointer">
                            <input type="checkbox" checked={editingWidget.filters.inactive24h || false} onChange={e => updateFilter('inactive24h', e.target.checked)} className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                            <span className="text-sm font-medium" style={{ color: activeTheme.text }}>Not reported in last 24h</span>
                          </label>
                        </>
                      )}
                      {editingWidget.stat === 'app_dist_collaborators' && (
                        <div>
                          <label className="block text-xs font-medium mb-2" style={{ color: activeTheme.textMuted }}>Role</label>
                          <select value={editingWidget.filters.role || 'all'} onChange={e => updateFilter('role', e.target.value)} className="w-full rounded-lg px-3 py-2.5 text-sm outline-none border focus:border-blue-500 transition-colors focus:ring-2 focus:ring-brand-500" style={{ backgroundColor: activeTheme.card, color: activeTheme.text, borderColor: activeTheme.border }}>
                            <option value="all">All roles</option><option value="owner">Owner</option><option value="admin">Admin</option><option value="editor">Editor</option><option value="viewer">Viewer</option>
                          </select>
                        </div>
                      )}
                      {(editingWidget.stat === 'app_dist_collaborators' || editingWidget.stat === 'mdm_collaborators' || editingWidget.stat === 'app_dist_store_users') && (
                        <div>
                          <label className="block text-xs font-medium mb-2" style={{ color: activeTheme.textMuted }}>Authentication Origin</label>
                          <select value={editingWidget.filters.authOrigin || 'all'} onChange={e => updateFilter('authOrigin', e.target.value)} className="w-full rounded-lg px-3 py-2.5 text-sm outline-none border focus:border-blue-500 transition-colors focus:ring-2 focus:ring-brand-500" style={{ backgroundColor: activeTheme.card, color: activeTheme.text, borderColor: activeTheme.border }}>
                            <option value="all">All origins</option><option value="dashboard">Dashboard</option><option value="sso">SSO</option>
                          </select>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Visual Style */}
                {editingWidget.stat && (
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-widest mb-2.5 block" style={{ color: activeTheme.textMuted }}>Visual Style</label>
                    <div className="grid grid-cols-2 gap-2.5">
                      {ALL_CHART_TYPES.filter(t => SHAPES[SOURCE_SHAPES[editingWidget.stat] || 'listCountOnly'].includes(t.id)).map(type => {
                        const isSelected = editingWidget.type === type.id;
                        return (
                          <button key={type.id} onClick={() => setEditingWidget({...editingWidget, type: type.id})} className="flex flex-col items-center justify-center p-3.5 rounded-xl border text-left transition-all" style={{ backgroundColor: isSelected ? `${PRIMARY_BLUE}12` : activeTheme.bg, borderColor: isSelected ? PRIMARY_BLUE : activeTheme.border }}>
                            <div style={{ color: isSelected ? PRIMARY_BLUE : activeTheme.textMuted }}>{type.icon}</div>
                            <div className="font-semibold text-[12px] mt-2" style={{ color: isSelected ? PRIMARY_BLUE : activeTheme.text }}>{type.label}</div>
                            <div className="text-[10px] leading-tight mt-0.5 text-center" style={{ color: activeTheme.textMuted }}>{type.desc}</div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Card Size */}
                {editingWidget.stat && (
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-widest mb-2.5 block" style={{ color: activeTheme.textMuted }}>Card Size</label>
                    <div className="flex gap-2.5">
                      {SIZES.map(size => {
                        const isSelected = editingWidget.size === size.id;
                        // Visual block proportional to actual grid width
                        const blockW = size.id === 'small' ? 24 : size.id === 'half' ? 44 : 80;
                        const blockH = size.id === 'small' ? 16 : 22;
                        return (
                          <button key={size.id} onClick={() => setEditingWidget({...editingWidget, size: size.id})}
                            className="flex-1 py-3 rounded-xl border transition-all flex flex-col items-center justify-center gap-1.5"
                            style={{ backgroundColor: isSelected ? `${PRIMARY_BLUE}12` : activeTheme.bg, borderColor: isSelected ? PRIMARY_BLUE : activeTheme.border }}>
                            {/* Visual size preview */}
                            <div className="rounded-[3px]" style={{
                              width: blockW, height: blockH,
                              backgroundColor: isSelected ? PRIMARY_BLUE : activeTheme.textMuted,
                              opacity: isSelected ? 0.7 : 0.25,
                            }} />
                            <span className="font-semibold text-[12px]" style={{ color: isSelected ? PRIMARY_BLUE : activeTheme.text }}>{size.label}</span>
                            <span className="text-[10px]" style={{ color: activeTheme.textMuted }}>{size.desc}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Panel Footer */}
            <div className="px-6 py-4 border-t flex justify-between gap-3 shrink-0" style={{ borderColor: activeTheme.border, backgroundColor: activeTheme.card }}>
              <button
                onClick={() => setIsBuilderOpen(false)}
                className="px-5 py-2.5 rounded-xl text-sm font-medium transition-colors hover:opacity-70"
                style={{ color: activeTheme.textMuted, border: `1px solid ${activeTheme.border}` }}
              >
                Cancel
              </button>
              <button
                onClick={saveWidgetForm}
                disabled={!editingWidget.stat}
                className="flex-1 py-2.5 rounded-xl font-semibold text-sm text-white transition-colors disabled:opacity-40"
                style={{ backgroundColor: PRIMARY_BLUE }}
              >
                {editingWidget.id ? 'Save Changes' : 'Add Widget'}
              </button>
            </div>
          </div>
        </>
      )}
			{isSettingsModalOpen && (
			        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
			          <div className="w-full max-w-5xl rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden" style={{ backgroundColor: activeTheme.card, border: `1px solid ${activeTheme.border}` }}>
            
			            {/* HEADER */}
			            <div className="flex justify-between items-center p-6 border-b shrink-0" style={{ borderColor: activeTheme.border }}>
			              <div className="flex items-center gap-2">
			                <h2 className="text-xl font-bold flex items-center gap-2" style={{ color: activeTheme.text }}><Settings className="text-[#0055FF]" size={20}/> Platform Settings</h2>
			                <HelpIcon slug="settings" anchor={SETTINGS_TAB_ANCHORS[settingsTab]} theme={activeTheme} title="Settings admin guide" />
			              </div>
			              <button onClick={() => setIsSettingsModalOpen(false)} className="hover:text-red-500 transition-colors" style={{ color: activeTheme.textMuted }}><X size={20} /></button>
			            </div>

			            {/* BODY: left-nav categories + single content pane. Was a fixed
			                two-column grid that got unbalanced and cramped once this grew
			                past ~5 sections (right column ran nearly 2x the left column's
			                height, and code blocks like the webhook URL overflowed their
			                card). One full-width pane per category scales indefinitely. */}
			            <div className="flex flex-1 overflow-hidden">
			              <div className="w-56 shrink-0 border-r overflow-y-auto custom-scrollbar p-3 space-y-1" style={{ borderColor: activeTheme.border, backgroundColor: isDark ? 'rgba(0,0,0,0.25)' : 'rgba(0,0,0,0.03)' }}>
			                {SETTINGS_TABS.filter(tab => !tab.superAdminOnly || isSuperAdmin).map(tab => {
			                  const isTabActive = settingsTab === tab.id;
			                  const TabIcon = tab.Icon;
			                  return (
			                    <button
			                      key={tab.id}
			                      type="button"
			                      onClick={() => setSettingsTab(tab.id)}
			                      className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left text-[13px] transition-colors"
			                      style={{ backgroundColor: isTabActive ? '#0055FF18' : 'transparent', color: isTabActive ? '#0055FF' : activeTheme.textMuted, fontWeight: isTabActive ? 600 : 500 }}
			                    >
			                      <TabIcon size={15} className="shrink-0" />
			                      <span className="truncate">{tab.label}</span>
			                    </button>
			                  );
			                })}
			              </div>

			              <div className="flex-1 min-w-0 overflow-y-auto custom-scrollbar p-8" style={{ backgroundColor: isDark ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.02)' }}>

			                {settingsTab === 'general' && (
			                  <div>
			                    <h3 className="text-sm font-bold mb-4" style={{ color: activeTheme.text }}>General Configuration</h3>
			                    <div className="space-y-4 p-5 rounded-xl border shadow-sm" style={{ backgroundColor: activeTheme.card, borderColor: activeTheme.border }}>
			                      <div>
			                        <label className="block text-xs font-medium mb-1.5" style={{ color: activeTheme.textMuted }}>Notifications Webhook URL</label>
			                        <input type="text" value={webhookUrl} onChange={e => setWebhookUrl(e.target.value)} placeholder="https://chat.googleapis.com/v1/spaces/..." className="w-full rounded-lg px-4 py-2.5 outline-none text-sm border focus:border-blue-500 transition-colors focus:ring-2 focus:ring-brand-500" style={{ backgroundColor: activeTheme.bg, color: activeTheme.text, borderColor: activeTheme.border }} />
			                      </div>
			                      <div>
			                        <label className="block text-xs font-medium mb-1.5" style={{ color: activeTheme.textMuted }}>System Timezone (for Scheduled Reports)</label>
			                        <select value={userTimezone} onChange={e => setUserTimezone(e.target.value)} className="w-full rounded-lg px-4 py-2.5 outline-none text-sm border focus:border-blue-500 transition-colors cursor-pointer focus:ring-2 focus:ring-brand-500" style={{ backgroundColor: activeTheme.bg, color: activeTheme.text, borderColor: activeTheme.border }}>
			                           {(Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : [userTimezone, 'UTC']).map(tz => <option key={tz} value={tz}>{tz}</option>)}
			                        </select>
			                      </div>
			                      <div>
			                        <label className="block text-xs font-medium mb-1.5" style={{ color: activeTheme.textMuted }}>Idle Session Timeout</label>
			                        <select value={sessionTimeoutMinutes} onChange={e => setSessionTimeoutMinutes(Number(e.target.value))} className="w-full rounded-lg px-4 py-2.5 outline-none text-sm border focus:border-blue-500 transition-colors cursor-pointer focus:ring-2 focus:ring-brand-500" style={{ backgroundColor: activeTheme.bg, color: activeTheme.text, borderColor: activeTheme.border }}>
			                          <option value={30}>30 minutes</option>
			                          <option value={60}>60 minutes</option>
			                          <option value={90}>90 minutes</option>
			                          <option value={120}>2 hours</option>
			                          <option value={240}>4 hours</option>
			                          <option value={480}>8 hours</option>
			                        </select>
			                        <p className="text-[11px] mt-1.5 leading-relaxed" style={{ color: activeTheme.textMuted }}>Signs everyone out automatically after this much inactivity.</p>
			                      </div>
			                    </div>
			                  </div>
			                )}

			                {settingsTab === 'smtp' && (
			                  <div>
			                    <h3 className="text-sm font-bold mb-4" style={{ color: activeTheme.text }}>SMTP Email Engine</h3>
			                    <div className="space-y-4 p-5 rounded-xl border shadow-sm max-w-xl" style={{ backgroundColor: activeTheme.card, borderColor: activeTheme.border }}>
			                      <div className="flex gap-3">
			                        <div className="flex-1">
			                          <label className="block text-[10px] font-medium mb-1.5" style={{ color: activeTheme.textMuted }}>SMTP Host</label>
			                          <input type="text" value={smtpConfig.host} onChange={e => setSmtpConfig({...smtpConfig, host: e.target.value})} placeholder="smtp.example.com" className="w-full rounded-lg px-3 py-2.5 outline-none text-xs border focus:border-blue-500 transition-colors focus:ring-2 focus:ring-brand-500" style={{ backgroundColor: activeTheme.bg, color: activeTheme.text, borderColor: activeTheme.border }} />
			                        </div>
			                        <div className="w-24">
			                          <label className="block text-[10px] font-medium mb-1.5" style={{ color: activeTheme.textMuted }}>Port</label>
			                          <input type="text" value={smtpConfig.port} onChange={e => setSmtpConfig({...smtpConfig, port: e.target.value})} placeholder="587" className="w-full rounded-lg px-3 py-2.5 outline-none text-xs border focus:border-blue-500 transition-colors focus:ring-2 focus:ring-brand-500" style={{ backgroundColor: activeTheme.bg, color: activeTheme.text, borderColor: activeTheme.border }} />
			                        </div>
			                      </div>
			                      <div className="flex gap-3">
			                        <div className="flex-1">
			                          <label className="block text-[10px] font-medium mb-1.5" style={{ color: activeTheme.textMuted }}>Username</label>
			                          <input type="text" value={smtpConfig.user} onChange={e => setSmtpConfig({...smtpConfig, user: e.target.value})} placeholder="user@example.com" className="w-full rounded-lg px-3 py-2.5 outline-none text-xs border focus:border-blue-500 transition-colors focus:ring-2 focus:ring-brand-500" style={{ backgroundColor: activeTheme.bg, color: activeTheme.text, borderColor: activeTheme.border }} />
			                        </div>
			                        <div className="flex-1">
			                          <label className="block text-[10px] font-medium mb-1.5" style={{ color: activeTheme.textMuted }}>Password</label>
			                          <input type="password" value={smtpConfig.pass} onChange={e => setSmtpConfig({...smtpConfig, pass: e.target.value})} className="w-full rounded-lg px-3 py-2.5 outline-none text-xs border focus:border-blue-500 transition-colors focus:ring-2 focus:ring-brand-500" style={{ backgroundColor: activeTheme.bg, color: activeTheme.text, borderColor: activeTheme.border }} />
			                        </div>
			                      </div>
			                      <div>
			                        <label className="block text-[10px] font-medium mb-1.5" style={{ color: activeTheme.textMuted }}>From Address</label>
			                        <input type="text" value={smtpConfig.from} onChange={e => setSmtpConfig({...smtpConfig, from: e.target.value})} placeholder="reports@applivery.com" className="w-full rounded-lg px-3 py-2.5 outline-none text-xs border focus:border-blue-500 transition-colors focus:ring-2 focus:ring-brand-500" style={{ backgroundColor: activeTheme.bg, color: activeTheme.text, borderColor: activeTheme.border }} />
			                      </div>
			                      <div>
			                        <label className="block text-[10px] font-medium mb-1.5" style={{ color: activeTheme.textMuted }}>Alert Email Recipients</label>
			                        <input type="text" value={smtpConfig.alertRecipients || ''} onChange={e => setSmtpConfig({...smtpConfig, alertRecipients: e.target.value})} placeholder="oncall@company.com, secops@company.com" className="w-full rounded-lg px-3 py-2.5 outline-none text-xs border focus:border-blue-500 transition-colors focus:ring-2 focus:ring-brand-500" style={{ backgroundColor: activeTheme.bg, color: activeTheme.text, borderColor: activeTheme.border }} />
			                        <p className="text-[10px] mt-1.5" style={{ color: activeTheme.textMuted }}>Comma-separated. Gets a one-off email for Case SLA breaches and System Health failures/recoveries — separate from the report delivery list above, since who gets paged at 3am is often a different list than who gets the weekly PDF.</p>
			                      </div>
			                      <div className="flex justify-end pt-1">
			                         <button type="button" onClick={handleTestSMTP} className="px-5 py-2.5 rounded-lg text-xs font-bold transition-colors border hover:bg-black/5 dark:hover:bg-white/5 flex items-center gap-2" style={{ borderColor: activeTheme.border, color: activeTheme.text }}>
			                           <Mail size={14} className="text-blue-500" /> Send Test Email
			                         </button>
			                      </div>
			                    </div>
			                  </div>
			                )}

			                {settingsTab === 'account' && (
			                  <div>
			                    <h3 className="text-sm font-bold mb-4" style={{ color: activeTheme.text }}>Account</h3>
			                    <div className="space-y-4 p-5 rounded-xl border shadow-sm max-w-xl" style={{ backgroundColor: activeTheme.card, borderColor: activeTheme.border }}>
			                      <div className="flex items-center gap-3">
			                        <div className="shrink-0 w-10 h-10 rounded-full overflow-hidden flex items-center justify-center text-white text-sm font-bold uppercase" style={{ backgroundColor: '#0241E2' }}>
			                          {currentUser?.picture ? <img src={currentUser.picture} alt="" className="w-full h-full object-cover" /> : userInitials}
			                        </div>
			                        <div className="min-w-0">
			                          <p className="text-sm font-semibold truncate" style={{ color: activeTheme.text }}>{userDisplayName}</p>
			                          <p className="text-xs truncate" style={{ color: activeTheme.textMuted }}>{currentUser?.email || ''}</p>
			                        </div>
			                      </div>

			                      <div>
			                        <label className="block text-[10px] font-medium mb-1.5" style={{ color: activeTheme.textMuted }}>Workspace</label>
			                        {organizations.length > 1 ? (
			                          <select
			                            value={orgSlug}
			                            onChange={e => handleSwitchOrganization(e.target.value)}
			                            className="w-full rounded-lg px-3 py-2.5 outline-none text-xs border focus:border-blue-500 transition-colors cursor-pointer focus:ring-2 focus:ring-brand-500"
			                            style={{ backgroundColor: activeTheme.bg, color: activeTheme.text, borderColor: activeTheme.border }}
			                          >
			                            {organizations.map(org => <option key={org.id} value={org.slug}>{org.name}</option>)}
			                          </select>
			                        ) : (
			                          <div className="w-full rounded-lg px-3 py-2.5 text-xs border" style={{ backgroundColor: activeTheme.bg, color: activeTheme.textMuted, borderColor: activeTheme.border }}>
			                            {orgSlug}
			                          </div>
			                        )}
			                      </div>

			                      <div className="flex justify-end pt-1">
			                        <button type="button" onClick={handleLogout} className="px-5 py-2.5 rounded-lg text-xs font-bold transition-colors border hover:bg-red-500/10 hover:border-red-500 hover:text-red-500 flex items-center gap-2" style={{ borderColor: activeTheme.border, color: activeTheme.text }}>
			                          <LogOut size={14} /> Sign out
			                        </button>
			                      </div>
			                    </div>
			                  </div>
			                )}

			                {settingsTab === 'backup' && (
			                  <div>
			                    <h3 className="text-sm font-bold mb-4" style={{ color: activeTheme.text }}>Backup & Restore</h3>
			                    <p className="text-[11px] mb-2" style={{ color: activeTheme.textMuted }}>Dashboard layout only (widgets, webhook URL, SMTP settings) — not Policies, Workflows, or other workspace config. See "Full Workspace Configuration" below for that.</p>
			                    <div className="flex gap-4 p-5 rounded-xl border shadow-sm max-w-xl mb-6" style={{ backgroundColor: activeTheme.card, borderColor: activeTheme.border }}>
			                      <button onClick={exportDashboard} className="flex-1 flex items-center justify-center gap-2 py-3 rounded-lg border text-sm font-medium transition-colors hover:bg-blue-500/10 hover:border-blue-500 hover:text-blue-500" style={{ borderColor: activeTheme.border, color: activeTheme.text }}>
			                        <Download size={16} /> Export JSON
			                      </button>
			                      <label className="flex-1 flex items-center justify-center gap-2 py-3 rounded-lg border text-sm font-medium cursor-pointer transition-colors hover:bg-blue-500/10 hover:border-blue-500 hover:text-blue-500" style={{ borderColor: activeTheme.border, color: activeTheme.text }}>
			                        <Upload size={16} /> Import JSON
			                        <input type="file" accept=".json" onChange={importDashboard} className="hidden" />
			                      </label>
			                    </div>

			                    <h3 className="text-sm font-bold mb-2" style={{ color: activeTheme.text }}>Full Workspace Configuration</h3>
			                    <p className="text-[11px] mb-2 leading-relaxed" style={{ color: activeTheme.textMuted }}>
			                      Compliance Policies, Workflows, Triggers, Integrations, Case Auto-Run Rules, Case SLA thresholds, Threat Intel providers, the Applivery inbound webhook config, the Action Library, App Lists, the Script Library, and dashboard settings — everything configured for the <strong>{orgSlug}</strong> workspace, bundled into one file. Use this for disaster recovery or to migrate a workspace's configuration to another deployment.
			                    </p>
			                    <p className="text-[11px] mb-4 font-medium" style={{ color: '#EF4444' }}>
			                      This file contains every credential configured for this workspace — Jira/ServiceNow, PagerDuty/Opsgenie, chat webhook URLs, Threat Intel API keys, and the SMTP password are encrypted at rest and stay encrypted in this export; the Applivery webhook secret is not. Store and share it the same way you'd handle any other credential bundle.
			                    </p>
			                    {!canManageWorkspaceConfig && (
			                      <div className="flex items-start gap-2 px-3 py-2 rounded-lg text-xs mb-4 max-w-xl" style={{ backgroundColor: '#F59E0B12', border: '1px solid #F59E0B30', color: '#B45309' }}>
			                        <ShieldAlert size={14} className="shrink-0 mt-0.5" /> Your role doesn't include the "export, import, or clone workspace configuration" permission — these actions are disabled.
			                      </div>
			                    )}
			                    <div className="p-5 rounded-xl border shadow-sm max-w-xl space-y-4" style={{ backgroundColor: activeTheme.card, borderColor: activeTheme.border, opacity: canManageWorkspaceConfig ? 1 : 0.6 }}>
			                      <div className="flex gap-4">
			                        <button onClick={handleExportWorkspaceConfig} disabled={configExporting || !canManageWorkspaceConfig} className="flex-1 flex items-center justify-center gap-2 py-3 rounded-lg border text-sm font-medium transition-colors hover:bg-blue-500/10 hover:border-blue-500 hover:text-blue-500 disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:border-current disabled:cursor-not-allowed" style={{ borderColor: activeTheme.border, color: activeTheme.text }}>
			                          <Download size={16} /> {configExporting ? 'Exporting…' : 'Export Configuration'}
			                        </button>
			                        <label className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-lg border text-sm font-medium transition-colors ${canManageWorkspaceConfig ? 'cursor-pointer hover:bg-blue-500/10 hover:border-blue-500 hover:text-blue-500' : 'cursor-not-allowed opacity-50'}`} style={{ borderColor: activeTheme.border, color: activeTheme.text }}>
			                          <Upload size={16} /> Choose Import File
			                          <input type="file" accept=".json" disabled={!canManageWorkspaceConfig} onChange={handleConfigImportFileChosen} className="hidden" />
			                        </label>
			                      </div>

			                      {canManageWorkspaceConfig && organizations.filter(o => o.slug !== orgSlug).length > 0 && (
			                        <button
			                          onClick={() => setIsOnboardingModalOpen(true)}
			                          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border text-xs font-medium transition-colors hover:bg-blue-500/10 hover:border-blue-500 hover:text-blue-500"
			                          style={{ borderColor: activeTheme.border, color: activeTheme.textMuted }}
			                        >
			                          <Copy size={14} /> Copy from another workspace instead
			                        </button>
			                      )}
			                      <p className="text-[10px] -mt-2" style={{ color: activeTheme.textMuted }}>
			                        Only works while this workspace ({orgSlug}) has no configuration yet — a one-time bootstrap, not a merge. If it already has config, use Export/Import above instead.
			                      </p>

			                      {configImportBundle && (
			                        <div className="pt-3" style={{ borderTop: `1px solid ${activeTheme.border}` }}>
			                          <p className="text-xs font-semibold mb-1" style={{ color: activeTheme.text }}>
			                            Bundle from workspace "{configImportBundle.workspaceSlug}" — exported {configImportBundle.exportedAt ? new Date(configImportBundle.exportedAt).toLocaleString() : 'unknown time'}
			                          </p>
			                          <p className="text-[11px] mb-3" style={{ color: activeTheme.textMuted }}>Select which items to import. Each selected item OVERWRITES the current one in this workspace ({orgSlug}) — this is a restore, not a merge.</p>
			                          <div className="space-y-1.5 max-h-56 overflow-y-auto">
			                            {Object.keys(configImportBundle.data).map(key => {
			                              const value = configImportBundle.data[key];
			                              const count = Array.isArray(value) ? value.length : (value && typeof value === 'object' ? Object.keys(value).length : 0);
			                              return (
			                                <label key={key} className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: activeTheme.text }}>
			                                  <input type="checkbox" checked={!!configImportSelected[key]} onChange={(e) => setConfigImportSelected(s => ({ ...s, [key]: e.target.checked }))} />
			                                  {CONFIG_STORE_LABELS[key] || key}
			                                  <span style={{ color: activeTheme.textMuted }}>({count})</span>
			                                </label>
			                              );
			                            })}
			                          </div>
			                          <div className="flex justify-end gap-2 mt-3">
			                            <button onClick={() => { setConfigImportBundle(null); setConfigImportSelected({}); }} className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ border: `1px solid ${activeTheme.border}`, color: activeTheme.text }}>Cancel</button>
			                            <button onClick={handleConfigImportConfirm} disabled={configImporting} className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-50">
			                              {configImporting ? 'Importing…' : 'Overwrite & Import'}
			                            </button>
			                          </div>
			                        </div>
			                      )}
			                    </div>
			                  </div>
			                )}

			                {settingsTab === 'audit' && (
			                  <div>
			                    <h3 className="text-sm font-bold mb-4" style={{ color: activeTheme.text }}>Audit Log Retention</h3>
			                    <div className="space-y-3 p-5 rounded-xl border shadow-sm max-w-xl" style={{ backgroundColor: activeTheme.card, borderColor: activeTheme.border }}>
			                      <div>
			                        <label className="block text-xs font-medium mb-1.5" style={{ color: activeTheme.textMuted }}>Keep audit log events for</label>
			                        <select
			                          value={auditLogRetentionDays}
			                          onChange={e => setAuditLogRetentionDays(Number(e.target.value))}
			                          className="w-full rounded-lg px-4 py-2.5 outline-none text-sm border focus:border-blue-500 transition-colors cursor-pointer focus:ring-2 focus:ring-brand-500"
			                          style={{ backgroundColor: activeTheme.bg, color: activeTheme.text, borderColor: activeTheme.border }}
			                        >
			                          <option value={30}>30 days</option>
			                          <option value={90}>90 days</option>
			                          <option value={180}>180 days</option>
			                          <option value={365}>365 days</option>
			                          <option value={0}>Forever</option>
			                        </select>
			                      </div>
			                      <p className="text-[11px] leading-relaxed" style={{ color: activeTheme.textMuted }}>
			                        Older events are rotated out once a day. Applies to every workspace's audit log — policy evaluation alerts and admin actions in the Audit Logs view.
			                      </p>
			                    </div>
			                  </div>
			                )}

			                {settingsTab === 'automation' && (
			                  <div>
			                    <h3 className="text-sm font-bold mb-4" style={{ color: activeTheme.text }}>Workspace Automation</h3>
			                    <div className="space-y-3 p-5 rounded-xl border shadow-sm max-w-xl" style={{ backgroundColor: activeTheme.card, borderColor: activeTheme.border }}>
			                      {automationCredentialStatus === null ? (
			                        <p className="text-xs" style={{ color: activeTheme.textMuted }}>Checking status…</p>
			                      ) : automationCredentialStatus.configured ? (
			                        <>
			                          <div className="flex items-center gap-2">
			                            <div className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
			                            <span className="text-xs font-semibold" style={{ color: activeTheme.text }}>
			                              Configured for <span className="font-mono">{orgSlug}</span>
			                            </span>
			                          </div>
			                          {automationCredentialStatus.source === 'stored' ? (
			                            <p className="text-[11px] leading-relaxed" style={{ color: activeTheme.textMuted }}>
			                              {automationCredentialStatus.configuredBy && <>Set by {automationCredentialStatus.configuredBy}. </>}
			                              Refreshes itself automatically — nothing to renew manually.
			                            </p>
			                          ) : (
			                            <p className="text-[11px] leading-relaxed" style={{ color: activeTheme.textMuted }}>
			                              Using the legacy AUTOMATION_ORG_SLUG/AUTOMATION_API_TOKEN environment variables for this workspace.
			                            </p>
			                          )}
			                          <div className="flex justify-end pt-1">
			                            <button type="button" disabled={automationCredentialBusy} onClick={handleClearAutomationCredential} className="px-4 py-2 rounded-lg text-xs font-bold transition-colors border hover:bg-red-500/10 hover:border-red-500 hover:text-red-500 disabled:opacity-50" style={{ borderColor: activeTheme.border, color: activeTheme.text }}>
			                              Remove
			                            </button>
			                          </div>
			                        </>
			                      ) : (
			                        <>
			                          <div className="flex items-center gap-2">
			                            <div className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
			                            <span className="text-xs font-semibold" style={{ color: activeTheme.text }}>Not configured for this workspace</span>
			                          </div>
			                          <p className="text-[11px] leading-relaxed" style={{ color: activeTheme.textMuted }}>
			                            Applivery tokens are scoped per workspace, so background jobs (compliance checks, snapshots, scheduled reports) need their own credential per workspace. Use this button while signed into <span className="font-mono">{orgSlug}</span> to designate it — it self-refreshes from then on.
			                          </p>
			                          <div className="flex justify-end pt-1">
			                            <button type="button" disabled={automationCredentialBusy} onClick={handleUseSessionForAutomation} className="px-5 py-2.5 rounded-lg text-xs font-bold transition-colors border hover:bg-blue-500/10 hover:border-blue-500 hover:text-blue-500 disabled:opacity-50 flex items-center gap-2" style={{ borderColor: activeTheme.border, color: activeTheme.text }}>
			                              <RefreshCw size={13} className={automationCredentialBusy ? 'animate-spin' : ''} /> Use this session for automation
			                            </button>
			                          </div>
			                        </>
			                      )}
			                    </div>
			                  </div>
			                )}

			                {settingsTab === 'webhook' && (
			                  <div>
			                    <h3 className="text-sm font-bold mb-4" style={{ color: activeTheme.text }}>Device Data Webhook</h3>
			                    <div className="space-y-3 p-5 rounded-xl border shadow-sm max-w-2xl" style={{ backgroundColor: activeTheme.card, borderColor: activeTheme.border }}>
			                      <p className="text-[11px] leading-relaxed" style={{ color: activeTheme.textMuted }}>
			                        Lets a scheduled script on a Windows or macOS device push extra attributes (disk encryption, firewall, patch status, anything) that aren't in Applivery's own data. Reports are matched to a device by serial number and become available to Compliance Policies as "Self-Reported Attribute" conditions.
			                      </p>

			                      {deviceReportSecretStatus === null ? (
			                        <p className="text-xs" style={{ color: activeTheme.textMuted }}>Checking status…</p>
			                      ) : (
			                        <>
			                          <div className="flex items-center gap-2">
			                            <div className={`w-2 h-2 rounded-full shrink-0 ${deviceReportSecretStatus.configured ? 'bg-emerald-500' : 'bg-amber-500'}`} />
			                            <span className="text-xs font-semibold" style={{ color: activeTheme.text }}>
			                              {deviceReportSecretStatus.configured ? <>Webhook active for <span className="font-mono">{orgSlug}</span></> : 'Not configured for this workspace'}
			                            </span>
			                          </div>

			                          {deviceReportSecretStatus.configured && (
			                            <div className="space-y-2">
			                              <div>
			                                <label className="block text-[10px] font-medium mb-1" style={{ color: activeTheme.textMuted }}>Webhook URL</label>
			                                <div className="flex items-center gap-1.5 min-w-0">
			                                  <code className="flex-1 min-w-0 px-2.5 py-2 rounded-lg text-[11px] font-mono overflow-x-auto whitespace-nowrap" style={{ backgroundColor: activeTheme.bg, color: activeTheme.text, border: `1px solid ${activeTheme.border}` }}>
			                                    POST {typeof window !== 'undefined' ? window.location.origin : ''}/api/device-data/report
			                                  </code>
			                                  <button type="button" onClick={() => navigator.clipboard.writeText(`${window.location.origin}/api/device-data/report`)} className="p-2 rounded-lg border shrink-0 hover:bg-blue-500/10 hover:border-blue-500 hover:text-blue-500" style={{ borderColor: activeTheme.border, color: activeTheme.textMuted }}>
			                                    <Copy size={12} />
			                                  </button>
			                                </div>
			                              </div>
			                              <div>
			                                <label className="block text-[10px] font-medium mb-1" style={{ color: activeTheme.textMuted }}>Headers</label>
			                                <code className="block px-2.5 py-2 rounded-lg text-[11px] font-mono leading-relaxed overflow-x-auto whitespace-pre" style={{ backgroundColor: activeTheme.bg, color: activeTheme.text, border: `1px solid ${activeTheme.border}` }}>
{`X-Workspace-Slug: ${orgSlug}
X-Device-Report-Secret: ${deviceReportSecretStatus.secret}`}
			                                  </code>
			                              </div>
			                              <div>
			                                <label className="block text-[10px] font-medium mb-1" style={{ color: activeTheme.textMuted }}>Example JSON body</label>
			                                <code className="block px-2.5 py-2 rounded-lg text-[11px] font-mono leading-relaxed overflow-x-auto whitespace-pre" style={{ backgroundColor: activeTheme.bg, color: activeTheme.text, border: `1px solid ${activeTheme.border}` }}>
{`{
  "platform": "windows",
  "serialNumber": "PF3ABCDE",
  "attributes": {
    "BitLockerStatus": true,
    "FirewallEnabled": true,
    "OsBuild": "22631.3527"
  }
}`}
			                                  </code>
			                              </div>
			                              <p className="text-[10px] leading-relaxed" style={{ color: activeTheme.textMuted }}>
			                                {deviceReportSecretStatus.rotatedBy && <>Last generated by {deviceReportSecretStatus.rotatedBy}. </>}
			                                Known key names (e.g. BitLockerStatus / FileVaultEnabled) are normalized to shared names so one policy condition covers both platforms — anything else passes through as-is under "attributes".
			                              </p>
			                            </div>
			                          )}

			                          <div className="flex justify-end gap-2 pt-1">
			                            {deviceReportSecretStatus.configured && (
			                              <button type="button" disabled={deviceReportSecretBusy} onClick={handleClearDeviceReportSecret} className="px-4 py-2 rounded-lg text-xs font-bold transition-colors border hover:bg-red-500/10 hover:border-red-500 hover:text-red-500 disabled:opacity-50" style={{ borderColor: activeTheme.border, color: activeTheme.text }}>
			                                Remove
			                              </button>
			                            )}
			                            <button type="button" disabled={deviceReportSecretBusy} onClick={handleRotateDeviceReportSecret} className="px-5 py-2.5 rounded-lg text-xs font-bold transition-colors border hover:bg-blue-500/10 hover:border-blue-500 hover:text-blue-500 disabled:opacity-50 flex items-center gap-2" style={{ borderColor: activeTheme.border, color: activeTheme.text }}>
			                              <RefreshCw size={13} className={deviceReportSecretBusy ? 'animate-spin' : ''} /> {deviceReportSecretStatus.configured ? 'Rotate secret' : 'Generate webhook secret'}
			                            </button>
			                          </div>
			                        </>
			                      )}
			                    </div>
			                  </div>
			                )}

			                {settingsTab === 'webhook' && (
			                  <div className="mt-6">
			                    <h3 className="text-sm font-bold mb-4" style={{ color: activeTheme.text }}>App Inventory Reporting</h3>
			                    <div className="space-y-3 p-5 rounded-xl border shadow-sm max-w-2xl" style={{ backgroundColor: activeTheme.card, borderColor: activeTheme.border }}>
			                      <p className="text-[11px] leading-relaxed" style={{ color: activeTheme.textMuted }}>
			                        A stopgap for App List compliance (Missing/Disallowed app conditions) before the dedicated Applivery SOAR agent exists. These scripts read each device's installed apps and versions locally — real bundle IDs + CFBundleShortVersionString on macOS, winget package IDs + Version on Windows when available — and push them to the same secret used above, straight into the app-inventory store. Version data also feeds the Vulnerability Service integration's per-app CVE matching (Settings &gt; Vulnerability Service) — for Windows in particular, this self-report path is the more reliable source of app versions today, since Applivery's own MDM API doesn't document a stable schema for per-device Windows app versions yet. A self-reporting device effectively refreshes itself for free: the background refresher skips it and spends its budget on devices that can't self-report yet.
			                      </p>
			                      {!deviceReportSecretStatus?.configured ? (
			                        <p className="text-xs" style={{ color: activeTheme.textMuted }}>Generate a webhook secret above first — these scripts reuse it.</p>
			                      ) : (
			                        <>
			                          <div className="grid grid-cols-2 gap-2">
			                            <button
			                              type="button"
			                              disabled={downloadingScript === 'macos'}
			                              onClick={() => handleDownloadReportScript('macos')}
			                              className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-xs font-bold transition-colors border hover:bg-blue-500/10 hover:border-blue-500 hover:text-blue-500 disabled:opacity-50"
			                              style={{ borderColor: activeTheme.border, color: activeTheme.text }}
			                            >
			                              <Download size={13} /> {downloadingScript === 'macos' ? 'Preparing…' : 'macOS script (.sh)'}
			                            </button>
			                            <button
			                              type="button"
			                              disabled={downloadingScript === 'windows'}
			                              onClick={() => handleDownloadReportScript('windows')}
			                              className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-xs font-bold transition-colors border hover:bg-blue-500/10 hover:border-blue-500 hover:text-blue-500 disabled:opacity-50"
			                              style={{ borderColor: activeTheme.border, color: activeTheme.text }}
			                            >
			                              <Download size={13} /> {downloadingScript === 'windows' ? 'Preparing…' : 'Windows script (.ps1)'}
			                            </button>
			                          </div>
			                          <p className="text-[10px] leading-relaxed" style={{ color: activeTheme.textMuted }}>
			                            Downloaded with your webhook URL, workspace, and secret already filled in — nothing to edit. Schedule the macOS script with launchd (LaunchAgent/LaunchDaemon) and the Windows script with Task Scheduler running as SYSTEM; both include a ready-to-use setup snippet in their header comments. Every app-list-scoped device that runs one of these stops drawing from the background refresher's API budget.
			                          </p>
			                        </>
			                      )}
			                    </div>

			                    <h3 className="text-sm font-bold mb-4 mt-6" style={{ color: activeTheme.text }}>Security Attestation Reporting (Windows &amp; macOS)</h3>
			                    <div className="space-y-3 p-5 rounded-xl border shadow-sm max-w-2xl" style={{ backgroundColor: activeTheme.card, borderColor: activeTheme.border }}>
			                      <p className="text-[11px] leading-relaxed" style={{ color: activeTheme.textMuted }}>
			                        Reports hardware/OS security posture straight off the device — Secure Boot, Virtualization-Based Security, Credential Guard, memory integrity (HVCI), BitLocker, and TPM readiness on Windows; FileVault, firewall, XProtect, Secure Token, and screen lock on macOS — without depending on Applivery having a confirmed passthrough for reading that level of detail back through its MDM channel. Feeds the "Self-Reported Attribute" condition type in Compliance Policies, so a policy can flag a device Non-Compliant the moment one of these drops and trigger the matching enforcement action automatically. No Android/iOS equivalent — neither platform lets a third party run an unattended script with local admin/root privileges; that would need a dedicated MDM agent app instead.
			                      </p>
			                      {!deviceReportSecretStatus?.configured ? (
			                        <p className="text-xs" style={{ color: activeTheme.textMuted }}>Generate a webhook secret above first — these scripts reuse it.</p>
			                      ) : (
			                        <>
			                          <div className="grid grid-cols-2 gap-2">
			                            <button
			                              type="button"
			                              disabled={downloadingSecurityScript === 'windows'}
			                              onClick={() => handleDownloadSecurityReportScript('windows')}
			                              className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-xs font-bold transition-colors border hover:bg-blue-500/10 hover:border-blue-500 hover:text-blue-500 disabled:opacity-50"
			                              style={{ borderColor: activeTheme.border, color: activeTheme.text }}
			                            >
			                              <Download size={13} /> {downloadingSecurityScript === 'windows' ? 'Preparing…' : 'Windows script (.ps1)'}
			                            </button>
			                            <button
			                              type="button"
			                              disabled={downloadingSecurityScript === 'macos'}
			                              onClick={() => handleDownloadSecurityReportScript('macos')}
			                              className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-xs font-bold transition-colors border hover:bg-blue-500/10 hover:border-blue-500 hover:text-blue-500 disabled:opacity-50"
			                              style={{ borderColor: activeTheme.border, color: activeTheme.text }}
			                            >
			                              <Download size={13} /> {downloadingSecurityScript === 'macos' ? 'Preparing…' : 'macOS script (.sh)'}
			                            </button>
			                          </div>
			                          <p className="text-[10px] leading-relaxed" style={{ color: activeTheme.textMuted }}>
			                            Windows: run as SYSTEM (Task Scheduler) — several queries need elevated context to return complete data. macOS: run as a LaunchDaemon (root) — Secure Token/screen lock are per-user settings the script reads via the current console user, so a machine with no one logged in reports those as unknown rather than guessed. Setup snippets included in each script's header comments.
			                          </p>
			                        </>
			                      )}
			                    </div>
			                  </div>
			                )}

			                {settingsTab === 'logexport' && (
			                  <div>
			                    <h3 className="text-sm font-bold mb-4" style={{ color: activeTheme.text }}>Log Export Destinations</h3>
			                    <div className="p-5 rounded-xl border shadow-sm max-w-2xl" style={{ backgroundColor: activeTheme.card, borderColor: activeTheme.border }}>
			                      <p className="text-[11px] leading-relaxed mb-3" style={{ color: activeTheme.textMuted }}>
			                        Ships this workspace's audit trail somewhere outside the app. Syslog and webhook deliver in real time as events happen; S3, NFS, and SFTP export once a day. Google Drive/OneDrive aren't available yet — those need an OAuth app registration created on your end first.
			                      </p>
			                      {isSettingsModalOpen && <LogExportDestinations orgSlug={orgSlug} theme={activeTheme} />}
			                    </div>
			                  </div>
			                )}

			                {settingsTab === 'triggers' && (
			                  <div>
			                    <h3 className="text-sm font-bold mb-4" style={{ color: activeTheme.text }}>Inbound Webhook Triggers</h3>
			                    <div className="p-5 rounded-xl border shadow-sm max-w-2xl" style={{ backgroundColor: activeTheme.card, borderColor: activeTheme.border }}>
			                      {isSettingsModalOpen && <TriggersSettings orgSlug={orgSlug} theme={activeTheme} />}
			                    </div>
			                  </div>
			                )}

			                {settingsTab === 'caseautorun' && (
			                  <div>
			                    <h3 className="text-sm font-bold mb-4" style={{ color: activeTheme.text }}>Case Auto-Run Rules</h3>
			                    <div className="p-5 rounded-xl border shadow-sm max-w-2xl" style={{ backgroundColor: activeTheme.card, borderColor: activeTheme.border }}>
			                      {isSettingsModalOpen && <CaseAutoRunRulesSettings apiToken={apiToken} orgSlug={orgSlug} theme={activeTheme} />}
			                    </div>
			                  </div>
			                )}

			                {settingsTab === 'applivery-events' && (
			                  <div>
			                    <h3 className="text-sm font-bold mb-4" style={{ color: activeTheme.text }}>Applivery Events</h3>
			                    <div className="p-5 rounded-xl border shadow-sm max-w-2xl" style={{ backgroundColor: activeTheme.card, borderColor: activeTheme.border }}>
			                      {isSettingsModalOpen && <AppliveryWebhookSettings apiToken={apiToken} orgSlug={orgSlug} theme={activeTheme} />}
			                    </div>
			                  </div>
			                )}

			                {settingsTab === 'casesla' && (
			                  <div>
			                    <h3 className="text-sm font-bold mb-4" style={{ color: activeTheme.text }}>Case SLA</h3>
			                    <div className="p-5 rounded-xl border shadow-sm max-w-2xl" style={{ backgroundColor: activeTheme.card, borderColor: activeTheme.border }}>
			                      {isSettingsModalOpen && <CaseSlaSettings apiToken={apiToken} orgSlug={orgSlug} theme={activeTheme} />}
			                    </div>
			                  </div>
			                )}

			                {settingsTab === 'systemhealth' && (
			                  <div>
			                    <h3 className="text-sm font-bold mb-4" style={{ color: activeTheme.text }}>System Health</h3>
			                    <div className="p-5 rounded-xl border shadow-sm max-w-2xl" style={{ backgroundColor: activeTheme.card, borderColor: activeTheme.border }}>
			                      {isSettingsModalOpen && <SystemHealthSettings apiToken={apiToken} orgSlug={orgSlug} theme={activeTheme} />}
			                    </div>
			                  </div>
			                )}

			                {settingsTab === 'osupdates' && (
			                  <div>
			                    <h3 className="text-sm font-bold mb-4" style={{ color: activeTheme.text }}>OS Updates</h3>
			                    <div className="p-5 rounded-xl border shadow-sm max-w-2xl" style={{ backgroundColor: activeTheme.card, borderColor: activeTheme.border }}>
			                      {isSettingsModalOpen && <OsUpdatesSettings apiToken={apiToken} orgSlug={orgSlug} theme={activeTheme} />}
			                    </div>
			                  </div>
			                )}

			                {settingsTab === 'vulncatalog' && (
			                  <div>
			                    <h3 className="text-sm font-bold mb-4" style={{ color: activeTheme.text }}>Vulnerability Catalog</h3>
			                    <div className="p-5 rounded-xl border shadow-sm max-w-2xl" style={{ backgroundColor: activeTheme.card, borderColor: activeTheme.border }}>
			                      {isSettingsModalOpen && <VulnCatalogSettings apiToken={apiToken} orgSlug={orgSlug} theme={activeTheme} />}
			                    </div>
			                  </div>
			                )}

			                {settingsTab === 'vulnservice' && (
			                  <div>
			                    <h3 className="text-sm font-bold mb-4" style={{ color: activeTheme.text }}>Vulnerability Service</h3>
			                    <div className="p-5 rounded-xl border shadow-sm max-w-2xl" style={{ backgroundColor: activeTheme.card, borderColor: activeTheme.border }}>
			                      {isSettingsModalOpen && <VulnServiceSettings apiToken={apiToken} orgSlug={orgSlug} theme={activeTheme} canManage={canEditIntegrationSecrets} />}
			                    </div>
			                  </div>
			                )}

			                {settingsTab === 'oslifecycle' && (
			                  <div>
			                    <h3 className="text-sm font-bold mb-4" style={{ color: activeTheme.text }}>OS Lifecycle</h3>
			                    <div className="p-5 rounded-xl border shadow-sm max-w-2xl" style={{ backgroundColor: activeTheme.card, borderColor: activeTheme.border }}>
			                      {isSettingsModalOpen && <OsLifecycleSettings apiToken={apiToken} orgSlug={orgSlug} theme={activeTheme} />}
			                    </div>
			                  </div>
			                )}

			                {settingsTab === 'appupdates' && (
			                  <div>
			                    <h3 className="text-sm font-bold mb-4" style={{ color: activeTheme.text }}>App Updates (Apple)</h3>
			                    <div className="p-5 rounded-xl border shadow-sm max-w-2xl" style={{ backgroundColor: activeTheme.card, borderColor: activeTheme.border }}>
			                      {isSettingsModalOpen && <AppleAppUpdatesSettings apiToken={apiToken} orgSlug={orgSlug} theme={activeTheme} />}
			                    </div>
			                  </div>
			                )}

			                {settingsTab === 'integrations' && (
			                  <div>
			                    <h3 className="text-sm font-bold mb-4" style={{ color: activeTheme.text }}>Ticketing &amp; Chat</h3>
			                    <div className="p-5 rounded-xl border shadow-sm max-w-2xl" style={{ backgroundColor: activeTheme.card, borderColor: activeTheme.border }}>
			                      {isSettingsModalOpen && <IntegrationsSettings orgSlug={orgSlug} theme={activeTheme} canManage={canEditIntegrationSecrets} />}
			                    </div>
			                  </div>
			                )}

			                {settingsTab === 'threatintel' && (
			                  <div>
			                    <h3 className="text-sm font-bold mb-4" style={{ color: activeTheme.text }}>Threat Intel</h3>
			                    <div className="p-5 rounded-xl border shadow-sm max-w-2xl" style={{ backgroundColor: activeTheme.card, borderColor: activeTheme.border }}>
			                      {isSettingsModalOpen && <ThreatIntelSettings orgSlug={orgSlug} theme={activeTheme} canManage={canEditIntegrationSecrets} />}
			                    </div>
			                  </div>
			                )}

			                {settingsTab === 'roles' && isSuperAdmin && (
			                  <div>
			                    <h3 className="text-sm font-bold mb-4" style={{ color: activeTheme.text }}>Roles</h3>
			                    <div className="p-5 rounded-xl border shadow-sm max-w-3xl" style={{ backgroundColor: activeTheme.card, borderColor: activeTheme.border }}>
			                      {isSettingsModalOpen && <RolesSettings apiToken={apiToken} orgSlug={orgSlug} theme={activeTheme} isDark={isDark} />}
			                    </div>
			                  </div>
			                )}

			              </div>
			            </div>

			           {/* FOOTER */}
            <div className="p-6 border-t shrink-0 flex justify-end" style={{ borderColor: activeTheme.border, backgroundColor: activeTheme.card }}>
              <button onClick={() => { setIsSettingsModalOpen(false); fetchWidgetData(); }} className="bg-[#0055FF] px-8 py-3 rounded-xl font-bold text-sm text-white hover:bg-blue-600 transition-colors shadow-lg">
                Apply & Save Configuration
              </button>
            </div>
            
          </div>
        </div>
      )}

      {/* CUSTOM HTML TEMPLATE MODAL */}
      {isTemplateModalOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 sm:p-6 overflow-y-auto">
          <div className="w-full max-w-5xl rounded-2xl shadow-2xl flex flex-col transition-colors duration-300 h-[90vh]" style={{ backgroundColor: activeTheme.card, border: `1px solid ` }}>
            <div className="flex justify-between items-center p-6 border-b shrink-0" style={{ borderColor: activeTheme.border }}>
              <div>
                <h2 className="text-xl font-bold" style={{ color: activeTheme.text }}>Custom HTML Template</h2>
                <p className="text-xs mt-1" style={{ color: activeTheme.textMuted }}>Use Jinja2 syntax to inject data (e.g., <code className="text-blue-500">{'{{ Report_Title }}'}</code>). Leave blank to fall back to default.</p>
              </div>
              <button onClick={() => setIsTemplateModalOpen(false)} className="hover:text-red-500 transition-colors" style={{ color: activeTheme.textMuted }}><X size={20} /></button>
            </div>
            <div className="p-6 overflow-hidden flex-1 flex flex-col bg-gray-50/50 dark:bg-black/20">
              <textarea
                value={customReportTemplate}
                onChange={(e) => setCustomReportTemplate(e.target.value)}
                placeholder="<!DOCTYPE html>&#10;<html>..."
                className="w-full flex-1 rounded-xl p-4 text-[12px] font-mono outline-none focus:border-blue-500 transition-colors border shadow-inner resize-none custom-scrollbar focus:ring-2 focus:ring-brand-500"
                style={{ backgroundColor: isDark ? '#0A0A0A' : '#FFFFFF', color: isDark ? '#34D399' : '#0F172A', borderColor: activeTheme.border }}
                spellCheck="false"
              />
            </div>
            <div className="p-6 border-t flex items-center justify-between shrink-0" style={{ borderColor: activeTheme.border }}>
              <button onClick={() => { if(window.confirm('Reset to default template?')) setCustomReportTemplate(''); }} className="px-5 py-2.5 rounded-lg font-bold text-sm transition-colors hover:bg-red-500/10" style={{ color: DANGER }}>Reset to Default</button>
              <div className="flex gap-3">
                <button onClick={() => setIsTemplateModalOpen(false)} className="px-5 py-2.5 rounded-lg font-medium text-sm transition-colors hover:bg-black/5 dark:hover:bg-white/5" style={{ color: activeTheme.textMuted }}>Close</button>
                <button onClick={() => setIsTemplateModalOpen(false)} className="bg-[#0055FF] hover:bg-blue-600 px-8 py-2.5 rounded-xl font-bold text-sm text-white transition-colors shadow-md">Apply & Save</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
      {/* ── WIDGET INFO MODAL — rendered at root so it escapes all overflow/z-index traps ── */}
      {widgetInfoModal && (
        <WidgetInfoModal
          widget={widgetInfoModal.widget}
          dataBlock={widgetInfoModal.dataBlock}
          overviewDateRange={overviewDateRange}
          activeTheme={activeTheme}
          primaryBlue={PRIMARY_BLUE}
          colorFor={_colorFor}
          humanLabel={_humanLabel}
          onClose={() => setWidgetInfoModal(null)}
        />
      )}

      {isOnboardingModalOpen && (
        <WorkspaceOnboardingModal
          apiToken={apiToken}
          orgSlug={orgSlug}
          organizations={organizations}
          theme={activeTheme}
          canCopyConfig={canManageWorkspaceConfig}
          onClose={() => setIsOnboardingModalOpen(false)}
          onCloned={() => window.location.reload()}
        />
      )}
    </>
  );
}
// ─── AUTHENTICATION GATEWAY ───
//
// Applivery's own Login API (traditional email+password provider) is now the
// only way in — no local admin password, no OIDC/SSO. A successful login
// gives us two things at once: our own short-lived dashboard-gate JWT, and
// the user's real Applivery session (access + refresh tokens), which is what
// every Devices/Workflows/Compliance/Reporting/Playground call uses from
// here on. See persistAppliverySession() in App() for exactly what's stored.
function AuthScreen({ onComplete }) {
  const [themeMode] = useState(() => localStorage.getItem('applivery_theme') || 'system');
  const [systemIsDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  const isDark = themeMode === 'dark' || (themeMode === 'system' && systemIsDark);
  const activeTheme = isDark ? THEME.dark : THEME.light;

  const [step, setStep] = useState('credentials'); // 'credentials' | 'mfa' | 'workspace'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [digits, setDigits] = useState(['', '', '', '', '', '']);
  const [organizations, setOrganizations] = useState([]);
  const [pendingSession, setPendingSession] = useState(null); // holds the login response while picking a workspace
  const [loginError, setLoginError] = useState('');
  const [isPending, setIsPending] = useState(false);
  const digitRefs = useRef([]);

  const mfaCode = digits.join('');

  function finishLogin(session, orgSlug) {
    localStorage.setItem('applivery_dashboard_token', session.access_token);
    localStorage.setItem('applivery_apiToken', session.appliveryAccessToken);
    localStorage.setItem('applivery_apiTokenExpireAt', session.appliveryAccessTokenExpireAt || '');
    localStorage.setItem('applivery_refreshToken', session.appliveryRefreshToken || '');
    localStorage.setItem('applivery_refreshTokenExpireAt', session.appliveryRefreshTokenExpireAt || '');
    localStorage.setItem('applivery_orgSlug', orgSlug);
    localStorage.setItem('applivery_user', JSON.stringify(session.user || {}));
    localStorage.setItem('applivery_organizations', JSON.stringify(session.organizations || []));
    onComplete();
  }

  function handleSelectWorkspace(org) {
    if (!pendingSession) return;
    finishLogin(pendingSession, org.slug);
  }

  function handleDigitInput(index, value) {
    const digit = value.replace(/\D/g, '').slice(-1);
    const next = [...digits];
    next[index] = digit;
    setDigits(next);
    if (digit && index < 5) digitRefs.current[index + 1]?.focus();
  }

  function handleDigitKeyDown(index, e) {
    if (e.key === 'Backspace' && !digits[index] && index > 0) digitRefs.current[index - 1]?.focus();
    if (e.key === 'ArrowLeft' && index > 0) digitRefs.current[index - 1]?.focus();
    if (e.key === 'ArrowRight' && index < 5) digitRefs.current[index + 1]?.focus();
  }

  function handleDigitPaste(e) {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    const next = ['', '', '', '', '', ''];
    pasted.split('').forEach((ch, i) => { if (i < 6) next[i] = ch; });
    setDigits(next);
    digitRefs.current[Math.min(pasted.length, 5)]?.focus();
  }

  async function handleSubmit(e) {
    e?.preventDefault();
    setLoginError('');
    setIsPending(true);
    try {
      const body = { email: email.trim(), password };
      if (step === 'mfa') body.twoFactorCode = mfaCode;
      const res = await axios.post('/api/auth/login', body);
      const session = res.data;
      const orgs = session.organizations || [];
      if (orgs.length > 1) {
        setOrganizations(orgs);
        setPendingSession(session);
        setStep('workspace');
      } else {
        const orgSlug = orgs[0]?.slug || session.currentOrganizationId || '';
        finishLogin(session, orgSlug);
      }
    } catch (err) {
      const apiError = err.response?.data?.detail?.error;
      if (apiError === 'TWO_FACTOR_REQUIRED') {
        setStep('mfa');
      } else {
        setLoginError(apiError || 'Invalid email or password.');
      }
    } finally {
      setIsPending(false);
    }
  }

  const inputStyle = { backgroundColor: isDark ? activeTheme.bg : '#FFFFFF', borderColor: activeTheme.border, color: activeTheme.text };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 transition-colors duration-300" style={{ backgroundColor: activeTheme.bg, color: activeTheme.text, backgroundImage: `url('https://dashboard.applivery.io/images/loading-bg.svg')`, backgroundSize: 'cover', backgroundPosition: 'center', backgroundRepeat: 'no-repeat' }}>
      <div className="p-10 rounded-2xl border max-w-md w-full min-h-[450px] flex flex-col justify-center shadow-2xl relative overflow-hidden transition-colors duration-300" style={{ backgroundColor: isDark ? activeTheme.card : '#F3F7FE', borderColor: activeTheme.border }}>
        <img src="/applivery-bp-login.svg" className="h-8 mx-auto mb-8" alt="Applivery" style={{ filter: isDark ? 'none' : 'invert(1)' }} />

        {step === 'credentials' && (
          <form onSubmit={handleSubmit} className="animate-in fade-in slide-in-from-bottom-2 duration-300">
            <h1 className="text-xl font-regular mb-6 text-center">Welcome Back</h1>

            {loginError && <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/50 text-red-500 text-xs font-medium text-center">{loginError}</div>}

            <div className="mb-4">
              <label className="block text-xs font-medium mb-1" style={{ color: activeTheme.textMuted }}>Email</label>
              <input
                type="email" value={email} onChange={e => setEmail(e.target.value)}
                required autoFocus placeholder="you@company.com"
                className="w-full rounded-lg px-3 py-3 outline-none text-sm border focus:border-blue-500 transition-colors focus:ring-2 focus:ring-brand-500"
                style={inputStyle}
              />
            </div>
            <div className="mb-6">
              <label className="block text-xs font-medium mb-1" style={{ color: activeTheme.textMuted }}>Password</label>
              <input
                type="password" value={password} onChange={e => setPassword(e.target.value)}
                required placeholder="••••••••"
                className="w-full rounded-lg px-3 py-3 outline-none text-sm border focus:border-blue-500 transition-colors focus:ring-2 focus:ring-brand-500"
                style={inputStyle}
              />
            </div>
            <button
              type="submit"
              disabled={isPending || !email || !password}
              className="w-full bg-[#0055FF] hover:bg-blue-600 text-white px-4 py-3 rounded-xl font-bold text-sm transition-colors shadow-lg disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isPending && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
              {isPending ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        )}

        {step === 'mfa' && (
          <div className="animate-in fade-in slide-in-from-right-4 duration-300">
            <button type="button" onClick={() => { setStep('credentials'); setDigits(['', '', '', '', '', '']); setLoginError(''); }} className="absolute top-6 left-6 transition-colors hover:opacity-70" style={{ color: activeTheme.textMuted }}>
              <ChevronLeft size={20} />
            </button>
            <h1 className="text-xl font-bold mb-1 text-center">Two-Factor authentication</h1>
            <p className="text-sm mb-6 text-center" style={{ color: activeTheme.textMuted }}>
              Enter the six-digit code generated by your Authenticator App.
            </p>

            {loginError && <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/50 text-red-500 text-xs font-medium text-center">{loginError}</div>}

            <div className="mb-6">
              <div className="flex gap-2" onPaste={handleDigitPaste}>
                {digits.map((digit, i) => (
                  <input
                    key={i}
                    ref={el => { digitRefs.current[i] = el; }}
                    type="text" inputMode="numeric" maxLength={1} value={digit}
                    autoFocus={i === 0}
                    onChange={e => handleDigitInput(i, e.target.value)}
                    onKeyDown={e => handleDigitKeyDown(i, e)}
                    className="flex-1 min-w-0 aspect-square rounded-xl text-center text-xl font-semibold border-2 outline-none transition-all focus:border-blue-500 focus:ring-2 focus:ring-brand-500"
                    style={inputStyle}
                  />
                ))}
              </div>
            </div>

            <button
              onClick={handleSubmit}
              disabled={isPending || mfaCode.length !== 6}
              className="w-full bg-[#0055FF] hover:bg-blue-600 text-white px-4 py-3 rounded-xl font-bold text-sm transition-colors shadow-lg disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isPending && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
              {isPending ? 'Verifying…' : 'Sign in'}
            </button>
          </div>
        )}

        {step === 'workspace' && (
          <div className="animate-in fade-in slide-in-from-right-4 duration-300">
            <h1 className="text-xl font-bold mb-1 text-center">Select Workspace</h1>
            <p className="text-sm mb-6 text-center" style={{ color: activeTheme.textMuted }}>
              Your account has access to multiple workspaces. Choose one to continue.
            </p>
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {organizations.map(org => (
                <button
                  key={org.id}
                  onClick={() => handleSelectWorkspace(org)}
                  className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl border-2 text-left transition-all hover:border-blue-500"
                  style={{ borderColor: activeTheme.border, backgroundColor: isDark ? activeTheme.bg : '#FFFFFF' }}
                >
                  <div className="shrink-0 w-9 h-9 rounded-lg overflow-hidden flex items-center justify-center text-white text-sm font-bold" style={{ backgroundColor: '#0241E2' }}>
                    {org.picture ? <img src={org.picture} alt={org.name} className="w-full h-full object-cover" /> : (org.name || '?').slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm truncate" style={{ color: activeTheme.text }}>{org.name}</p>
                    <p className="text-xs font-mono mt-0.5" style={{ color: activeTheme.textMuted }}>{org.slug}</p>
                  </div>
                  <span style={{ color: '#0241E2', fontSize: 18 }}>›</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function App() {
  // ── THEME ENGINE (Synced with AuthScreen and Dashboard logic) ──
  const [themeMode] = useState(() => localStorage.getItem('applivery_theme') || 'system');
  const [systemIsDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  const isDark = themeMode === 'dark' || (themeMode === 'system' && systemIsDark);
  const activeTheme = isDark ? THEME.dark : THEME.light;

  const [bootState, setBootState] = useState('checking'); // checking | login | resolving | denied | ready
  const [deniedReason, setDeniedReason] = useState('');

  // Resolves this collaborator's SOAR access for the current workspace and
  // caches it (see resolveSoarAccess) before letting the Dashboard mount —
  // called both from the boot-time check below (page load / workspace-
  // switch reload) and from AuthScreen.onComplete (fresh login / workspace
  // picker), which is the only path that doesn't go through a page reload.
  async function gateAccess(apiTok, slug) {
    setBootState('resolving');
    const access = await resolveSoarAccess(apiTok, slug);
    if (access.allowed) {
      setBootState('ready');
    } else {
      setDeniedReason(access.deniedReason || 'No SOAR role is assigned for this workspace yet.');
      setBootState('denied');
    }
  }

  useEffect(() => {
    (async () => {
      const dashboardToken = localStorage.getItem('applivery_dashboard_token');
      const apiTok = localStorage.getItem('applivery_apiToken');
      const orgSlugStored = localStorage.getItem('applivery_orgSlug');
      if (!dashboardToken || !apiTok || !orgSlugStored) {
        setBootState('login');
        return;
      }

      // If the Applivery session is about to expire, renew it before letting
      // the dashboard load — avoids a wave of 401s right after boot.
      const expireAt = localStorage.getItem('applivery_apiTokenExpireAt');
      const expiringSoon = expireAt && (new Date(expireAt).getTime() - Date.now() < 60 * 1000);
      let currentApiTok = apiTok;
      if (expiringSoon) {
        const ok = await refreshAppliverySession();
        if (!ok) {
          clearAppliverySession();
          setBootState('login');
          return;
        }
        currentApiTok = localStorage.getItem('applivery_apiToken');
      }
      await gateAccess(currentApiTok, orgSlugStored);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (bootState === 'checking' || bootState === 'resolving') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center transition-colors duration-300" style={{ backgroundColor: activeTheme.bg }}>
        <img src="/applivery-bp-login.svg" className="h-7 object-contain mb-6 opacity-70" alt="Applivery" style={{ filter: isDark ? 'none' : 'invert(1)' }} />
        <div className="w-7 h-7 border-2 rounded-full animate-spin mb-3" style={{ borderColor: `${PRIMARY_BLUE}20`, borderTopColor: PRIMARY_BLUE }}/>
        <span className="text-sm uppercase tracking-widest font-medium opacity-30" style={{ color: activeTheme.text }}>
          {bootState === 'resolving' ? 'Checking permissions…' : 'Starting up…'}
        </span>
      </div>
    );
  }

  if (bootState === 'login') {
    return <AuthScreen onComplete={() => gateAccess(localStorage.getItem('applivery_apiToken'), localStorage.getItem('applivery_orgSlug'))} />;
  }

  if (bootState === 'denied') {
    return <AccessDeniedScreen reason={deniedReason} theme={activeTheme} isDark={isDark} onRetry={() => gateAccess(localStorage.getItem('applivery_apiToken'), localStorage.getItem('applivery_orgSlug'))} />;
  }

  return <Dashboard />;
}

// ─── ACCESS DENIED SCREEN ───
// Shown when resolve-access comes back allowed:false — no Applivery
// Collaborator record found, or (more commonly) a real record but no SOAR
// Role mapped to their tag yet. Never a silent read-only fallback, per the
// explicit RBAC design: unmapped collaborators get nothing until a Super
// Admin maps their tag to a Role under Settings > Roles.
function AccessDeniedScreen({ reason, theme, isDark, onRetry }) {
  const [isRetrying, setIsRetrying] = useState(false);
  const organizations = (() => { try { return JSON.parse(localStorage.getItem('applivery_organizations') || '[]'); } catch (e) { return []; } })();
  const currentSlug = localStorage.getItem('applivery_orgSlug') || '';
  const siblings = organizations.filter(o => o.slug !== currentSlug);

  async function handleRetry() {
    setIsRetrying(true);
    try { await onRetry(); } finally { setIsRetrying(false); }
  }

  function handleSwitch(slug) {
    localStorage.setItem('applivery_orgSlug', slug);
    window.location.reload();
  }

  function handleSignOut() {
    clearAppliverySession();
    window.location.reload();
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 transition-colors duration-300" style={{ backgroundColor: theme.bg, color: theme.text }}>
      <div className="p-8 rounded-2xl border max-w-md w-full shadow-2xl text-center" style={{ backgroundColor: isDark ? theme.card : '#FFFFFF', borderColor: theme.border }}>
        <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4" style={{ backgroundColor: '#EF444415' }}>
          <ShieldAlert size={22} style={{ color: '#EF4444' }} />
        </div>
        <h1 className="text-lg font-bold mb-2">Access not configured</h1>
        <p className="text-xs leading-relaxed mb-6" style={{ color: theme.textMuted }}>{reason}</p>

        {siblings.length > 0 && (
          <div className="mb-4 space-y-1.5">
            <p className="text-[10px] uppercase tracking-wide font-semibold mb-1.5" style={{ color: theme.textMuted }}>Try another workspace</p>
            {siblings.map(org => (
              <button key={org.id} onClick={() => handleSwitch(org.slug)}
                className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-all hover:border-blue-500"
                style={{ border: `1px solid ${theme.border}`, color: theme.text }}>
                {org.name} <span style={{ color: theme.textMuted }}>{org.slug}</span>
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2">
          <button onClick={handleSignOut} className="flex-1 px-3 py-2 rounded-lg text-xs font-semibold" style={{ border: `1px solid ${theme.border}`, color: theme.text }}>
            Sign out
          </button>
          <button onClick={handleRetry} disabled={isRetrying} className="flex-1 px-3 py-2 rounded-lg text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700 disabled:opacity-50">
            {isRetrying ? 'Checking…' : 'Check again'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default App;