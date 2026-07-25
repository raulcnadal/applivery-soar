import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { Responsive } from 'react-grid-layout';
import ReactECharts from 'echarts-for-react';
import { 
  GripHorizontal, X, Settings, Download, Activity, Plus, Trash2, 
  Layout, BarChart3, Edit3, TrendingUp, PieChart as PieIcon, 
  Smartphone, ShieldAlert, BatteryCharging, Users, Briefcase, Bell,
  List, SlidersHorizontal, Radar, Sun, Moon, Monitor, Check, ChevronDown, Info, ChevronRight,
  Upload, Save, Box, FileText, MapPin, Clock, Target, Wifi, WifiOff,
  Layers, Globe, Search, Bookmark, ChevronLeft, Heart, Bug,
  Folder, Atom, Backpack, ShoppingBag, Locate, Disc, Bed, Archive, Baby, Zap,
  Bone, Book, Package, FlaskConical, LifeBuoy, Building2, Bus, Calculator, Calendar,
  Camera, Armchair, MessageCircle, CheckSquare, XSquare, AlertTriangle, Timer, RefreshCw, Factory, Clapperboard,
  Code, Compass, Cpu, ThumbsDown, ThumbsUp, Copy, CircleDollarSign, ChevronsUp, Filter,
  Aperture, Flame, Flag, Ban, Gamepad2, Headphones, Home, Hourglass, Glasses, Key, Laptop,
  Lightbulb, Lock, Unlock, Wand2, Navigation, BookOpen, Palette, Printer,
  Radio, Satellite, Shield, Store, Tag, Shirt, User, Watch, LayoutGrid, Wine, Ghost, Mail
} from 'lucide-react';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import ReactGlobe from 'react-globe.gl';
import * as THREE from 'three';
import { UserManager } from 'oidc-client-ts';

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

axios.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      const detail = error.response.data?.detail || '';
      
      // FIX: Explicitly check for 'Missing X-Dashboard-Token', ignoring 'Missing credentials'
      if (typeof detail === 'string' && (detail.includes('Invalid session') || detail.includes('Missing X-Dashboard-Token'))) {
        console.error("🔥 FATAL SESSION ERROR:", detail); 
        localStorage.removeItem('applivery_dashboard_token');
        setTimeout(() => window.location.reload(), 1000); 
      } else {
        console.warn("Ignored 401: Data-level error, session remains active.", detail);
      }
    }
    return Promise.reject(error);
  }
);

// ─── OS ICONS COMPONENT ───
const OFFICIAL_OS_COLORS = { apple: '#79C6E8', android: '#3DDC84', windows: '#0078D4' };

function OsIcon({ platform, size = 16, color }) {
  const p = platform.toLowerCase();
  if (p.includes('apple') || p.includes('ios') || p.includes('mac') || p.includes('ipad')) {
    return (
      <svg width={size} height={size} viewBox="2 1.5 20 19" fill={color || OFFICIAL_OS_COLORS.apple}>
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

const PRIMARY_BLUE = '#0241E2';
const SUCCESS = '#22C55E';
const WARNING = '#F59E0B';
const DANGER = '#EF4444';

const THEME = {
  light: {
    bg: '#F3F7FE', card: '#FFFFFF', border: '#E9EAEC',
    text: '#111827', textMuted: '#6B7280',
    chartPalette: ['#8B5CF6', '#3B82F6', '#06B6D4', '#22C55E', '#F59E0B', '#EF4444', '#EC4899', '#14B8A6'],
    gridLine: 'rgba(107, 114, 128, 0.1)'
  },
  dark: {
    bg: '#0B101E', card: '#151C2C', border: '#2A3550',
    text: '#E2E8F0', textMuted: '#94A3B8',
    chartPalette: ['#A78BFA', '#60A5FA', '#22D3EE', '#4ADE80', '#FBBF24', '#F87171', '#F472B6', '#2DD4BF'],
    gridLine: 'rgba(148, 163, 184, 0.08)'
  }
};

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
  { id: 'small', label: 'Small', desc: '1x1', w: 4, h: 3 },
  { id: 'half', label: 'Wide', desc: '2x1', w: 6, h: 3 },
  { id: 'full', label: 'Large', desc: '2x2', w: 12, h: 3 }
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

function GlobeWidget({ items, activeTheme, onDeviceClick, filterActive = false, totalDevices = 0 }) {
  const containerRef = useRef(null);
  const globeRef = useRef(null);
  const cloudsRef = useRef(null); // Safely holds the clouds for rotation
  const [dims, setDims] = useState({ width: 300, height: 300 });
  const [tick, setTick] = useState(0);
  const tickRef = useRef(0);
  const rafRef = useRef(null);

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
      // 2. Rotate clouds seamlessly at a cinematic, subtle speed
      if (cloudsRef.current) {
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
      controls.autoRotate = true;
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
    let realLat = null, realLng = null;
    if (item.locationCache?.lat !== undefined) { realLat = parseFloat(item.locationCache.lat); realLng = parseFloat(item.locationCache.lng); }
    else if (item.lastLocation?.latitude !== undefined) { realLat = parseFloat(item.lastLocation.latitude); realLng = parseFloat(item.lastLocation.longitude); }
    else if (item.location?.lat !== undefined) { realLat = parseFloat(item.location.lat); realLng = parseFloat(item.location.lng); }
    else if (item.networkInfo?.latitude !== undefined) { realLat = parseFloat(item.networkInfo.latitude); realLng = parseFloat(item.networkInfo.longitude); }
    else if (item.summary?.latitude !== undefined) { realLat = parseFloat(item.summary.latitude); realLng = parseFloat(item.summary.longitude); }

    const str = String(item.id || item._id || Math.random());
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = ((hash << 5) - hash) + str.charCodeAt(i);
    const hasReal = realLat !== null && !isNaN(realLat);
    const lat = (hasReal ? realLat : (Math.abs(hash) % 120) - 60) + (Math.random() - 0.5) * 0.4;
    const lng = (hasReal ? realLng : (Math.abs(hash >> 8) % 360) - 180) + (Math.random() - 0.5) * 0.4;
    const alt = 0.008 + Math.random() * 0.012;

    const os = String(item.platform_normalized || item.os || '').toLowerCase();
    let color = os.includes('apple') || os.includes('ios') || os.includes('mac') ? '#79C6E8'
              : os.includes('android') ? '#3DDC84'
              : os.includes('win') ? '#0078D4'
              : '#A855F7';
    if (item.is_compliant_normalized === false) color = '#EF4444';
    else if (item.is_compliant_normalized === true) color = '#22C55E';

    return { ...item, lat, lng, alt, size: hasReal ? 3.5 : 1.8, color, label: item.display_name || item.summary?.model || 'Device' };
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
        <span className="text-[9px] font-bold uppercase tracking-widest text-white/30">Big Picture</span>
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

// ─── COMPONENT: DEVICE INSIGHT CARD ───
function DeviceInsightCard({ device, activeTheme, apiToken, orgSlug }) {
  const [activeTab, setActiveTab] = useState('Overview');
  const [showLocationHistory, setShowLocationHistory] = useState(false);
  const [locations, setLocations] = useState([]);
  const [network, setNetwork] = useState(null);
  const [assets, setAssets] = useState([]);
  const [logs, setLogs] = useState([]);
  const [loadingExtras, setLoadingExtras] = useState(true);

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
  const osIconColor = os === 'apple' ? OFFICIAL_OS_COLORS.apple : os === 'android' ? OFFICIAL_OS_COLORS.android : OFFICIAL_OS_COLORS.windows;
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
            <span className="px-2 py-1 text-[10px] font-bold rounded uppercase" style={{ backgroundColor: state === 'ACTIVE' ? `${SUCCESS}15` : `${WARNING}15`, color: state === 'ACTIVE' ? SUCCESS : WARNING }}>{state}</span>
            <span className="px-2 py-1 text-[10px] font-bold rounded uppercase" style={{ backgroundColor: `${isComp ? SUCCESS : DANGER}15`, color: isComp ? SUCCESS : DANGER }}>{isComp ? 'COMPLIANT' : 'NON-COMPLIANT'}</span>
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
        {['Overview', 'Assets', 'Agent'].map(tab => (
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
                   <span className="px-2 py-1 text-[10px] font-bold rounded uppercase tracking-widest" style={{ backgroundColor: `15`, color: PRIMARY_BLUE }}>{log.os || 'System'} Agent</span>
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
    if (o.includes('ios') || o.includes('apple') || o.includes('mac')) return OFFICIAL_OS_COLORS.apple;
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
              return <span key={os} className="px-2 py-0.5 text-[9px] font-bold rounded-full" style={{ backgroundColor: `${c}15`, color: c }}>{os.toUpperCase()}</span>;
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

  // Session Management
  const handleLogout = () => {
    localStorage.removeItem('applivery_dashboard_token');
    window.location.reload();
  };

  useEffect(() => {
    let timeoutId;
    const resetTimer = () => {
      clearTimeout(timeoutId);
      // Auto-logout after 15 minutes (900,000 ms) of inactivity
      timeoutId = setTimeout(() => handleLogout(), 15 * 60 * 1000); 
    };
    
    // Listen for any activity to keep the session alive
    window.addEventListener('mousemove', resetTimer);
    window.addEventListener('keydown', resetTimer);
    window.addEventListener('click', resetTimer);
    window.addEventListener('scroll', resetTimer);
    
    resetTimer(); // Start the timer on mount
    
    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener('mousemove', resetTimer);
      window.removeEventListener('keydown', resetTimer);
      window.removeEventListener('click', resetTimer);
      window.removeEventListener('scroll', resetTimer);
    };
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
  const [isBuilderOpen, setIsBuilderOpen] = useState(false);
  const [editingWidget, setEditingWidget] = useState(null);
  const [isSourceDropdownOpen, setIsSourceDropdownOpen] = useState(false);
  
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

  // 3. Timezone Config State
  const [userTimezone, setUserTimezone] = useState(() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch(e) { return 'UTC'; }
  });
  
  // 3b. Custom Template State
  const [customReportTemplate, setCustomReportTemplate] = useState('');
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);

  // Trigger modal when tab is selected, then reset tab so background stays valid
  useEffect(() => {
    if (reportingTab === 'template') {
      setIsTemplateModalOpen(true);
      setReportingTab('builder'); // Reset to builder so the UI behind the modal looks correct
    }
  }, [reportingTab]);

  // 4. Auth & Interceptor Logic
  const [oidcConfig, setOidcConfig] = useState({ issuerUrl: '', clientId: '' });
  const [currentUser, setCurrentUser] = useState(null);

  useEffect(() => {
    if (oidcConfig?.issuerUrl && oidcConfig?.clientId) {
      const um = new UserManager({ 
        authority: oidcConfig.issuerUrl, 
        client_id: oidcConfig.clientId, 
        redirect_uri: window.location.origin + '/auth/callback' 
      });
      um.getUser().then(user => {
        if (user && user.profile) {
          setCurrentUser({
            name: user.profile.name || user.profile.given_name || 'SSO User',
            email: user.profile.email || 'sso@workspace.local'
          });
        }
      }).catch(() => {});
    }
  }, [oidcConfig.issuerUrl, oidcConfig.clientId]);

  const userInitials = currentUser ? currentUser.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() : '??';

	const testSettingsSSO = async () => {
	    if (!oidcConfig.issuerUrl || !oidcConfig.clientId) return alert("Issuer URL and Client ID are required.");
	    try {
	      const um = new UserManager({
	        authority: oidcConfig.issuerUrl,
	        client_id: oidcConfig.clientId,
	        redirect_uri: window.location.origin + '/auth/callback',
	        popup_redirect_uri: window.location.origin + '/auth/callback',
	        response_type: 'code',
	        scope: 'openid profile email'
	      });
	      await um.signinPopup();
	      alert("✅ SSO Connection Successful!");
	    } catch (err) {
	      alert("SSO Test Failed: " + err.message);
	    }
	  };

	  const handleTestSMTP = async () => {
	    if (!smtpConfig.host || !smtpConfig.user) {
	      return alert("Please fill in the SMTP Host and Username first.");
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

	  // --- SETTINGS HELPER VARIABLES ---
  const redirectUri = window.location.origin + '/auth/callback';
  const scopes = 'openid profile email';

  const handleCopy = (text) => {
    navigator.clipboard.writeText(text);
    alert('Copied to clipboard!'); 
  };

  // (oidcConfig persistence handled by server-side persist below)

  // --- PLAYGROUND SYNC STATE ---
  const [isSyncingLocations, setIsSyncingLocations] = useState(false);
  const [showOnlyNonCompliantGlobe, setShowOnlyNonCompliantGlobe] = useState(false);

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
        console.error("Location sync failed", err);`Bearer ${token}`
        alert("Failed to sync GPS coordinates.");
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
      if (s.orgSlug)   { setOrgSlug(s.orgSlug); localStorage.setItem('applivery_orgSlug', s.orgSlug); }
      if (s.apiToken)  { setApiToken(s.apiToken); localStorage.setItem('applivery_apiToken', s.apiToken); }
      if (s.webhookUrl !== undefined) setWebhookUrl(s.webhookUrl);
      if (s.smtpConfig) setSmtpConfig(s.smtpConfig);
      if (s.oidcConfig) setOidcConfig(s.oidcConfig);
      if (Array.isArray(s.scheduledReports)) setScheduledReports(s.scheduledReports);
      if (s.timezone) setUserTimezone(s.timezone);
      if (s.customReportTemplate !== undefined) setCustomReportTemplate(s.customReportTemplate);
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
        orgSlug,
        apiToken,
        webhookUrl,
        smtpConfig,
        oidcConfig,
        scheduledReports,
        timezone: userTimezone,
        customReportTemplate,
      };
      axios.post('/api/state', payload, {
        headers: { 'X-Workspace-Slug': 'global' }
      }).catch(err => console.warn('Auto-persist failed:', err.message));
    }, 1500);
    return () => clearTimeout(persistTimerRef.current);
  }, [dashboard, themeMode, orgSlug, apiToken, webhookUrl, smtpConfig, oidcConfig, scheduledReports, userTimezone, customReportTemplate, stateLoaded]);

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
	    smtpConfig: smtpConfig,
	    oidcConfig: oidcConfig
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
            if (importedData.oidcConfig !== undefined) {
              setOidcConfig(importedData.oidcConfig);
              localStorage.setItem('applivery_oidc_config', JSON.stringify(importedData.oidcConfig));
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
  	
  const fetchWidgetData = async () => {
      if (!apiToken || !orgSlug) return;
      const results = {};
      await Promise.all(dashboard.widgets.map(async (w) => {
        try {
          const filters = JSON.stringify({
            ...w.filters,
            segmentId: selectedSegment && selectedSegment.id !== 0 ? (selectedSegment.id || selectedSegment._id) : undefined
          });
          const res = await axios.get(`/api/analytics/widget`, {
            params: { source: w.stat, chart_type: w.type, filters },
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
  }, [dashboard.widgets, apiToken, orgSlug, currentView, selectedSegment]);

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
    if (k.includes('APPLE') || k.includes('IOS') || k.includes('MAC')) return OFFICIAL_OS_COLORS.apple;
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
    if (!dataBlock) return <div className="absolute inset-0 flex items-center justify-center"><div className="w-5 h-5 border-2 border-[#0055FF]/30 border-t-[#0055FF] rounded-full animate-spin" /></div>;

    const { chartData, trendData, scorecardValue, orgProfile, items } = dataBlock;
    const isClickable = items && items.length > 0;
    const clickWrapperProps = isClickable ? { className: "h-full w-full cursor-pointer transition-opacity hover:opacity-80", onClick: () => handleChartClick(widget) } : { className: "h-full w-full" };
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
        <div className={`flex flex-col items-center justify-center h-full ${isClickable ? 'cursor-pointer hover:opacity-80' : ''}`} onClick={isClickable ? () => handleChartClick(widget) : undefined}>
          <span style={{ color: activeTheme.text, fontFamily: "'Outfit', sans-serif", fontSize: '72px', fontWeight: 700, letterSpacing: '-3px', lineHeight: 1 }}>{scorecardValue || 0}</span>
          {isClickable && <div className="flex items-center gap-1 mt-4" style={{ color: activeTheme.textMuted }}><Info size={12} /> <span className="text-[10px]">Tap to view list</span></div>}
        </div>
      );
    }

    if (widget.type === 'donut' || widget.type === 'pie') {
      if (!chartData || chartData.length === 0) return _emptyChart();
      const isDonut = widget.type === 'donut';
      const total = chartData.reduce((acc, curr) => acc + curr.value, 0);

      const getLegendProps = (name, itemOs, index) => {
          const sliceColor = _colorFor(widget.stat, name, index);
          const os = _getOsPlatform(widget.stat, name, itemOs);
          if (os) {
              return { icon: <div className="flex items-center justify-center w-4 h-4"><OsIcon platform={os} size={14} color={OFFICIAL_OS_COLORS[os]} /></div>, textColor: activeTheme.textMuted, connectorColor: sliceColor };
          }
          return { icon: <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: sliceColor }}></div>, textColor: sliceColor, connectorColor: sliceColor };
      };

      return (
        <div className="flex h-full w-full items-center justify-between pb-2">
          <div className="flex-1 h-full relative flex items-center justify-center min-w-[120px]">
            <ReactECharts opts={{ renderer: 'svg' }} onEvents={eChartsEvents} option={{ ...common, legend: { show: false }, title: isDonut ? { text: total.toString(), left: 'center', top: 'center', textStyle: { fontSize: 30, fontWeight: '700', color: activeTheme.text, fontFamily: 'Outfit, sans-serif' } } : undefined, series: [{ type: 'pie', radius: isDonut ? ['48%', '74%'] : '74%', center: ['50%', '50%'], itemStyle: { borderRadius: 3, borderColor: activeTheme.card, borderWidth: 2 }, label: { show: false }, emphasis: { scale: true, scaleSize: 4 }, data: chartData.map((d, i) => ({ ...d, itemStyle: { color: _colorFor(widget.stat, d.name, i) } })) }] }} style={{ height: '100%', width: '100%', minHeight: '120px', cursor: isClickable ? 'pointer' : 'default' }} notMerge={true} />
          </div>
          <div className="flex flex-col justify-center gap-2.5 pl-3 pr-1" style={{ minWidth: '144px' }}>
             {chartData.map((d, i) => {
                const lp = getLegendProps(d.name, d.os, i);
                return (
                <div key={i} className={`flex items-center gap-2 w-full ${isClickable ? 'cursor-pointer group' : ''}`} onClick={isClickable ? () => handleChartClick(widget, d.name) : undefined}>
                   <div className="shrink-0 flex items-center">{lp.icon}</div>
                   <span className="text-[12px] font-normal flex-1 min-w-0 truncate group-hover:opacity-70 transition-opacity" style={{color: activeTheme.textMuted}}>{_humanLabel(d.name)}</span>
                   <span className="text-[13px] font-bold tabular-nums shrink-0 ml-1" style={{color: activeTheme.text}}>{d.value}</span>
                </div>
             )})}
          </div>
        </div>
      );
    }

    if (widget.type === 'line') {
      if (!trendData || trendData.series.length === 0) return _emptyChart();
      const osTotals = trendData.os_totals || {};
      const totalSum = (osTotals.apple || 0) + (osTotals.android || 0) + (osTotals.windows || 0) || scorecardValue;
      return (
        <div className="flex flex-col h-full w-full">
           <div className={`flex-1 w-full min-h-[100px] ${isClickable ? 'cursor-pointer' : ''}`} onClick={isClickable ? () => handleChartClick(widget) : undefined}>
             <ReactECharts opts={{ renderer: 'svg' }} option={{ ...common, tooltip: { trigger: 'axis', backgroundColor: activeTheme.card, borderColor: activeTheme.border, textStyle: { color: activeTheme.text } }, grid: { top: 5, bottom: 25, left: 30, right: 10 }, xAxis: { type: 'category', data: trendData.labels, axisLabel: { color: activeTheme.textMuted, fontSize: 12 }, axisLine: { lineStyle: { color: activeTheme.border } } }, yAxis: { type: 'value', splitLine: { lineStyle: { color: activeTheme.gridLine } }, axisLabel: { color: activeTheme.textMuted, fontSize: 12 } }, series: [{ data: trendData.series, type: 'line', smooth: true, symbolSize: 6, itemStyle: { color: activeTheme.chartPalette[0] }, lineStyle: { width: 3 }, areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{offset: 0, color: `${activeTheme.chartPalette[0]}44`}, {offset: 1, color: `${activeTheme.chartPalette[0]}00`}] }, opacity: 0.9 } }] }} style={{ height: '100%', width: '100%' }} notMerge={true} />
           </div>
           <div className="flex items-center justify-between border-t mt-1 pt-3 pb-1 px-4" style={{borderColor: activeTheme.border}}>
              <div className="flex flex-col items-center">
                 <span className="text-[9px] font-bold text-gray-400 tracking-wider">TOTAL</span>
                 <span className="text-[14px] font-bold mt-1" style={{color: activeTheme.text}}>{totalSum}</span>
              </div>
              {osTotals.apple !== undefined && (
                <div className="flex flex-col items-center">
                   <span className="text-[9px] font-bold text-gray-400 tracking-wider">IOS</span>
                   <span className="text-[14px] font-bold mt-1" style={{color: activeTheme.text}}>{osTotals.apple}</span>
                </div>
              )}
              {osTotals.android !== undefined && (
                <div className="flex flex-col items-center">
                   <span className="text-[9px] font-bold text-gray-400 tracking-wider">ANDROID</span>
                   <span className="text-[14px] font-bold mt-1" style={{color: activeTheme.text}}>{osTotals.android}</span>
                </div>
              )}
              {osTotals.windows !== undefined && osTotals.windows > 0 && (
                <div className="flex flex-col items-center">
                   <span className="text-[9px] font-bold text-gray-400 tracking-wider">WINDOWS</span>
                   <span className="text-[14px] font-bold mt-1" style={{color: activeTheme.text}}>{osTotals.windows}</span>
                </div>
              )}
           </div>
        </div>
      );
    }

    if (widget.type === 'bar') {
      if (!chartData || chartData.length === 0) return _emptyChart();
      return (
        <div className="h-full w-full">
          <ReactECharts opts={{ renderer: 'svg' }} onEvents={eChartsEvents} option={{ ...common, grid: { top: 20, bottom: 30, left: 40, right: 20 }, xAxis: { type: 'category', data: chartData.map(d => d.name), axisLabel: { color: activeTheme.textMuted, fontSize: 13, formatter: function (value, index) { const os = _getOsPlatform(widget.stat, value, chartData[index]?.os); if (os && osImages[os]) return `{${os}|}\n{value|${value}}`; return `{value|${value}}`; }, rich: { apple: { height: 14, align: 'center', backgroundColor: { image: osImages.apple } }, android: { height: 14, align: 'center', backgroundColor: { image: osImages.android } }, windows: { height: 14, align: 'center', backgroundColor: { image: osImages.windows } }, value: { color: activeTheme.textMuted, fontSize: 13, align: 'center', paddingTop: 6 } } }, axisLine: { lineStyle: { color: activeTheme.border } } }, yAxis: { type: 'value', splitLine: { lineStyle: { color: activeTheme.gridLine } }, axisLabel: { color: activeTheme.textMuted, fontSize: 12 } }, series: [{ type: 'bar', data: chartData.map(d => d.value), itemStyle: { borderRadius: [2, 2, 0, 0], color: activeTheme.chartPalette[0] }, barWidth: '35%' }] }} style={{ height: '100%', width: '100%', cursor: isClickable ? 'pointer' : 'default' }} notMerge={true} />
        </div>
      );
    }

    if (widget.type === 'gauge') {
      if (!chartData || chartData.length === 0) return _emptyChart();
      
      // Calculate percentage: Primary Value vs Total
      const total = chartData.reduce((acc, curr) => acc + curr.value, 0);
      const primaryItem = chartData[0];
      const val = total > 0 ? Math.round((primaryItem.value / total) * 100) : 0;
      const color = _colorFor(widget.stat, primaryItem.name, 0);

      return (
        <div className={`h-full w-full opacity-80' : ''`} onClick={isClickable ? () => handleChartClick(widget, primaryItem.name) : undefined}>
          <ReactECharts opts={{ renderer: 'svg' }} onEvents={eChartsEvents} option={{ ...common, series: [{ type: 'gauge', startAngle: 180, endAngle: 0, min: 0, max: 100, pointer: { show: false }, progress: { show: true, overlap: false, roundCap: true, clip: false, itemStyle: { color: color } }, axisLine: { lineStyle: { width: 16, color: [[1, activeTheme.border]] } }, splitLine: { show: false }, axisTick: { show: false }, axisLabel: { show: false }, data: [{ value: val, name: _humanLabel(primaryItem.name) }], title: { fontSize: 12, color: activeTheme.textMuted, offsetCenter: [0, '25%'] }, detail: { fontSize: 32, color: activeTheme.text, fontWeight: 'bold', offsetCenter: [0, '-10%'], formatter: '{value}%' } }] }} style={{ height: '100%', width: '100%' }} notMerge={true} />
        </div>
      );
    }

    if (widget.type === 'radar') {
      if (!chartData || chartData.length === 0) return _emptyChart();
      const maxVal = Math.max(...chartData.map(d => d.value)) * 1.2 || 10;
      return (
        <div className={`h-full w-full ${isClickable ? 'cursor-pointer hover:opacity-80' : ''}`} onClick={isClickable ? () => handleChartClick(widget) : undefined}>
          <ReactECharts opts={{ renderer: 'svg' }} option={{ ...common, radar: { indicator: chartData.map(d => ({ name: d.name, max: maxVal })), radius: '65%', axisName: { color: activeTheme.textMuted, fontSize: 12 }, splitLine: { lineStyle: { color: activeTheme.gridLine } }, splitArea: { show: false }, axisLine: { lineStyle: { color: activeTheme.border } } }, series: [{ type: 'radar', data: [{ value: chartData.map(d => d.value), name: widget.title, areaStyle: { color: `${activeTheme.chartPalette[0]}4D` }, lineStyle: { color: activeTheme.chartPalette[0], width: 2 }, itemStyle: { color: activeTheme.chartPalette[0] } }] }] }} style={{ height: '100%', width: '100%' }} notMerge={true} />
        </div>
      );
    }
    
    if (widget.type === 'globe') {
      if (!items || items.length === 0) return _emptyChart();
      return <GlobeWidget items={items} activeTheme={activeTheme} onDeviceClick={(item) => openInsight(item)} />;
    }

    if (widget.type === 'list' || widget.type === 'progress') {
      if (!chartData || chartData.length === 0) return _emptyChart();
      const maxVal = Math.max(...chartData.map(d => d.value)) || 1;
      return (
        <div className="h-full overflow-y-auto pr-2 flex flex-col gap-4 custom-scrollbar">
          {chartData.map((item, idx) => {
            const pctMax = (item.value / maxVal) * 100;
            const barColor = activeTheme.chartPalette[idx % activeTheme.chartPalette.length];
            const osPlatform = widget.stat === 'stats_os_updates_all' ? _getOsPlatform(widget.stat, item.name, item.os) : null;
            const iconColor = osPlatform ? OFFICIAL_OS_COLORS[osPlatform] : _colorFor(widget.stat, item.name, idx);
            return (
              <div key={idx} className={`flex flex-col gap-2 ${isClickable ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''}`} onClick={isClickable ? (e) => { e.stopPropagation(); handleChartClick(widget, item.name); } : undefined}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {osPlatform ? (
                        <div className="flex items-center justify-center shrink-0 w-5 h-5"><OsIcon platform={osPlatform} size={14} color={iconColor} /></div>
                    ) : (
                        <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: iconColor }}></div>
                    )}
                    <span className="text-[12px] font-medium tracking-wide text-gray-500">
                      {widget.stat === 'stats_models' && idx === 0 ? <span style={{color: activeTheme.textMuted}}>Most used </span> : ''}
                      {_humanLabel(item.name)}
                    </span>
                  </div>
                  <span className="text-[13px] font-bold" style={{ color: activeTheme.text }}>{item.value}</span>
                </div>
                {widget.type === 'progress' && (
                  <div className="w-full h-2 rounded-full overflow-hidden" style={{ backgroundColor: `${barColor}25` }}>
                    <div className="h-full rounded-full transition-all duration-1000 ease-out" style={{ width: `${pctMax}%`, backgroundColor: barColor }}></div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      );
    }
  };

  const _emptyChart = () => (
    <div className="flex flex-col items-center justify-center h-full opacity-50">
      <Activity size={24} className="mb-2" style={{ color: activeTheme.textMuted }} />
      <span className="text-xs font-bold uppercase tracking-widest" style={{ color: activeTheme.textMuted }}>No Data</span>
    </div>
  );

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
                  <span className="px-2 py-1 text-[10px] font-bold rounded uppercase" style={{ backgroundColor: `${PRIMARY_BLUE}15`, color: PRIMARY_BLUE }}>SEGMENT</span>
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
      const osIconColor = os === 'ios' || os === 'apple' ? OFFICIAL_OS_COLORS.apple : os === 'android' ? OFFICIAL_OS_COLORS.android : OFFICIAL_OS_COLORS.windows;
      return (
        <div className="space-y-6">
          <div className="flex items-center gap-4 border-b pb-6" style={{ borderColor: activeTheme.border }}>
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ backgroundColor: `${osIconColor}15` }}><OsIcon platform={os} size={32} color={osIconColor} /></div>
            <div>
              <h3 className="text-xl font-bold" style={{ color: activeTheme.text }}>{name}</h3>
              <p className="text-sm" style={{ color: activeTheme.textMuted }}>{dl.applicationInfo?.name || 'App Download'}</p>
              <div className="flex gap-2 mt-2">
                <span className="px-2 py-1 text-[10px] font-bold rounded uppercase" style={{ backgroundColor: `${SUCCESS}15`, color: SUCCESS }}>v{dl.build?.versionName}</span>
                <span className="px-2 py-1 text-[10px] font-bold rounded uppercase" style={{ backgroundColor: `${PRIMARY_BLUE}15`, color: PRIMARY_BLUE }}>{dl.from}</span>
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
      const osIconColor = os === 'apple' ? OFFICIAL_OS_COLORS.apple : os === 'android' ? OFFICIAL_OS_COLORS.android : OFFICIAL_OS_COLORS.windows;
      return (
        <div className="space-y-6">
          <div className="flex items-center gap-4 border-b pb-6" style={{ borderColor: activeTheme.border }}>
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ backgroundColor: `${osIconColor}15` }}><OsIcon platform={os} size={32} color={osIconColor} /></div>
            <div>
              <h3 className="text-xl font-bold" style={{ color: activeTheme.text }}>{b.applicationInfo?.name || 'App Build'}</h3>
              <p className="text-sm" style={{ color: activeTheme.textMuted }}>Version: {b.versionName} ({b.versionCode})</p>
              <div className="flex gap-2 mt-2">
                <span className="px-2 py-1 text-[10px] font-bold rounded uppercase" style={{ backgroundColor: `${PRIMARY_BLUE}15`, color: PRIMARY_BLUE }}>{os}</span>
                <span className="px-2 py-1 text-[10px] font-bold rounded uppercase" style={{ backgroundColor: b.status === 'processed' ? `${SUCCESS}15` : `${WARNING}15`, color: b.status === 'processed' ? SUCCESS : WARNING }}>{b.status}</span>
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
              <div className="w-20 h-20 rounded-full flex items-center justify-center text-2xl font-black" style={{ backgroundColor: `18`, color: contextColor }}>
                {name.charAt(0).toUpperCase() || '?'}
              </div>
            )}
            <div className="text-center">
              <h3 className="text-xl font-bold" style={{ color: activeTheme.text }}>{name}</h3>
              <p className="text-sm" style={{ color: activeTheme.textMuted }}>{email}</p>
            </div>
            <div className="flex flex-wrap justify-center gap-1.5 mt-1">
              <span className="px-2.5 py-1 text-[9px] font-bold rounded-full uppercase" style={{ backgroundColor: `18`, color: contextColor }}>{contextLabel}</span>
              <span className="px-2.5 py-1 text-[9px] font-bold rounded-full uppercase" style={{ backgroundColor: `${PRIMARY_BLUE}12`, color: PRIMARY_BLUE }}>{isSSO ? 'FEDERATED' : 'STANDARD LOGIN'}</span>
              {language && <span className="px-2.5 py-1 text-[9px] font-bold rounded-full uppercase border" style={{ color: activeTheme.textMuted, borderColor: activeTheme.border }}>{language.toUpperCase()}</span>}
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
                    <OsIcon platform="apple" size={16} color={OFFICIAL_OS_COLORS.apple}/>
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
    <div className="w-full overflow-x-hidden min-h-screen flex flex-col font-sans transition-colors duration-300" style={{ backgroundColor: activeTheme.bg, color: activeTheme.text }}>
      {/* ── TOP BAR — h-16 (64px) matching Applivery UEM console ── */}
      <nav className="h-[64px] min-h-[64px] flex items-center justify-between pl-4 pr-4 z-50 shrink-0 relative" style={{ backgroundColor: PRIMARY_BLUE }}>

        {/* Left: brand + nav tabs + gear right after Reporting */}
        <div className="flex items-center h-full">
          <div className="flex items-center gap-3 mr-4 shrink-0">
            <img src="https://dashboard.applivery.io/images/logo-combined-white.svg" className="w-[143px] h-[30px] object-contain block" alt="Applivery" />
            <div className="h-5 w-px bg-white/30" />
            <span className="text-[26px] text-white/90 select-none" style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 300, letterSpacing: '-0.5px' }}>Big Picture</span>
          </div>

          {/* Nav items — h-10 per Applivery UEM spec */}
          <div className="flex items-center h-full gap-4">
            {[
              { view: 'overview',   Icon: LayoutGrid, label: 'Overview'   },
              { view: 'playground', Icon: Globe,       label: 'Playground' },
              { view: 'reporting',  Icon: FileText,    label: 'Reporting'  },
            ].map(({ view, Icon, label }) => (
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

        {/* Right: status pill + theme toggle + workspace */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex items-center gap-1.5 bg-black/20 pl-2.5 pr-3 py-1 rounded-full border border-white/10 hidden sm:flex">
            <div className={`h-1.5 w-1.5 rounded-full ${connectionStatus === 'ONLINE' ? 'bg-emerald-400 shadow-[0_0_6px_#34d399]' : 'bg-red-500'}`} />
            <span className="text-[9px] font-bold uppercase tracking-widest text-white/90 -mr-[0.1em]">{connectionStatus}</span>
          </div>
          
          <div className="relative flex items-center">
            <button onClick={() => { setIsThemeMenuOpen(!isThemeMenuOpen); setIsWorkspaceMenuOpen(false); }} className="flex items-center justify-center w-9 h-9 rounded-md transition hover:bg-white/20 text-white/80 hover:text-white">
              {themeMode === 'light' ? <Sun size={17} strokeWidth={1.5}/> : themeMode === 'dark' ? <Moon size={17} strokeWidth={1.5}/> : <Monitor size={17} strokeWidth={1.5}/>}
            </button>
            {isThemeMenuOpen && (
              <div className="absolute right-0 top-full mt-2 w-48 rounded-xl shadow-xl overflow-hidden z-[200] border" style={{ backgroundColor: activeTheme.card, borderColor: activeTheme.border }}>
                {[
                  { mode: 'system', Icon: Monitor, label: 'System default' },
                  { mode: 'light',  Icon: Sun,     label: 'Light mode'     },
                  { mode: 'dark',   Icon: Moon,    label: 'Dark mode'      },
                ].map(({ mode, Icon, label }, idx) => (
                  <button key={mode} onClick={() => { setThemeMode(mode); setIsThemeMenuOpen(false); }}
                    className={`w-full text-left px-4 py-3 text-sm flex items-center gap-3 hover:bg-black/5 transition-colors  ''`}
                    style={{ color: activeTheme.text, borderColor: activeTheme.border }}>
                    <Icon size={14}/> {label} {themeMode === mode && <Check size={13} className="ml-auto text-blue-500"/>}
                  </button>
                ))}
              </div>
            )}
          </div>

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
              <div className="absolute right-0 top-full mt-2 w-72 rounded-xl shadow-xl overflow-hidden z-[200] border flex flex-col" style={{ backgroundColor: activeTheme.card, borderColor: activeTheme.border }}>
                <div className="p-2">
                  <button onClick={handleLogout} className="w-full text-left p-3 flex items-center justify-between rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors group">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full flex items-center justify-center uppercase bg-emerald-800 text-emerald-200/80 text-sm hue-rotate-30 shrink-0">
                        {currentUser ? userInitials : '??'}
                      </div>
                      <div className="flex flex-col min-w-0">
                        <span className="text-[15px] font-normal truncate" style={{ color: activeTheme.text }}>{currentUser?.name || 'Loading user...'}</span>
                        <span className="text-[13px] truncate" style={{ color: activeTheme.textMuted }}>{currentUser?.email || ''}</span>
                      </div>
                    </div>
                    <svg viewBox="0 0 24 24" width="1.2em" height="1.2em" style={{ color: activeTheme.textMuted }} className="group-hover:text-[#0055FF] transition-colors shrink-0 ml-2">
                      <path fill="currentColor" d="M13 3h-2v10h2zm4.83 2.17l-1.42 1.42A6.94 6.94 0 0 1 19 12a7 7 0 0 1-7 7A6.995 6.995 0 0 1 7.58 6.58L6.17 5.17a9 9 0 0 0-1.03 12.69c3.22 3.78 8.9 4.24 12.69 1.02A9 9 0 0 0 21 12c0-2.63-1.16-5.13-3.17-6.83"></path>
                    </svg>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </nav>

      <div className="fixed left-0 top-[64px] bottom-0 w-4 z-[140]" onMouseEnter={() => setIsSegmentPanelOpen(true)} />

      <div onMouseLeave={() => setIsSegmentPanelOpen(false)} className={"fixed left-0 top-[64px] bottom-0 w-80 shadow-2xl z-[150] transform transition-transform duration-300 flex flex-col border-r " + (isSegmentPanelOpen ? "translate-x-0" : "-translate-x-full")} style={{ backgroundColor: activeTheme.card, borderColor: activeTheme.border }}>
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
              <input type="text" placeholder="Search segments..." value={segmentSearch} onChange={e => setSegmentSearch(e.target.value)} className="w-full pl-9 pr-4 py-2 rounded-lg text-sm border outline-none focus:border-blue-500 transition-colors bg-transparent" style={{ borderColor: activeTheme.border, color: activeTheme.text }} />
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
        <main className="p-8 flex-1 relative overflow-y-auto">
          <div ref={gridRef} style={{ width: '100%' }}>
          <header className="flex justify-between items-start mb-8">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h1 className="text-xl font-medium text-slate-500 leading-none">Overview</h1>
                {selectedSegment && selectedSegment.id !== 0 && (
                  <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium" style={{ backgroundColor: `${PRIMARY_BLUE}12`, color: PRIMARY_BLUE }}>
                    <Layers size={10}/> {selectedSegment.name}
                  </span>
                )}
              </div>
              <p className="text-sm font-medium mt-1" style={{ color: activeTheme.textMuted }}>
                {selectedSegment && selectedSegment.id !== 0
                  ? `Filtered to segment: ${selectedSegment.name}`
                  : 'Design your perfect real-time dashboard.'}
              </p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => openBuilder()} className="flex items-center gap-2 hover:bg-black/5 dark:hover:bg-white/5 px-4 py-2 rounded-lg font-medium text-sm transition-colors border" style={{ color: activeTheme.text, borderColor: activeTheme.border }}>
                <Plus size={16} /> Add Widget
              </button>
              {hasUnsavedChanges && (
                <button onClick={saveDashboard} disabled={isSaving || saveSuccess} className={`flex items-center gap-2 px-5 py-2 rounded-lg font-medium text-sm transition-colors ${saveSuccess ? 'bg-emerald-600 text-white' : 'bg-[#0055FF] text-white hover:bg-blue-600'}`}>
                  <Save size={16} /> {isSaving ? 'Saving...' : saveSuccess ? 'Saved' : 'Save Changes'}
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
               const isTrend = ['stats_downloads_trend', 'stats_builds_trend', 'stats_devices_trend'].includes(w.stat);
               const isLocked = dashboard.layout.find(l => l.i === w.id)?.static;
               return (
                <div key={w.id} className="rounded-2xl flex flex-col overflow-hidden group transition-colors duration-300" style={{ backgroundColor: activeTheme.card, border: `1px solid ${activeTheme.border}`, boxShadow: isDark ? 'none' : '0 1px 4px rgba(0,0,0,0.05), 0 0 0 0.5px rgba(0,0,0,0.04)' }}>
                  <div className={`px-5 pt-4 pb-1 flex justify-between items-center transition-colors ${isLocked ? '' : 'drag-handle cursor-move'}`}>
                    <div className="flex items-baseline gap-2 cursor-pointer hover:opacity-70" onClick={() => { if(dataBlock.items?.length > 0) handleChartClick(w); }}>
                       <span className="text-[13px] font-medium" style={{ color: activeTheme.textMuted }}>{w.title}</span>
                       {isTrend && <span className="text-[10px]" style={{ color: activeTheme.textMuted }}>last 30 days</span>}
                    </div>
                    <div className="flex items-center gap-4">
                       {isTrend && dataBlock.trendData?.os_totals && (
                          <div className="flex items-center gap-3">
                             {dataBlock.trendData.os_totals.apple > 0 && <div className="flex items-center gap-1 text-[11px] font-bold" style={{color: OFFICIAL_OS_COLORS.apple}}><OsIcon platform="apple" size={14} color={OFFICIAL_OS_COLORS.apple}/> {dataBlock.trendData.os_totals.apple}</div>}
                             {dataBlock.trendData.os_totals.android > 0 && <div className="flex items-center gap-1 text-[11px] font-bold" style={{color: OFFICIAL_OS_COLORS.android}}><OsIcon platform="android" size={14} color={OFFICIAL_OS_COLORS.android}/> {dataBlock.trendData.os_totals.android}</div>}
                             {dataBlock.trendData.os_totals.windows > 0 && <div className="flex items-center gap-1 text-[11px] font-bold" style={{color: OFFICIAL_OS_COLORS.windows}}><OsIcon platform="windows" size={14} color={OFFICIAL_OS_COLORS.windows}/> {dataBlock.trendData.os_totals.windows}</div>}
                          </div>
                       )}
                      <div className="flex items-center gap-3 opacity-0 group-hover:opacity-100 transition-opacity ml-2">
                        <button onClick={() => toggleLock(w.id)} className="hover:text-blue-500 transition-colors" style={{ color: activeTheme.textMuted }}>
                          {isLocked ? <Lock size={14} /> : <Unlock size={14} />}
                        </button>
                        <button onClick={() => openBuilder(w)} className="hover:text-blue-500 transition-colors" style={{ color: activeTheme.textMuted }}><Edit3 size={14} /></button>
                        <button onClick={() => removeWidget(w.id)} className="hover:text-red-500 transition-colors" style={{ color: activeTheme.textMuted }}><Trash2 size={14} /></button>
                        {!isLocked && <GripHorizontal size={14} style={{ color: activeTheme.textMuted }} />}
                      </div>
                    </div>
                  </div>
                  <div className="flex-1 px-5 pb-5 pt-1 relative">
                    {renderWidgetContent(w)}
                  </div>
                </div>
               )
            })}
          </Responsive>
          )}
          </div>
        </main>
      )}

      {currentView === 'playground' && (
        <main className="flex-1 relative flex flex-col overflow-hidden" style={{ backgroundColor: '#020817' }}>
          {/* Playground header bar */}
          <div className="shrink-0 flex items-center justify-between px-6 py-3 border-b z-10" style={{ borderColor: 'rgba(255,255,255,0.07)', backgroundColor: 'rgba(2,8,23,0.8)', backdropFilter: 'blur(12px)' }}>
            <div className="flex items-center gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <Globe size={15} className="text-blue-400"/>
                  <span className="text-sm font-semibold text-white">Playground</span>
                </div>
                <p className="text-[11px] text-white/40 mt-0.5">Live 3D visualization — {globeDevices.length} devices tracked</p>
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
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-2 cursor-pointer px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all border" style={{ color: showOnlyNonCompliantGlobe ? '#EF4444' : 'rgba(255,255,255,0.6)', borderColor: showOnlyNonCompliantGlobe ? '#EF444440' : 'rgba(255,255,255,0.1)', backgroundColor: showOnlyNonCompliantGlobe ? '#EF444415' : 'rgba(255,255,255,0.05)' }}>
                <input type="checkbox" checked={showOnlyNonCompliantGlobe} onChange={(e) => setShowOnlyNonCompliantGlobe(e.target.checked)} className="w-3 h-3 rounded border-gray-600 text-red-500 focus:ring-red-500" />
                Non-Compliant Only
              </label>
              <button onClick={handleSyncLocations} disabled={isSyncingLocations} className="flex items-center gap-2 px-3 py-1.5 rounded-lg font-medium text-[11px] transition-all border border-white/10 hover:bg-white/10" style={{ color: 'rgba(255,255,255,0.7)', backgroundColor: 'rgba(255,255,255,0.05)' }}>
                {isSyncingLocations ? <RefreshCw size={12} className="animate-spin text-blue-400"/> : <MapPin size={12} className="text-blue-400"/>}
                {isSyncingLocations ? 'Syncing...' : 'Sync Locations'}
              </button>
            </div>
          </div>
          {/* Globe fills remaining space edge-to-edge */}
          <div className="flex-1 relative">
            {isLoadingGlobe ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ backgroundColor: '#020817' }}>
                <div className="w-10 h-10 border-2 border-blue-500/20 border-t-blue-500 rounded-full animate-spin mb-4" />
                <span className="text-sm font-medium text-white/40 uppercase tracking-widest">Loading fleet data…</span>
              </div>
            ) : globeDevices.length > 0 ? (
              <div className="absolute inset-0">
                <GlobeWidget
                  items={showOnlyNonCompliantGlobe ? globeDevices.filter(d => d.is_compliant_normalized === false) : globeDevices}
                  activeTheme={activeTheme}
                  onDeviceClick={(item) => openInsight(item)}
                  filterActive={showOnlyNonCompliantGlobe}
                  totalDevices={globeDevices.length}
                />
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
        <main className="p-8 flex-1 relative overflow-y-auto custom-scrollbar">
          <header className="mb-6 flex items-start justify-between flex-wrap gap-4">
            <div>
              <h1 className="text-xl font-medium text-slate-500 leading-none mb-1">Reporting</h1>
              <p className="text-sm font-medium mt-1" style={{ color: activeTheme.textMuted }}>Build, schedule, and manage automated reports.</p>
            </div>
            {/* Builder / Schedules / Template tab switcher */}
            <div className="flex items-center gap-1 p-1 rounded-xl border" style={{ backgroundColor: activeTheme.bg, borderColor: activeTheme.border }}>
              {[
                { id: 'builder',   label: 'Builder',    Icon: FileText  },
                { id: 'scheduled', label: `Schedules${scheduledReports.length ? ` (${scheduledReports.length})` : ''}`, Icon: Calendar },
                { id: 'template',  label: 'Template',   Icon: Code },
              ].map(({ id, label, Icon }) => (
                <button key={id} onClick={() => setReportingTab(id)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all"
                style={{
                  backgroundColor: reportingTab === id ? activeTheme.card : 'transparent',
                  color: reportingTab === id ? PRIMARY_BLUE : activeTheme.textMuted,
                  boxShadow: reportingTab === id ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                }}
              >
                <Icon size={14} className={id === 'template' ? 'text-blue-500' : ''}/> {label}
              </button>
            ))}
            </div>
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
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase shrink-0" style={{ backgroundColor: `${PRIMARY_BLUE}15`, color: PRIMARY_BLUE }}>{freqLabel}</span>
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
                      <button title="Edit" onClick={() => { setReportConfig({ ...sr }); setEditingReportId(sr.id); setReportingTab('builder'); }}
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
                <button onClick={() => { setReportConfig(_blankReportConfig()); setEditingReportId(null); setReportingTab('builder'); }}
                  className="w-full py-3 rounded-xl border font-medium text-sm flex items-center justify-center gap-2 hover:opacity-70 transition-opacity" style={{ borderColor: activeTheme.border, color: activeTheme.textMuted }}>
                  <Plus size={15}/> Add Another Schedule
                </button>
              )}
            </div>
          )}

          {/* ── BUILDER ── */}
          {reportingTab === 'builder' && (
          <div className="max-w-4xl mx-auto space-y-8 pb-12">
            {/* Report name + cancel edit */}
            <div className="flex items-center gap-3">
              <input type="text" placeholder="Report name (e.g. Weekly Compliance)" value={reportConfig.name || ''} onChange={e => setReportConfig({ ...reportConfig, name: e.target.value })}
                className="flex-1 rounded-xl px-4 py-3 text-sm border outline-none focus:border-blue-500 transition-colors font-medium"
                style={{ backgroundColor: activeTheme.card, borderColor: activeTheme.border, color: activeTheme.text }} />
              {editingReportId && (
                <button onClick={() => { setEditingReportId(null); setReportConfig(_blankReportConfig()); }}
                  className="px-4 py-3 rounded-xl text-sm font-medium border transition-colors hover:opacity-70" style={{ color: DANGER, borderColor: `${DANGER}30` }}>
                  Cancel Edit
                </button>
              )}
            </div>
            <section className="p-6 rounded-2xl border shadow-sm" style={{ backgroundColor: activeTheme.card, borderColor: activeTheme.border }}>
              <h2 className="text-sm font-bold uppercase tracking-widest mb-4" style={{ color: activeTheme.textMuted }}>1. Select Data Sources</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {CATALOG.flatMap(g => g.items).filter(i => SOURCE_SHAPES[i.stat] !== 'orgProfile').map(item => (
                  <label key={item.stat} className="flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors hover:border-blue-500" style={{ backgroundColor: activeTheme.bg, borderColor: reportConfig.sources.includes(item.stat) ? PRIMARY_BLUE : activeTheme.border }}>
                    <input type="checkbox" className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" checked={reportConfig.sources.includes(item.stat)} onChange={(e) => { const newSources = e.target.checked ? [...reportConfig.sources, item.stat] : reportConfig.sources.filter(s => s !== item.stat); setReportConfig({...reportConfig, sources: newSources}); }} />
                    <item.icon size={16} style={{ color: reportConfig.sources.includes(item.stat) ? PRIMARY_BLUE : activeTheme.textMuted }} />
                    <span className="text-sm font-medium" style={{ color: activeTheme.text }}>{item.label}</span>
                  </label>
                ))}
              </div>
            </section>
            <section className="p-6 rounded-2xl border shadow-sm" style={{ backgroundColor: activeTheme.card, borderColor: activeTheme.border }}>
              <h2 className="text-sm font-bold uppercase tracking-widest mb-4" style={{ color: activeTheme.textMuted }}>2. Time Lapse</h2>
              <select value={reportConfig.timeLapse} onChange={e => setReportConfig({...reportConfig, timeLapse: e.target.value})} className="w-full max-w-md rounded-xl px-4 py-3 outline-none text-sm border focus:border-blue-500 transition-colors" style={{ backgroundColor: activeTheme.bg, color: activeTheme.text, borderColor: activeTheme.border }}>
                <option value="Last 7 Days">Last 7 Days</option><option value="Last 30 Days">Last 30 Days</option><option value="All Time">All Time</option>
              </select>
            </section>
            <section className="p-6 rounded-2xl border shadow-sm" style={{ backgroundColor: activeTheme.card, borderColor: activeTheme.border }}>
              <h2 className="text-sm font-bold uppercase tracking-widest mb-4" style={{ color: activeTheme.textMuted }}>3. Apply Filters</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-xs font-medium mb-2" style={{ color: activeTheme.textMuted }}>Operating System</label>
                  <select value={reportConfig.filters.type} onChange={e => setReportConfig({...reportConfig, filters: {...reportConfig.filters, type: e.target.value}})} className="w-full rounded-lg px-3 py-2.5 text-sm border outline-none focus:border-blue-500" style={{ backgroundColor: activeTheme.bg, color: activeTheme.text, borderColor: activeTheme.border }}>
                    <option value="all">All OS</option><option value="apple">iOS / macOS</option><option value="android">Android</option><option value="windows">Windows</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-2" style={{ color: activeTheme.textMuted }}>Compliance Status</label>
                  <select value={reportConfig.filters.complianceStatus} onChange={e => setReportConfig({...reportConfig, filters: {...reportConfig.filters, complianceStatus: e.target.value}})} className="w-full rounded-lg px-3 py-2.5 text-sm border outline-none focus:border-blue-500" style={{ backgroundColor: activeTheme.bg, color: activeTheme.text, borderColor: activeTheme.border }}>
                    <option value="all">All devices</option><option value="compliant">Compliant only</option><option value="non_compliant">Non-compliant only</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-2" style={{ color: activeTheme.textMuted }}>Role</label>
                  <select value={reportConfig.filters.role} onChange={e => setReportConfig({...reportConfig, filters: {...reportConfig.filters, role: e.target.value}})} className="w-full rounded-lg px-3 py-2.5 text-sm border outline-none focus:border-blue-500" style={{ backgroundColor: activeTheme.bg, color: activeTheme.text, borderColor: activeTheme.border }}>
                    <option value="all">All roles</option><option value="owner">Owner</option><option value="admin">Admin</option><option value="editor">Editor</option><option value="viewer">Viewer</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-2" style={{ color: activeTheme.textMuted }}>Auth Origin</label>
                  <select value={reportConfig.filters.authOrigin} onChange={e => setReportConfig({...reportConfig, filters: {...reportConfig.filters, authOrigin: e.target.value}})} className="w-full rounded-lg px-3 py-2.5 text-sm border outline-none focus:border-blue-500" style={{ backgroundColor: activeTheme.bg, color: activeTheme.text, borderColor: activeTheme.border }}>
                    <option value="all">All origins</option><option value="dashboard">Dashboard</option><option value="sso">SSO</option>
                  </select>
                </div>
                <div className="col-span-1 md:col-span-2 pt-2">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input type="checkbox" checked={reportConfig.filters.inactive24h} onChange={e => setReportConfig({...reportConfig, filters: {...reportConfig.filters, inactive24h: e.target.checked}})} className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                    <span className="text-sm font-medium" style={{ color: activeTheme.text }}>Hide devices not reported in last 24h</span>
                  </label>
                </div>
              </div>
            </section>
            <section className="p-6 rounded-2xl border shadow-sm" style={{ backgroundColor: activeTheme.card, borderColor: activeTheme.border }}>
              <h2 className="text-sm font-bold uppercase tracking-widest mb-4" style={{ color: activeTheme.textMuted }}>4. Display Options</h2>
              <div className="flex flex-col gap-5 max-w-md">
                <div className="space-y-3">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input type="checkbox" checked={reportConfig.display.trend} onChange={e => setReportConfig({...reportConfig, display: {...reportConfig.display, trend: e.target.checked}})} className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                    <TrendingUp size={16} style={{ color: activeTheme.textMuted }} />
                    <span className="text-sm font-medium" style={{ color: activeTheme.text }}>Include Trend Charts</span>
                  </label>
                  {reportConfig.display.trend && (
                    <div className="pl-9 flex items-center gap-3 animate-in fade-in slide-in-from-top-1">
                      <span className="text-xs font-medium" style={{ color: activeTheme.textMuted }}>Type:</span>
                      <select value={reportConfig.display.trend_type || 'line'} onChange={e => setReportConfig({...reportConfig, display: {...reportConfig.display, trend_type: e.target.value}})} className="rounded-lg px-3 py-1.5 outline-none text-xs border focus:border-blue-500 transition-colors cursor-pointer" style={{ backgroundColor: activeTheme.bg, color: activeTheme.text, borderColor: activeTheme.border }}>
                        <option value="line">Line Graph</option><option value="bar">Bar Chart</option>
                      </select>
                    </div>
                  )}
                </div>
                <div className="space-y-3">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input type="checkbox" checked={reportConfig.display.donut} onChange={e => setReportConfig({...reportConfig, display: {...reportConfig.display, donut: e.target.checked}})} className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                    <PieIcon size={16} style={{ color: activeTheme.textMuted }} />
                    <span className="text-sm font-medium" style={{ color: activeTheme.text }}>Include Distribution Charts</span>
                  </label>
                  {reportConfig.display.donut && (
                    <div className="pl-9 flex items-center gap-3 animate-in fade-in slide-in-from-top-1">
                      <span className="text-xs font-medium" style={{ color: activeTheme.textMuted }}>Type:</span>
                      <select value={reportConfig.display.donut_type || 'donut'} onChange={e => setReportConfig({...reportConfig, display: {...reportConfig.display, donut_type: e.target.value}})} className="rounded-lg px-3 py-1.5 outline-none text-xs border focus:border-blue-500 transition-colors cursor-pointer" style={{ backgroundColor: activeTheme.bg, color: activeTheme.text, borderColor: activeTheme.border }}>
                        <option value="donut">Donut Chart</option><option value="pie">Solid Pie Chart</option><option value="bar">Bar Chart</option><option value="radar">Radar Chart</option>
                      </select>
                    </div>
                  )}
                </div>
                <div className="space-y-3 mt-1">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input type="checkbox" checked={reportConfig.display.table} onChange={e => setReportConfig({...reportConfig, display: {...reportConfig.display, table: e.target.checked}})} className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                    <List size={16} style={{ color: activeTheme.textMuted }} />
                    <span className="text-sm font-medium" style={{ color: activeTheme.text }}>Include Data Tables</span>
                  </label>
                  {reportConfig.display.table && (
                    <div className="pl-9 flex items-center gap-3 animate-in fade-in slide-in-from-top-1">
                      <span className="text-xs font-medium" style={{ color: activeTheme.textMuted }}>Type:</span>
                      <select value={reportConfig.display.table_type || 'standard'} onChange={e => setReportConfig({...reportConfig, display: {...reportConfig.display, table_type: e.target.value}})} className="rounded-lg px-3 py-1.5 outline-none text-xs border focus:border-blue-500 transition-colors cursor-pointer" style={{ backgroundColor: activeTheme.bg, color: activeTheme.text, borderColor: activeTheme.border }}>
                        <option value="standard">Standard Table</option><option value="progress">Progress Bars</option>
                      </select>
                    </div>
                  )}
                </div>
              </div>
            </section>
            <section className="p-6 rounded-2xl border shadow-sm" style={{ backgroundColor: activeTheme.card, borderColor: activeTheme.border }}>
              <h2 className="text-sm font-bold uppercase tracking-widest mb-4" style={{ color: activeTheme.textMuted }}>5. Delivery Methods</h2>
              <div className="flex flex-col gap-4 max-w-md">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" checked={reportConfig.delivery.download} onChange={e => setReportConfig({...reportConfig, delivery: {...reportConfig.delivery, download: e.target.checked}})} className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                  <Download size={16} style={{ color: activeTheme.textMuted }} />
                  <span className="text-sm font-medium" style={{ color: activeTheme.text }}>Download PDF directly</span>
                </label>
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" checked={reportConfig.delivery.chat} onChange={e => setReportConfig({...reportConfig, delivery: {...reportConfig.delivery, chat: e.target.checked}})} className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                  <MessageCircle size={16} style={{ color: activeTheme.textMuted }} />
                  <span className="text-sm font-medium" style={{ color: activeTheme.text }}>Send alert to Webhook</span>
                </label>
                {reportConfig.delivery.chat && !webhookUrl && (
                  <span className="text-xs text-red-500 ml-7">Warning: No Webhook URL configured in Settings.</span>
                )}
              </div>
							{/* Add this right underneath your Google Chat delivery option */}
						  <div className="space-y-3">
							  <label className="flex items-center gap-3 cursor-pointer">
								  <input type="checkbox" checked={reportConfig.delivery.email} onChange={e => setReportConfig({...reportConfig, delivery: {...reportConfig.delivery, email: e.target.checked}})} className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
								  <Mail size={16} style={{ color: activeTheme.textMuted }} />
								  <span className="text-sm font-medium" style={{ color: activeTheme.text }}>Send via Email</span>
							  </label>
								{reportConfig.delivery.email && (
								  <div className="pl-9 animate-in fade-in slide-in-from-top-1">
								    <input type="text" placeholder="team@example.com, boss@example.com" value={reportConfig.emailRecipients} onChange={e => setReportConfig({...reportConfig, emailRecipients: e.target.value})} className="w-full rounded-lg px-3 py-2 text-sm border focus:border-blue-500 transition-colors outline-none" style={{ backgroundColor: activeTheme.bg, borderColor: activeTheme.border, color: activeTheme.text }} />
								    {(!smtpConfig.host || !smtpConfig.user) && <span className="text-xs text-red-500 mt-1 block">Warning: SMTP not configured in global Settings.</span>}
								    </div>
								  )}
								</div>
            </section>
					  {/* New Section 6: Scheduling */}
						<section className="p-6 rounded-2xl border shadow-sm transition-all" style={{ backgroundColor: activeTheme.card, borderColor: reportConfig.schedule.enabled ? PRIMARY_BLUE : activeTheme.border }}>
							<div className="flex items-center justify-between">
								 <div>
									  <h2 className="text-sm font-bold uppercase tracking-widest" style={{ color: activeTheme.textMuted }}>6. Automation & Scheduling</h2>
									  <p className="text-xs mt-1" style={{ color: activeTheme.textMuted }}>Run this exact report automatically on a recurring schedule.</p>
								 </div>
								 <label className="flex items-center gap-2 cursor-pointer bg-black/5 dark:bg-white/5 px-3 py-1.5 rounded-lg">
									  <span className="text-xs font-bold" style={{ color: activeTheme.text }}>{reportConfig.schedule.enabled ? 'ENABLED' : 'DISABLED'}</span>
									  <input type="checkbox" checked={reportConfig.schedule.enabled} onChange={e => setReportConfig({...reportConfig, schedule: {...reportConfig.schedule, enabled: e.target.checked}})} className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
								 </label>
							</div>
              
						  {reportConfig.schedule.enabled && (
								<div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6 pt-6 border-t animate-in fade-in slide-in-from-top-2" style={{ borderColor: activeTheme.border }}>
									 <div>
									    <label className="block text-xs font-medium mb-2" style={{ color: activeTheme.textMuted }}>Frequency</label>
									    <select value={reportConfig.schedule.frequency} onChange={e => setReportConfig({...reportConfig, schedule: {...reportConfig.schedule, frequency: e.target.value}})} className="w-full rounded-lg px-3 py-2.5 text-sm border outline-none focus:border-blue-500" style={{ backgroundColor: activeTheme.bg, color: activeTheme.text, borderColor: activeTheme.border }}>
									       <option value="daily">Daily</option>
									       <option value="weekly">Weekly (Mondays)</option>
									       <option value="monthly">Monthly (1st)</option>
									    </select>
									 </div>
									 <div>
									    <label className="block text-xs font-medium mb-2" style={{ color: activeTheme.textMuted }}>Execution Time ({reportConfig.schedule.timezone || 'UTC'})</label>
									    <input type="time" value={reportConfig.schedule.time || '09:00'} onChange={e => setReportConfig({...reportConfig, schedule: {...reportConfig.schedule, time: e.target.value}})} className="w-full rounded-lg px-3 py-2.5 text-sm border outline-none focus:border-blue-500" style={{ backgroundColor: activeTheme.bg, color: activeTheme.text, borderColor: activeTheme.border }} />
									 </div>
									 <div>
									    <label className="block text-xs font-medium mb-2" style={{ color: activeTheme.textMuted }}>Start Date</label>
									    <input type="date" value={reportConfig.schedule.startDate || ''} onChange={e => setReportConfig({...reportConfig, schedule: {...reportConfig.schedule, startDate: e.target.value}})} className="w-full rounded-lg px-3 py-2.5 text-sm border outline-none focus:border-blue-500" style={{ backgroundColor: activeTheme.bg, color: activeTheme.text, borderColor: activeTheme.border }} />
									 </div>
								</div>
							)}
						</section>			            
            {/* Action buttons */}
            <div className="flex justify-end gap-3 pt-4">
              {/* Save Schedule — only shown when scheduling is enabled */}
              {reportConfig.schedule.enabled && (
                <button
                  onClick={() => {
                    const saved = { ...reportConfig, id: editingReportId || `sched_${Date.now()}`, name: reportConfig.name || `Report ${scheduledReports.length + 1}` };
                    if (editingReportId) {
                      setScheduledReports(prev => prev.map(r => r.id === editingReportId ? saved : r));
                    } else {
                      setScheduledReports(prev => [...prev, saved]);
                    }
                    setEditingReportId(null);
                    setReportConfig(_blankReportConfig());
                    setReportingTab('scheduled');
                  }}
                  className="flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-sm border transition-colors hover:opacity-80"
                  style={{ color: PRIMARY_BLUE, borderColor: PRIMARY_BLUE, backgroundColor: `${PRIMARY_BLUE}10` }}
                >
                  <Calendar size={16}/> {editingReportId ? 'Update Schedule' : 'Save Schedule'}
                </button>
              )}
              {/* Generate Now — always available */}
              <button
                onClick={async () => {
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
                  } catch (err) {
                    console.error("Report generation failed", err);
                    alert("Failed to generate report.");
                  } finally { setIsGeneratingReport(false); }
                }}
                disabled={isGeneratingReport}
                className="bg-[#0055FF] hover:bg-blue-600 disabled:opacity-50 px-8 py-3 rounded-xl font-semibold text-sm text-white transition-colors flex items-center gap-2 shadow-lg"
              >
                {isGeneratingReport ? <Activity size={16} className="animate-spin"/> : <FileText size={16}/>}
                {isGeneratingReport ? 'Generating...' : 'Generate Now'}
              </button>
            </div>
          </div>
          )} {/* end builder tab */}
        </main>
      )}

      {selectedWidgetItems && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-2xl flex flex-col max-h-[85vh] transition-colors duration-300 shadow-2xl" style={{ backgroundColor: activeTheme.card, border: `1px solid ${activeTheme.border}` }}>
            <div className="flex justify-between items-center p-6 border-b shrink-0" style={{ borderColor: activeTheme.border }}>
              <div>
                <h2 className="text-xl font-bold" style={{ color: activeTheme.text }}>{selectedWidgetItems.title}</h2>
                <p className="text-xs mt-1" style={{ color: activeTheme.textMuted }}>{selectedWidgetItems.items.length} items found</p>
              </div>
              <button onClick={() => setSelectedWidgetItems(null)} className="hover:text-red-500 transition-colors" style={{ color: activeTheme.textMuted }}><X size={20} /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2 custom-scrollbar">
              {selectedWidgetItems.items.map((item, idx) => {
                const isBuild = item.versionName !== undefined && (item.applicationInfo !== undefined || item.os !== undefined || item.originalExtension !== undefined);
                const isDownload = item.member !== undefined && item.networkInfo !== undefined;
                const getDisplayName = (item) => {
                  if (item.display_name) return item.display_name;
                  if (item.type_normalized === 'segment') return item.name || 'Unnamed Segment';
                  if (isBuild) return item.applicationInfo?.name || item.application || 'Unknown App';
                  if (isDownload) return `${item.member?.firstName || ''} ${item.member?.lastName || ''}`.trim() || item.member?.email || 'Unknown Downloader';
                  // Enterprise apps have item.name directly; store users use employee{}
                  const target = item.user || item.employee || item;
                  if (target.firstName || target.lastName) return `${target.firstName || ''} ${target.lastName || ''}`.trim();
                  if (target.name) return target.name;
                  if (item.name) return item.name;
                  if (item.displayName) return item.displayName;
                  return target.email || item.email || item.summary?.model || 'Unknown Item';
                };
                const label = getDisplayName(item);
                let subLabel = '';
                if (item.type_normalized === 'segment') { subLabel = `ID: ${item.id} - Children: ${item.children?.length || 0}`; } 
                else if (isBuild) { subLabel = `Version: ${item.versionName} (${item.versionCode}) - OS: ${item.os || 'Unknown'}`; } 
                else if (isDownload) { subLabel = `IP: ${item.networkInfo?.ip || 'N/A'} - ${item.applicationInfo?.name || 'App'}`; } 
                else {
                  // Enterprise apps → show OS platforms, not role
                  if (item.oss && Array.isArray(item.oss)) {
                    subLabel = item.oss.join(' · ').toUpperCase();
                  } else {
                    subLabel = item.display_email || item.email || item.user?.email || item.employee?.email || item.platform_normalized || item.summary?.osVersion || '';
                  }
                }
                const iconToUse = isBuild ? <Box size={18} /> : isDownload ? <Download size={18} /> : item.type_normalized === 'segment' ? <Layout size={18} /> : <List size={18} />;
                return (
                  <div key={item.id || item._id || idx} onClick={() => openInsight(item)} className="p-4 rounded-xl flex items-center justify-between cursor-pointer transition-colors hover:border-blue-500" style={{ backgroundColor: activeTheme.bg, border: `1px solid ${activeTheme.border}` }}>
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ backgroundColor: `${PRIMARY_BLUE}15`, color: PRIMARY_BLUE }}>{iconToUse}</div>
                      <div className="flex flex-col">
                        <span className="font-medium text-sm" style={{ color: activeTheme.text }}>{label}</span>
                        {subLabel && <span className="text-xs mt-0.5 uppercase" style={{ color: activeTheme.textMuted }}>{subLabel}</span>}
                      </div>
                    </div>
                    <ChevronRight size={18} style={{ color: activeTheme.textMuted }} />
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {activeInsight && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-xl rounded-2xl flex flex-col max-h-[85vh] transition-colors duration-300 shadow-2xl" style={{ backgroundColor: activeTheme.card, border: `1px solid ${activeTheme.border}` }}>
            <div className="flex justify-between items-center p-6 border-b shrink-0" style={{ borderColor: activeTheme.border }}>
              <h2 className="text-xl font-bold" style={{ color: activeTheme.text }}>Details</h2>
              <button onClick={() => setActiveInsight(null)} className="hover:text-red-500 transition-colors" style={{ color: activeTheme.textMuted }}><X size={20} /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">{renderInsightContent()}</div>
          </div>
        </div>
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
                   <div className="w-20 h-20 rounded-2xl flex items-center justify-center mb-4" style={{ backgroundColor: `15` }}>
                     <Building2 size={40} className="text-blue-500" /> 
                   </div>
                 )}
                <h2 className="text-2xl font-black text-center" style={{ color: activeTheme.text }}>{selectedOrgProfile.name}</h2>
                <p className="text-sm font-medium text-center mt-1" style={{ color: activeTheme.textMuted }}>{selectedOrgProfile.slug}</p>
                <div className="flex items-center gap-3 mt-4">
                   <span className="px-3 py-1 rounded-full text-[10px] font-bold border uppercase tracking-widest" style={{ borderColor: activeTheme.border, color: activeTheme.textMuted }}>{selectedOrgProfile.type || 'Company'}</span>
                   <span className="px-3 py-1 rounded-full text-[10px] font-bold bg-blue-500 text-white uppercase tracking-widest">Plan: {selectedOrgProfile.lastPlan?.replace('-', ' ') || 'Enterprise'}</span>
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
                       <div className="flex items-center gap-2 mb-3"><OsIcon platform="apple" size={16} color={OFFICIAL_OS_COLORS.apple}/><span className="text-sm font-bold" style={{ color: activeTheme.text }}>Apple</span></div>
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

      {isBuilderOpen && editingWidget && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 sm:p-6 overflow-y-auto">
          <div className="w-full max-w-lg rounded-2xl shadow-2xl flex flex-col transition-colors duration-300" style={{ backgroundColor: activeTheme.card, border: `1px solid ${activeTheme.border}` }}>
            <div className="flex justify-between items-center p-6 border-b shrink-0" style={{ borderColor: activeTheme.border }}>
              <h2 className="text-xl font-bold" style={{ color: activeTheme.text }}>{editingWidget.id ? 'Edit Widget' : 'Add Widget'}</h2>
              <button onClick={() => setIsBuilderOpen(false)} className="hover:text-red-500 transition-colors" style={{ color: activeTheme.textMuted }}><X size={20} /></button>
            </div>
            <div className="p-6 overflow-y-auto max-h-[70vh] flex flex-col space-y-8 custom-scrollbar">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest mb-3 block" style={{ color: activeTheme.textMuted }}>Widget Title</label>
                <input type="text" value={editingWidget.title} onChange={e => setEditingWidget({...editingWidget, title: e.target.value})} className="w-full rounded-xl px-4 py-3.5 outline-none font-medium text-sm border focus:border-blue-500 transition-colors" style={{ backgroundColor: activeTheme.bg, color: activeTheme.text, borderColor: activeTheme.border }} placeholder="e.g. Current Fleet Status" />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest mb-3 block" style={{ color: activeTheme.textMuted }}>Data Source</label>
                <div className="relative">
                  <div onClick={() => setIsSourceDropdownOpen(!isSourceDropdownOpen)} className="w-full rounded-xl px-4 py-3.5 flex justify-between items-center border cursor-pointer transition-colors" style={{ backgroundColor: activeTheme.bg, borderColor: activeTheme.border }}>
                    <span className="text-sm font-medium" style={{ color: activeTheme.text }}>{CATALOG.flatMap(g => g.items).find(i => i.stat === editingWidget.stat)?.label || 'Select a metric...'}</span>
                    <ChevronDown size={18} style={{ color: activeTheme.textMuted }} />
                  </div>
                  {isSourceDropdownOpen && (
                    <div className="absolute top-full left-0 w-full mt-2 rounded-xl shadow-xl border z-50 overflow-y-auto max-h-64 custom-scrollbar" style={{ backgroundColor: activeTheme.card, borderColor: activeTheme.border }}>
                      {CATALOG.map(group => (
                        <div key={group.group}>
                          {group.group && <div className="px-4 py-2 mt-2 text-[10px] font-bold uppercase tracking-widest" style={{ color: activeTheme.textMuted }}>{group.group}</div>}
                          {group.items.map(item => (
                            <button key={item.stat} onClick={() => selectSource(item)} className="w-full text-left px-6 py-2.5 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5 transition-colors flex items-center gap-3" style={{ color: editingWidget.stat === item.stat ? PRIMARY_BLUE : activeTheme.text }}><item.icon size={16} /> {item.label}</button>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              {(editingWidget.stat === 'mdm_devices' || editingWidget.stat === 'app_dist_apps' || editingWidget.stat === 'app_dist_collaborators' || editingWidget.stat === 'mdm_collaborators' || editingWidget.stat === 'app_dist_store_users') && (
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest mb-3 block" style={{ color: activeTheme.textMuted }}>Filters</label>
                  <div className="p-5 rounded-xl border space-y-5" style={{ backgroundColor: activeTheme.bg, borderColor: activeTheme.border }}>
                    {(editingWidget.stat === 'mdm_devices' || editingWidget.stat === 'app_dist_apps') && (
                      <div>
                        <label className="block text-xs font-medium mb-2" style={{ color: activeTheme.textMuted }}>{editingWidget.stat === 'mdm_devices' ? 'Operating System' : 'Target OS'}</label>
                        <select value={editingWidget.filters.type || 'all'} onChange={e => updateFilter('type', e.target.value)} className="w-full rounded-lg px-3 py-2.5 text-sm outline-none border focus:border-blue-500 transition-colors" style={{ backgroundColor: activeTheme.card, color: activeTheme.text, borderColor: activeTheme.border }}>
                          <option value="all">All OS</option><option value="apple">iOS / iPadOS</option><option value="macos">macOS</option><option value="android">Android</option><option value="windows">Windows</option>
                        </select>
                      </div>
                    )}
                    {editingWidget.stat === 'mdm_devices' && (
                      <>
                        <div>
                          <label className="block text-xs font-medium mb-2" style={{ color: activeTheme.textMuted }}>Compliance Status</label>
                          <select value={editingWidget.filters.complianceStatus || 'all'} onChange={e => updateFilter('complianceStatus', e.target.value)} className="w-full rounded-lg px-3 py-2.5 text-sm outline-none border focus:border-blue-500 transition-colors" style={{ backgroundColor: activeTheme.card, color: activeTheme.text, borderColor: activeTheme.border }}>
                            <option value="all">All devices</option><option value="compliant">Compliant only</option><option value="non_compliant">Non-compliant only</option>
                          </select>
                        </div>
                        <label className="flex items-center gap-3 mt-4 cursor-pointer">
                          <input type="checkbox" checked={editingWidget.filters.inactive24h || false} onChange={e => updateFilter('inactive24h', e.target.checked)} className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                          <span className="text-sm font-medium" style={{ color: activeTheme.text }}>Not reported in last 24h</span>
                        </label>
                      </>
                    )}
                    {editingWidget.stat === 'app_dist_collaborators' && (
                      <div>
                        <label className="block text-xs font-medium mb-2" style={{ color: activeTheme.textMuted }}>Role</label>
                        <select value={editingWidget.filters.role || 'all'} onChange={e => updateFilter('role', e.target.value)} className="w-full rounded-lg px-3 py-2.5 text-sm outline-none border focus:border-blue-500 transition-colors" style={{ backgroundColor: activeTheme.card, color: activeTheme.text, borderColor: activeTheme.border }}>
                          <option value="all">All roles</option><option value="owner">Owner</option><option value="admin">Admin</option><option value="editor">Editor</option><option value="viewer">Viewer</option>
                        </select>
                      </div>
                    )}
                    {(editingWidget.stat === 'app_dist_collaborators' || editingWidget.stat === 'mdm_collaborators' || editingWidget.stat === 'app_dist_store_users') && (
                      <div>
                        <label className="block text-xs font-medium mb-2" style={{ color: activeTheme.textMuted }}>Authentication Origin</label>
                        <select value={editingWidget.filters.authOrigin || 'all'} onChange={e => updateFilter('authOrigin', e.target.value)} className="w-full rounded-lg px-3 py-2.5 text-sm outline-none border focus:border-blue-500 transition-colors" style={{ backgroundColor: activeTheme.card, color: activeTheme.text, borderColor: activeTheme.border }}>
                          <option value="all">All origins</option><option value="dashboard">Dashboard</option><option value="sso">SSO</option>
                        </select>
                      </div>
                    )}
                  </div>
                </div>
              )}
              {editingWidget.stat && (
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest mb-3 block" style={{ color: activeTheme.textMuted }}>Visual Style</label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {ALL_CHART_TYPES.filter(t => SHAPES[SOURCE_SHAPES[editingWidget.stat] || 'listCountOnly'].includes(t.id)).map(type => {
                      const isSelected = editingWidget.type === type.id;
                      return (
                        <button key={type.id} onClick={() => setEditingWidget({...editingWidget, type: type.id})} className="flex flex-col items-center justify-center p-4 rounded-xl border text-left transition-colors" style={{ backgroundColor: isSelected ? `${PRIMARY_BLUE}1A` : activeTheme.bg, borderColor: isSelected ? PRIMARY_BLUE : activeTheme.border }}>
                          <div style={{ color: isSelected ? PRIMARY_BLUE : activeTheme.textMuted }}>{type.icon}</div>
                          <div className="font-bold text-[13px] mt-3" style={{ color: isSelected ? PRIMARY_BLUE : activeTheme.text }}>{type.label}</div>
                          <div className="text-[10px] leading-tight mt-1 text-center" style={{ color: activeTheme.textMuted }}>{type.desc}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              {editingWidget.stat && (
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest mb-3 block" style={{ color: activeTheme.textMuted }}>Card Size</label>
                  <div className="flex gap-3">
                    {SIZES.map(size => {
                      const isSelected = editingWidget.size === size.id;
                      return (
                        <button key={size.id} onClick={() => setEditingWidget({...editingWidget, size: size.id})} className="flex-1 py-4 rounded-xl border transition-colors flex flex-col items-center justify-center gap-1" style={{ backgroundColor: isSelected ? `${PRIMARY_BLUE}1A` : activeTheme.bg, borderColor: isSelected ? PRIMARY_BLUE : activeTheme.border }}>
                          <span className="font-bold text-[13px]" style={{ color: isSelected ? PRIMARY_BLUE : activeTheme.text }}>{size.label}</span>
                          <span className="text-[10px]" style={{ color: activeTheme.textMuted }}>{size.desc}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
            <div className="p-6 border-t flex justify-end gap-3 shrink-0" style={{ borderColor: activeTheme.border }}>
              <button onClick={() => setIsBuilderOpen(false)} className="px-5 py-2.5 rounded-lg font-medium text-sm transition-colors hover:bg-black/5 dark:hover:bg-white/5" style={{ color: activeTheme.textMuted }}>Cancel</button>
              <button onClick={saveWidgetForm} disabled={!editingWidget.stat} className="bg-[#0055FF] hover:bg-blue-600 disabled:opacity-50 px-8 py-2.5 rounded-xl font-bold text-sm text-white transition-colors">{editingWidget.id ? 'Save Changes' : 'Save widget'}</button>
            </div>
          </div>
        </div>
      )}
			{isSettingsModalOpen && (
			        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
			          <div className="w-full max-w-5xl rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden" style={{ backgroundColor: activeTheme.card, border: `1px solid ${activeTheme.border}` }}>
            
			            {/* HEADER */}
			            <div className="flex justify-between items-center p-6 border-b shrink-0" style={{ borderColor: activeTheme.border }}>
			              <h2 className="text-xl font-bold flex items-center gap-2" style={{ color: activeTheme.text }}><Settings className="text-[#0055FF]" size={20}/> Platform Settings</h2>
			              <button onClick={() => setIsSettingsModalOpen(false)} className="hover:text-red-500 transition-colors" style={{ color: activeTheme.textMuted }}><X size={20} /></button>
			            </div>

			            {/* SCROLLABLE BODY */}
			            <div className="p-8 overflow-y-auto custom-scrollbar flex-1" style={{ backgroundColor: isDark ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.02)' }}>
			              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                
			                {/* --- LEFT COLUMN --- */}
			                <div className="space-y-8">
			                  {/* General Config */}
			                  <div>
			                    <h3 className="text-[10px] font-bold uppercase tracking-widest mb-4 pl-1" style={{ color: activeTheme.textMuted }}>1. General Configuration</h3>
			                    <div className="space-y-4 p-5 rounded-xl border shadow-sm" style={{ backgroundColor: activeTheme.card, borderColor: activeTheme.border }}>
			                      <div>
			                        <label className="block text-xs font-medium mb-1.5" style={{ color: activeTheme.textMuted }}>Workspace Slug</label>
			                        <input type="text" value={orgSlug} onChange={e => setOrgSlug(e.target.value)} className="w-full rounded-lg px-4 py-2.5 outline-none text-sm border focus:border-blue-500 transition-colors" style={{ backgroundColor: activeTheme.bg, color: activeTheme.text, borderColor: activeTheme.border }} />
			                      </div>
			                      <div>
			                        <label className="block text-xs font-medium mb-1.5" style={{ color: activeTheme.textMuted }}>Service Token</label>
			                        <input type="password" value={apiToken} onChange={e => setApiToken(e.target.value)} className="w-full rounded-lg px-4 py-2.5 outline-none text-sm border focus:border-blue-500 transition-colors" style={{ backgroundColor: activeTheme.bg, color: activeTheme.text, borderColor: activeTheme.border }} />
			                      </div>
			                      <div>
			                        <label className="block text-xs font-medium mb-1.5" style={{ color: activeTheme.textMuted }}>Notifications Webhook URL</label>
			                        <input type="text" value={webhookUrl} onChange={e => setWebhookUrl(e.target.value)} placeholder="https://chat.googleapis.com/v1/spaces/..." className="w-full rounded-lg px-4 py-2.5 outline-none text-sm border focus:border-blue-500 transition-colors" style={{ backgroundColor: activeTheme.bg, color: activeTheme.text, borderColor: activeTheme.border }} />
			                      </div>
			                      <div>
			                        <label className="block text-xs font-medium mb-1.5" style={{ color: activeTheme.textMuted }}>System Timezone (for Scheduled Reports)</label>
			                        <select value={userTimezone} onChange={e => setUserTimezone(e.target.value)} className="w-full rounded-lg px-4 py-2.5 outline-none text-sm border focus:border-blue-500 transition-colors cursor-pointer" style={{ backgroundColor: activeTheme.bg, color: activeTheme.text, borderColor: activeTheme.border }}>
			                           {(Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : [userTimezone, 'UTC']).map(tz => <option key={tz} value={tz}>{tz}</option>)}
			                        </select>
			                      </div>
			                    </div>
			                  </div>

			                  {/* SMTP Config */}
			                  <div>
			                    <h3 className="text-[10px] font-bold uppercase tracking-widest mb-4 pl-1" style={{ color: activeTheme.textMuted }}>2. SMTP Email Engine</h3>
			                    <div className="space-y-4 p-5 rounded-xl border shadow-sm" style={{ backgroundColor: activeTheme.card, borderColor: activeTheme.border }}>
			                      <div className="flex gap-3">
			                        <div className="flex-1">
			                          <label className="block text-[10px] font-medium mb-1.5" style={{ color: activeTheme.textMuted }}>SMTP Host</label>
			                          <input type="text" value={smtpConfig.host} onChange={e => setSmtpConfig({...smtpConfig, host: e.target.value})} placeholder="smtp.example.com" className="w-full rounded-lg px-3 py-2.5 outline-none text-xs border focus:border-blue-500 transition-colors" style={{ backgroundColor: activeTheme.bg, color: activeTheme.text, borderColor: activeTheme.border }} />
			                        </div>
			                        <div className="w-24">
			                          <label className="block text-[10px] font-medium mb-1.5" style={{ color: activeTheme.textMuted }}>Port</label>
			                          <input type="text" value={smtpConfig.port} onChange={e => setSmtpConfig({...smtpConfig, port: e.target.value})} placeholder="587" className="w-full rounded-lg px-3 py-2.5 outline-none text-xs border focus:border-blue-500 transition-colors" style={{ backgroundColor: activeTheme.bg, color: activeTheme.text, borderColor: activeTheme.border }} />
			                        </div>
			                      </div>
			                      <div className="flex gap-3">
			                        <div className="flex-1">
			                          <label className="block text-[10px] font-medium mb-1.5" style={{ color: activeTheme.textMuted }}>Username</label>
			                          <input type="text" value={smtpConfig.user} onChange={e => setSmtpConfig({...smtpConfig, user: e.target.value})} placeholder="user@example.com" className="w-full rounded-lg px-3 py-2.5 outline-none text-xs border focus:border-blue-500 transition-colors" style={{ backgroundColor: activeTheme.bg, color: activeTheme.text, borderColor: activeTheme.border }} />
			                        </div>
			                        <div className="flex-1">
			                          <label className="block text-[10px] font-medium mb-1.5" style={{ color: activeTheme.textMuted }}>Password</label>
			                          <input type="password" value={smtpConfig.pass} onChange={e => setSmtpConfig({...smtpConfig, pass: e.target.value})} className="w-full rounded-lg px-3 py-2.5 outline-none text-xs border focus:border-blue-500 transition-colors" style={{ backgroundColor: activeTheme.bg, color: activeTheme.text, borderColor: activeTheme.border }} />
			                        </div>
			                      </div>
			                      <div>
			                        <label className="block text-[10px] font-medium mb-1.5" style={{ color: activeTheme.textMuted }}>From Address</label>
			                        <input type="text" value={smtpConfig.from} onChange={e => setSmtpConfig({...smtpConfig, from: e.target.value})} placeholder="reports@applivery.com" className="w-full rounded-lg px-3 py-2.5 outline-none text-xs border focus:border-blue-500 transition-colors" style={{ backgroundColor: activeTheme.bg, color: activeTheme.text, borderColor: activeTheme.border }} />
			                      </div>
			                      <div className="flex justify-end pt-1">
			                         <button type="button" onClick={handleTestSMTP} className="px-5 py-2.5 rounded-lg text-xs font-bold transition-colors border hover:bg-black/5 dark:hover:bg-white/5 flex items-center gap-2" style={{ borderColor: activeTheme.border, color: activeTheme.text }}>
			                           <Mail size={14} className="text-blue-500" /> Send Test Email
			                         </button>
			                      </div>
			                    </div>
			                  </div>
			                </div>

			                {/* --- RIGHT COLUMN --- */}
			                <div className="space-y-8">
									{/* OIDC Config */}
                  <div>
                    <h3 className="text-[10px] font-bold uppercase tracking-widest mb-4 pl-1" style={{ color: activeTheme.textMuted }}>3. OIDC SSO Provider</h3>
                    <div className="space-y-4 p-5 rounded-xl border shadow-sm" style={{ backgroundColor: activeTheme.card, borderColor: activeTheme.border }}>
                      <div>
                        <label className="block text-[10px] font-medium mb-1.5" style={{ color: activeTheme.textMuted }}>Issuer URL</label>
                        <input type="url" value={oidcConfig.issuerUrl} onChange={e => setOidcConfig({...oidcConfig, issuerUrl: e.target.value})} placeholder="https://your-idp.com/" className="w-full rounded-lg px-3 py-2.5 outline-none text-xs border focus:border-blue-500 transition-colors" style={{ backgroundColor: activeTheme.bg, color: activeTheme.text, borderColor: activeTheme.border }} />
                      </div>
                      <div>
                        <label className="block text-[10px] font-medium mb-1.5" style={{ color: activeTheme.textMuted }}>Client ID (Public PKCE)</label>
                        <input type="text" value={oidcConfig.clientId} onChange={e => setOidcConfig({...oidcConfig, clientId: e.target.value})} placeholder="Client ID" className="w-full rounded-lg px-3 py-2.5 outline-none text-xs border focus:border-blue-500 transition-colors" style={{ backgroundColor: activeTheme.bg, color: activeTheme.text, borderColor: activeTheme.border }} />
                      </div>
                      
                      <div className="flex justify-end pt-1">
                         <button type="button" onClick={testSettingsSSO} className="px-5 py-2.5 rounded-lg text-xs font-bold transition-colors border hover:bg-black/5 dark:hover:bg-white/5 flex items-center gap-2" style={{ borderColor: activeTheme.border, color: activeTheme.text }}>
                           <Shield size={14} className="text-blue-500" /> Verify Connection
                         </button>
                      </div>

                      {/* Read-Only Configuration Info */}
                      <div className="mt-4 pt-4 border-t space-y-4" style={{ borderColor: activeTheme.border }}>
                        <div className="flex items-center justify-between">
                          <div>
                            <span className="block text-[9px] font-bold uppercase tracking-widest mb-1" style={{ color: activeTheme.textMuted }}>Redirect URI (Callback)</span>
                            <code className="text-[11px] text-blue-500 font-mono select-all">{redirectUri}</code>
                          </div>
                          <button type="button" onClick={() => handleCopy(redirectUri)} className="p-1.5 hover:bg-black/5 dark:hover:bg-white/10 rounded-md transition-colors" style={{ color: activeTheme.textMuted }} title="Copy">
                            <Copy size={14} />
                          </button>
                        </div>
                        <div className="flex items-center justify-between">
                          <div>
                            <span className="block text-[9px] font-bold uppercase tracking-widest mb-1" style={{ color: activeTheme.textMuted }}>Required Scopes</span>
                            <code className="text-[11px] text-blue-500 font-mono select-all">{scopes}</code>
                          </div>
                          <button type="button" onClick={() => handleCopy(scopes)} className="p-1.5 hover:bg-black/5 dark:hover:bg-white/10 rounded-md transition-colors" style={{ color: activeTheme.textMuted }} title="Copy">
                            <Copy size={14} />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
			                  {/* Backup & Restore */}
			                  <div>
			                    <h3 className="text-[10px] font-bold uppercase tracking-widest mb-4 pl-1" style={{ color: activeTheme.textMuted }}>4. Backup & Restore</h3>
			                    <div className="flex gap-4 p-5 rounded-xl border shadow-sm" style={{ backgroundColor: activeTheme.card, borderColor: activeTheme.border }}>
			                      <button onClick={exportDashboard} className="flex-1 flex items-center justify-center gap-2 py-3 rounded-lg border text-sm font-medium transition-colors hover:bg-blue-500/10 hover:border-blue-500 hover:text-blue-500" style={{ borderColor: activeTheme.border, color: activeTheme.text }}>
			                        <Download size={16} /> Export JSON
			                      </button>
			                      <label className="flex-1 flex items-center justify-center gap-2 py-3 rounded-lg border text-sm font-medium cursor-pointer transition-colors hover:bg-blue-500/10 hover:border-blue-500 hover:text-blue-500" style={{ borderColor: activeTheme.border, color: activeTheme.text }}>
			                        <Upload size={16} /> Import JSON
			                        <input type="file" accept=".json" onChange={importDashboard} className="hidden" />
			                      </label>
			                    </div>
			                  </div>
			                </div>

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
                className="w-full flex-1 rounded-xl p-4 text-[12px] font-mono outline-none focus:border-blue-500 transition-colors border shadow-inner resize-none custom-scrollbar"
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
  );
}
// ─── AUTHENTICATION & SETUP GATEWAY ───
function AuthScreen({ isSetupMode, onComplete }) {
  // Theme Engine (Matches Dashboard Logic)
  const [themeMode] = useState(() => localStorage.getItem('applivery_theme') || 'system');
  const [systemIsDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  const isDark = themeMode === 'dark' || (themeMode === 'system' && systemIsDark);
  const activeTheme = isDark ? THEME.dark : THEME.light;

  // Wizard State
  const [step, setStep] = useState(1);
  const [setupSlug, setSetupSlug] = useState('');
  const [setupToken, setSetupToken] = useState('');
  
  // Auth Form State
  const [adminPassword, setAdminPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [issuerUrl, setIssuerUrl] = useState('');
  const [clientId, setClientId] = useState('');
  const [error, setError] = useState('');
  

  // Login State
  const [showLocalLogin, setShowLocalLogin] = useState(false);
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [isProcessingSSO, setIsProcessingSSO] = useState(false); // <--- 1. NEW STATE

  const handleSSOLogin = async () => {
    setLoginError('');
    setIsProcessingSSO(true);
    try {
      // CRITICAL: Don't rely on localStorage for OIDC config — it's empty on new devices.
      // Fetch the config from the backend state, which is device-agnostic.
      let oidcCfg = null;
      try {
        const stateRes = await axios.get('/api/setup-status');
        oidcCfg = stateRes.data?.oidcConfig || null;
      } catch (_) {}

      // Fallback to localStorage if backend unavailable
      if (!oidcCfg?.issuerUrl) {
        const local = localStorage.getItem('applivery_oidc_config');
        if (local) oidcCfg = JSON.parse(local);
      }

      if (!oidcCfg?.issuerUrl || !oidcCfg?.clientId) {
        throw new Error("SSO is not configured. Please contact your administrator.");
      }

      const um = new UserManager({
        authority: oidcCfg.issuerUrl,
        client_id: oidcCfg.clientId,
        redirect_uri: window.location.origin + '/auth/callback',
        response_type: 'code',
        scope: 'openid profile email',
        loadUserInfo: true
      });

      // Redirect-based login is significantly more stable in Safari
      await um.signinRedirect();
    } catch (err) {
      setLoginError("SSO Login Failed: " + (err.message || String(err)));
      setIsProcessingSSO(false);
    }
  };

  // Read-only OIDC values
  const redirectUri = window.location.origin + '/auth/callback';
  const scopes = 'openid profile email';

  const handleCopy = (text) => {
    navigator.clipboard.writeText(text);
    alert('Copied to clipboard!'); 
  };

  const handleNextStep = (e) => {
    e.preventDefault();
    setError('');
    if (!setupSlug || !setupToken) return setError("Workspace Slug and Service Token are required.");
    setStep(2);
  };

  const handleSetupSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (adminPassword !== confirmPassword) return setError("Admin passwords do not match.");
    if (adminPassword.length < 8) return setError("Password must be at least 8 characters.");
		// Remove the requirement check so the form can submit with just the Admin Password
		if (adminPassword !== confirmPassword) return setError("Admin passwords do not match.");
    
    // Attempt to get JWT from backend using the new password
    const loginOk = await performBackendLogin('local', adminPassword);
    if (!loginOk) return setError("Backend refused to issue a session token.");

    // Save to localStorage for this device (fast local access for axios interceptor)
    localStorage.setItem('applivery_orgSlug', setupSlug);
    localStorage.setItem('applivery_apiToken', setupToken);
    localStorage.setItem('applivery_oidc_config', JSON.stringify({ issuerUrl, clientId }));

    // CRITICAL: Persist ALL config to backend so other devices skip setup and SSO works
    try {
      await axios.post('/api/state', {
        orgSlug: setupSlug,
        apiToken: setupToken,
        oidcConfig: { issuerUrl, clientId },
        setupComplete: true,
      }, { headers: { 'X-Workspace-Slug': 'global' } });
    } catch (err) {
      console.warn('Could not persist setup config to backend:', err.message);
      // Don't block setup completion — user can still use the app locally
    }

    onComplete();
  };
    
  const performBackendLogin = async (authType, credentials) => {
      try {
        const res = await axios.post('/api/auth/login', {
          auth_type: authType,
          credentials: credentials
        });
        if (res.data.access_token) {
          localStorage.setItem('applivery_dashboard_token', res.data.access_token);
          return true;
        }
      } catch (err) {
        console.error("Backend JWT exchange failed", err);
        return false;
      }
      return false;
    };
  
  const handleTestSSO = async () => {
    setError('');
    if (!issuerUrl || !clientId) return setError("Issuer URL and Client ID are required to test.");
    try {
      const um = new UserManager({
        authority: issuerUrl,
        client_id: clientId,
        redirect_uri: redirectUri,
        popup_redirect_uri: redirectUri,
        response_type: 'code',
        scope: scopes
      });
      await um.signinPopup();
      alert("✅ SSO Connection Successful! It is safe to save your configuration.");
    } catch (err) {
      setError("SSO Test Failed: " + err.message);
    }
  };

  if (isSetupMode) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 transition-colors duration-300" style={{ backgroundColor: activeTheme.bg, color: activeTheme.text, backgroundImage: `url('https://dashboard.applivery.io/images/loading-bg.svg')`, backgroundSize: 'cover', backgroundPosition: 'center', backgroundRepeat: 'no-repeat' }}>
        <div className="p-8 rounded-2xl border max-w-2xl w-full shadow-2xl transition-colors duration-300" style={{ backgroundColor: activeTheme.card, borderColor: activeTheme.border }}>
          <div className="flex flex-col items-center mb-8">
            {/* Logo adapts to light/dark mode automatically using a CSS filter */}
            <img src="/applivery-bp-login.svg" className="h-8 mb-6" alt="Applivery" style={{ filter: isDark ? 'none' : 'invert(1)' }} />
            <h1 className="text-2xl font-bold">First-Run Setup</h1>
            <p className="mt-2 text-center text-sm font-medium" style={{ color: activeTheme.textMuted }}>
              {step === 1 ? "Connect your Big Picture dashboard to your workspace." : "Secure your dashboard with a local recovery account and Single Sign-On."}
            </p>
            <div className="flex gap-2 mt-6">
              <div className={`h-1.5 w-12 rounded-full transition-colors`} style={{ backgroundColor: step === 1 ? '#0055FF' : activeTheme.border }}></div>
              <div className={`h-1.5 w-12 rounded-full transition-colors`} style={{ backgroundColor: step === 2 ? '#0055FF' : activeTheme.border }}></div>
            </div>
          </div>

          <form onSubmit={step === 1 ? handleNextStep : handleSetupSubmit} className="space-y-8">
            {error && <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/50 text-red-500 text-sm font-medium text-center">{error}</div>}

            {step === 1 && (
              <div className="animate-in fade-in slide-in-from-right-4 duration-300">
                <h2 className="text-xs font-bold uppercase tracking-widest mb-4 border-b pb-2" style={{ color: activeTheme.textMuted, borderColor: activeTheme.border }}>Workspace Connection</h2>
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: activeTheme.textMuted }}>Workspace Slug</label>
                    <input type="text" value={setupSlug} onChange={e => setSetupSlug(e.target.value)} className="w-full rounded-lg px-3 py-2 outline-none text-sm border focus:border-blue-500 transition-colors" style={{ backgroundColor: activeTheme.bg, borderColor: activeTheme.border, color: activeTheme.text }} placeholder="your-organization" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: activeTheme.textMuted }}>Service Token (API Key)</label>
                    <input type="password" value={setupToken} onChange={e => setSetupToken(e.target.value)} className="w-full rounded-lg px-3 py-2 outline-none text-sm border focus:border-blue-500 transition-colors" style={{ backgroundColor: activeTheme.bg, borderColor: activeTheme.border, color: activeTheme.text }} placeholder="sk_live_..." />
                  </div>
                </div>
                <button type="submit" className="w-full mt-8 bg-[#0055FF] hover:bg-blue-600 text-white px-4 py-3 rounded-xl font-bold text-sm transition-colors shadow-lg">
                  Next Step: Configure Auth
                </button>
              </div>
            )}

            {step === 2 && (
              <div className="animate-in fade-in slide-in-from-right-4 duration-300">
                <div className="mb-8">
                  <h2 className="text-xs font-bold uppercase tracking-widest mb-4 border-b pb-2" style={{ color: activeTheme.textMuted, borderColor: activeTheme.border }}>1. Local Recovery Admin</h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium mb-1" style={{ color: activeTheme.textMuted }}>Admin Password</label>
                      <input type="password" value={adminPassword} onChange={e => setAdminPassword(e.target.value)} className="w-full rounded-lg px-3 py-2 outline-none text-sm border focus:border-blue-500 transition-colors" style={{ backgroundColor: activeTheme.bg, borderColor: activeTheme.border, color: activeTheme.text }} placeholder="Min 8 characters" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1" style={{ color: activeTheme.textMuted }}>Confirm Password</label>
                      <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} className="w-full rounded-lg px-3 py-2 outline-none text-sm border focus:border-blue-500 transition-colors" style={{ backgroundColor: activeTheme.bg, borderColor: activeTheme.border, color: activeTheme.text }} placeholder="Confirm password" />
                    </div>
                  </div>
                </div>

                <div>
                  <h2 className="text-xs font-bold uppercase tracking-widest mb-4 border-b pb-2" style={{ color: activeTheme.textMuted, borderColor: activeTheme.border }}>2. OIDC Provider Settings</h2>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-medium mb-1" style={{ color: activeTheme.textMuted }}>Issuer URL</label>
                      <input type="url" value={issuerUrl} onChange={e => setIssuerUrl(e.target.value)} className="w-full rounded-lg px-3 py-2 outline-none text-sm border focus:border-blue-500 transition-colors" style={{ backgroundColor: activeTheme.bg, borderColor: activeTheme.border, color: activeTheme.text }} placeholder="https://your-idp.com/" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1" style={{ color: activeTheme.textMuted }}>Client ID (Public PKCE)</label>
                      <input type="text" value={clientId} onChange={e => setClientId(e.target.value)} className="w-full rounded-lg px-3 py-2 outline-none text-sm border focus:border-blue-500 transition-colors" style={{ backgroundColor: activeTheme.bg, borderColor: activeTheme.border, color: activeTheme.text }} placeholder="Client ID" />
                    </div>

                    <div className="mt-6 p-4 rounded-xl border space-y-4" style={{ backgroundColor: activeTheme.bg, borderColor: activeTheme.border }}>
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="block text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: activeTheme.textMuted }}>Redirect URI (Callback)</span>
                          <code className="text-sm text-blue-500 font-mono select-all">{redirectUri}</code>
                        </div>
                        <button type="button" onClick={() => handleCopy(redirectUri)} className="p-2 hover:bg-black/5 dark:hover:bg-white/10 rounded-lg transition-colors" style={{ color: activeTheme.textMuted }} title="Copy">
                          <Copy size={16} />
                        </button>
                      </div>
                      <div className="h-px w-full" style={{ backgroundColor: activeTheme.border }}></div>
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="block text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: activeTheme.textMuted }}>Required Scopes</span>
                          <code className="text-sm text-blue-500 font-mono select-all">{scopes}</code>
                        </div>
                        <button type="button" onClick={() => handleCopy(scopes)} className="p-2 hover:bg-black/5 dark:hover:bg-white/10 rounded-lg transition-colors" style={{ color: activeTheme.textMuted }} title="Copy">
                          <Copy size={16} />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex gap-3 mt-8">
                  <button type="button" onClick={() => setStep(1)} className="px-5 py-3 rounded-xl font-bold text-sm transition-colors border hover:bg-black/5 dark:hover:bg-white/5" style={{ borderColor: activeTheme.border, color: activeTheme.textMuted }}>Back</button>
                  <button type="button" onClick={handleTestSSO} className="px-5 py-3 rounded-xl font-bold text-sm transition-colors border hover:bg-black/5 dark:hover:bg-white/5" style={{ borderColor: activeTheme.border, color: activeTheme.text, backgroundColor: activeTheme.bg }}>Test SSO Connection</button>
                  <button type="submit" className="flex-1 bg-[#0055FF] hover:bg-blue-600 text-white px-4 py-3 rounded-xl font-bold text-sm transition-colors shadow-lg">Save Configuration</button>
                </div>
              </div>
            )}
          </form>
        </div>
      </div>
    );
  }

  const handleLocalLogin = async (e) => {
    e.preventDefault();
    setLoginError('');
    const success = await performBackendLogin('local', loginPassword);
    if (success) onComplete();
    else setLoginError('Invalid admin password or backend error.');
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 transition-colors duration-300" style={{ backgroundColor: activeTheme.bg, color: activeTheme.text, backgroundImage: `url('https://dashboard.applivery.io/images/loading-bg.svg')`, backgroundSize: 'cover', backgroundPosition: 'center', backgroundRepeat: 'no-repeat' }}>
      <div className="p-10 rounded-2xl border max-w-xl w-full min-h-[450px] flex flex-col justify-center shadow-2xl relative overflow-hidden transition-colors duration-300" style={{ backgroundColor: isDark ? activeTheme.card : '#F3F7FE', borderColor: activeTheme.border }}>
        <img src="/applivery-bp-login.svg" className="h-8 mx-auto mb-8" alt="Applivery" style={{ filter: isDark ? 'none' : 'invert(1)' }} />
        
        {!showLocalLogin && (
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
            <h1 className="text-xl font-regular mb-6 text-center">Welcome Back</h1>
            
            {loginError && <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/50 text-red-500 text-xs font-medium text-center">{loginError}</div>}
            
            {isProcessingSSO ? (
               <div className="flex flex-col items-center justify-center py-8">
                 <div className="w-8 h-8 border-4 border-[#0055FF]/30 border-t-[#0055FF] rounded-full animate-spin mb-4" />
                 <span className="text-sm font-bold uppercase tracking-widest" style={{ color: activeTheme.textMuted }}>Authenticating...</span>
               </div>
            ) : (
              <>
                <button onClick={handleSSOLogin} className="w-full bg-[#0055FF] hover:bg-blue-600 text-white px-4 py-3 rounded-xl font-bold text-sm transition-colors mb-4 shadow-lg flex items-center justify-center gap-2">
                  <Shield size={16} /> Sign In with SSO
                </button>
                <div className="relative flex items-center py-4">
                  <div className="flex-grow border-t" style={{ borderColor: activeTheme.border }}></div>
                  <span className="flex-shrink-0 mx-4 text-xs font-medium uppercase tracking-widest" style={{ color: activeTheme.textMuted }}>Or</span>
                  <div className="flex-grow border-t" style={{ borderColor: activeTheme.border }}></div>
                </div>
                <button onClick={() => setShowLocalLogin(true)} className="w-full border px-4 py-3 rounded-xl font-bold text-sm transition-colors flex items-center justify-center gap-2 hover:bg-black/5 dark:hover:bg-white/5" style={{ backgroundColor: isDark ? 'transparent' : '#FFFFFF', borderColor: activeTheme.border, color: activeTheme.textMuted }}>
                  <Key size={16} /> Local Admin Login
                </button>
              </>
            )}
          </div>
        )}

        {showLocalLogin && (
          <form onSubmit={handleLocalLogin} className="animate-in fade-in slide-in-from-right-4 duration-300">
            <button type="button" onClick={() => { setShowLocalLogin(false); setLoginError(''); }} className="absolute top-6 left-6 transition-colors hover:opacity-70" style={{ color: activeTheme.textMuted }}>
              <ChevronLeft size={20} />
            </button>
            <h1 className="text-xl font-bold mb-6 text-center">Local Admin</h1>
            
            {loginError && <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/50 text-red-500 text-xs font-medium text-center">{loginError}</div>}
            
            <div className="mb-6">
              <label className="block text-xs font-medium mb-1" style={{ color: activeTheme.textMuted }}>Admin Password</label>
              <input type="password" value={loginPassword} onChange={e => setLoginPassword(e.target.value)} className="w-full rounded-lg px-3 py-3 outline-none text-sm border focus:border-blue-500 transition-colors" style={{ backgroundColor: isDark ? activeTheme.bg : '#FFFFFF', borderColor: activeTheme.border, color: activeTheme.text }} placeholder="Enter password..." autoFocus />
            </div>
            <button type="submit" className="w-full bg-[#0055FF] hover:bg-blue-600 text-white px-4 py-3 rounded-xl font-bold text-sm transition-colors shadow-lg">Unlock Dashboard</button>
          </form>
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

  const [bootState, setBootState] = useState('checking');

  useEffect(() => {
    // 1. OIDC CALLBACK HANDLER (BLOCKING)
    if (window.location.pathname === '/auth/callback') {
      axios.get('/api/setup-status').then(async (statusRes) => {
        const cfg = statusRes.data?.oidcConfig;
        if (!cfg?.issuerUrl || !cfg?.clientId) {
          window.location.href = '/';
          return;
        }

        const um = new UserManager({ 
          authority: cfg.issuerUrl, 
          client_id: cfg.clientId, 
          response_mode: 'query' 
        });

        try {
          const user = await um.signinRedirectCallback();
          const res = await axios.post('/api/auth/login', {
            auth_type: 'oidc',
            credentials: user.access_token
          });
          if (res.data.access_token) {
            localStorage.setItem('applivery_dashboard_token', res.data.access_token);
            window.location.href = '/';
          }
        } catch (e) {
          console.error("SSO Exchange failed", e);
          window.location.href = '/';
        }
      }).catch(() => {
        window.location.href = '/';
      });
      return; 
    }

    // 2. STANDARD BOOT SEQUENCE
    axios.get('/api/setup-status')
      .then(res => {
        const { configured } = res.data;
        if (!configured) {
          setBootState('setup');
        } else {
          const token = localStorage.getItem('applivery_dashboard_token');
          if (token) {
            axios.get('/api/state', { 
              headers: { 
                'X-Dashboard-Token': `Bearer ${token}`, 
                'X-Workspace-Slug': 'global' 
              } 
            }).then(async (stateRes) => {
              const cfg = stateRes.data?.oidcConfig;
              if (cfg?.issuerUrl && cfg?.clientId) {
                try {
                  const um = new UserManager({ 
                    authority: cfg.issuerUrl, 
                    client_id: cfg.clientId, 
                    redirect_uri: window.location.origin + '/auth/callback' 
                  });
                  const user = await um.getUser();
                  if (user && !user.expired) setBootState('ready');
                  else {
                    localStorage.removeItem('applivery_dashboard_token');
                    setBootState('login');
                  }
                } catch (e) { setBootState('ready'); }
              } else {
                setBootState('ready');
              }
            }).catch(() => {
              localStorage.removeItem('applivery_dashboard_token');
              setBootState('login');
            });
          } else {
            setBootState('login');
          }
        }
      })
      .catch(() => {
        const done = localStorage.getItem('applivery_setup_complete');
        const token = localStorage.getItem('applivery_dashboard_token');
        if (!done) setBootState('setup');
        else if (!token) setBootState('login');
        else setBootState('ready');
      });
  }, []);

  // 3. RENDER LOGIC
  if (bootState === 'checking' || window.location.pathname === '/auth/callback') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center transition-colors duration-300" style={{ backgroundColor: activeTheme.bg }}>
        <img src="/applivery-bp-login.svg" className="h-7 object-contain mb-6 opacity-70" alt="Applivery" style={{ filter: isDark ? 'none' : 'invert(1)' }} />
        <div className="w-7 h-7 border-2 rounded-full animate-spin mb-3" style={{ borderColor: `${PRIMARY_BLUE}20`, borderTopColor: PRIMARY_BLUE }}/>
        <span className="text-sm uppercase tracking-widest font-medium opacity-30" style={{ color: activeTheme.text }}>
          {window.location.pathname === '/auth/callback' ? 'Creating Session...' : 'Starting up…'}
        </span>
      </div>
    );
  }

  if (bootState === 'setup') {
    return <AuthScreen isSetupMode={true} onComplete={() => {
      localStorage.setItem('applivery_setup_complete', 'true');
      setBootState('ready');
    }} />;
  }

  if (bootState === 'login') {
    return <AuthScreen isSetupMode={false} onComplete={() => setBootState('ready')} />;
  }

  return <Dashboard />;
}

export default App;