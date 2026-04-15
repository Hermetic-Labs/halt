/**
 * SiteMap — SVG-based spatial map for field deployment.
 *
 * Views:
 *   site      → Top-level view: base node + ward circles + inventory circles + pivot paths
 *   ward      → Drill-down into a ward: base + bed nodes + pivots
 *   inventory → Drill-down into inventory location: base + item nodes
 *   mesh      → Radial mesh topology: leader center + connected client nodes
 *
 * Data: Fetches real ward/inventory data from PatientStore.
 * Persistence: Ward positions + pivot paths stored in localStorage.
 * Access: Leader-only (controlled by parent).
 * Zoom: Mouse wheel zoom, drag to pan, +/- buttons.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import type { WardConfig, InventoryItem, InventoryLocation, LineStyle, FieldNode } from '../types';
import * as store from '../services/PatientStore';

// ── Types ────────────────────────────────────────────────────────────────────

interface MeshClient {
    client_id: string;
    name: string;
    role: string;
    connected_at: number;
    last_ping: number;
    stale: boolean;
    online: boolean;
}

interface RosterMember {
    id: string;
    name: string;
    role: string;
    skills: string[];
    status: string;
    assigned_task: string;
    joined_at: string;
    notes: string;
}

interface Props {
    isLeader: boolean;
    clients: MeshClient[];
    roster: RosterMember[];
    leaderName: string;
    onClose: () => void;
}

type View = 'site' | 'ward' | 'inventory' | 'mesh';

// ── Colors ───────────────────────────────────────────────────────────────────

const CLR = {
    bg: '#0d1117',
    surface: '#161b22',
    border: '#30363d',
    text: '#e6edf3',
    textMuted: '#8b949e',
    textFaint: '#484f58',
    accent: '#3fb950',
    amber: '#f0a500',
    red: '#e74c3c',
    blue: '#3498db',
    purple: '#9b59b6',
    ward: '#3fb950',
    inventory: '#e67e22',
    base: '#f0a500',
    medic: '#e74c3c',
    responder: '#3498db',
    logistics: '#9b59b6',
};

// ── Utilities ────────────────────────────────────────────────────────────────

const VBOX_W = 1000;
const VBOX_H = 700;

function toPx(pct: number, axis: 'x' | 'y') {
    return (pct / 100) * (axis === 'x' ? VBOX_W : VBOX_H);
}

function toPct(px: number, axis: 'x' | 'y') {
    return (px / (axis === 'x' ? VBOX_W : VBOX_H)) * 100;
}

function renderPath(ax: number, ay: number, bx: number, by: number, style: LineStyle): string {
    switch (style) {
        case 'curve-left': {
            const mx = (ax + bx) / 2 - (by - ay) * 0.2;
            const my = (ay + by) / 2 + (bx - ax) * 0.2;
            return `M ${ax},${ay} Q ${mx},${my} ${bx},${by}`;
        }
        case 'curve-right': {
            const mx = (ax + bx) / 2 + (by - ay) * 0.2;
            const my = (ay + by) / 2 - (bx - ax) * 0.2;
            return `M ${ax},${ay} Q ${mx},${my} ${bx},${by}`;
        }
        case 'ascending': {
            const mx = (ax + bx) / 2, my = (ay + by) / 2 - 20;
            return `M ${ax},${ay} L ${mx},${my} L ${bx},${by}`;
        }
        case 'descending': {
            const mx = (ax + bx) / 2, my = (ay + by) / 2 + 20;
            return `M ${ax},${ay} L ${mx},${my} L ${bx},${by}`;
        }
        default:
            return `M ${ax},${ay} L ${bx},${by}`;
    }
}

// ── Persistence ──────────────────────────────────────────────────────────────

interface SiteLayout {
    positions: Record<string, { x: number; y: number }>;
    pivots: Record<string, FieldNode[]>;
}

function loadSiteLayout(): SiteLayout {
    try {
        const raw = localStorage.getItem('halt-sitemap');
        if (raw) return JSON.parse(raw);
    } catch { /* corrupt — reset */ }
    return { positions: {}, pivots: {} };
}

function saveSiteLayout(layout: SiteLayout) {
    localStorage.setItem('halt-sitemap', JSON.stringify(layout));
}

let _pivotSeq = 0;
function nextPivotId() { return `sp-${++_pivotSeq}-${Math.random().toString(36).slice(2, 6)}`; }

// ── Component ────────────────────────────────────────────────────────────────

export default function SiteMap({ isLeader, clients, roster, leaderName, onClose }: Props) {
    const svgRef = useRef<SVGSVGElement>(null);
    const [view, setView] = useState<View>('site');
    const [selectedWardId, setSelectedWardId] = useState<string | null>(null);
    const [selectedInvId, setSelectedInvId] = useState<string | null>(null);

    // Real data from store
    const [wards, setWards] = useState<WardConfig[]>([]);
    const [locations, setLocations] = useState<InventoryLocation[]>([]);
    const [items, setItems] = useState<InventoryItem[]>([]);

    // Site layout persistence
    const [layout, setLayout] = useState<SiteLayout>(loadSiteLayout);

    // Interactive state
    const dragging = useRef<string | null>(null);
    const [activeNode, setActiveNode] = useState<string | null>(null);
    const [selectedPivot, setSelectedPivot] = useState<string | null>(null);
    const [cursorStyle, setCursorStyle] = useState<'default' | 'grabbing'>('default');

    // ── Zoom / Pan ───────────────────────────────────────────────────────────
    const [zoom, setZoom] = useState(1);
    const [panX, setPanX] = useState(0);
    const [panY, setPanY] = useState(0);
    const isPanning = useRef(false);
    const panStart = useRef({ x: 0, y: 0, sx: 0, sy: 0 });

    const vbW = VBOX_W / zoom;
    const vbH = VBOX_H / zoom;
    const vbX = panX;
    const vbY = panY;
    const viewBox = `${vbX} ${vbY} ${vbW} ${vbH}`;

    const handleWheel = useCallback((e: React.WheelEvent) => {
        e.preventDefault();
        const rect = svgRef.current?.getBoundingClientRect();
        if (!rect) return;
        // Mouse position in SVG coords
        const mx = ((e.clientX - rect.left) / rect.width) * vbW + vbX;
        const my = ((e.clientY - rect.top) / rect.height) * vbH + vbY;

        const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
        const newZoom = Math.max(0.3, Math.min(5, zoom * factor));
        const newVbW = VBOX_W / newZoom;
        const newVbH = VBOX_H / newZoom;
        // Keep mouse position stable
        setPanX(mx - ((e.clientX - rect.left) / rect.width) * newVbW);
        setPanY(my - ((e.clientY - rect.top) / rect.height) * newVbH);
        setZoom(newZoom);
    }, [zoom, vbW, vbH, vbX, vbY]);

    const handlePanStart = (e: React.MouseEvent) => {
        // Right-click or middle-click or ctrl+click to pan
        if (e.button === 1 || e.button === 2 || e.ctrlKey) {
            e.preventDefault();
            isPanning.current = true;
            setCursorStyle('grabbing');
            panStart.current = { x: e.clientX, y: e.clientY, sx: panX, sy: panY };
        }
    };

    const handlePanMove = (e: React.MouseEvent) => {
        if (isPanning.current) {
            const rect = svgRef.current?.getBoundingClientRect();
            if (!rect) return;
            const dx = ((e.clientX - panStart.current.x) / rect.width) * vbW;
            const dy = ((e.clientY - panStart.current.y) / rect.height) * vbH;
            setPanX(panStart.current.sx - dx);
            setPanY(panStart.current.sy - dy);
            return;
        }
        // Normal drag (node repositioning)
        if (!svgRef.current || !dragging.current || !isLeader) return;
        const rect = svgRef.current.getBoundingClientRect();
        const svgX = ((e.clientX - rect.left) / rect.width) * vbW + vbX;
        const svgY = ((e.clientY - rect.top) / rect.height) * vbH + vbY;
        const cx = Math.max(5, Math.min(95, toPct(svgX, 'x')));
        const cy = Math.max(5, Math.min(95, toPct(svgY, 'y')));

        if (dragging.current.startsWith('pivot:')) {
            const parts = dragging.current.replace('pivot:', '').split(':');
            const key = parts[0];
            const pivotId = parts[1];
            const pivots = getPivots(key);
            updatePivots(key, pivots.map(p => p.id === pivotId ? { ...p, x: cx, y: cy } : p));
        } else {
            updatePos(dragging.current, cx, cy);
        }
    };

    const handlePanEnd = () => {
        isPanning.current = false;
        dragging.current = null;
        setCursorStyle('default');
    };

    const zoomIn = () => setZoom(z => Math.min(5, z * 1.3));
    const zoomOut = () => setZoom(z => Math.max(0.3, z / 1.3));
    const zoomReset = () => { setZoom(1); setPanX(0); setPanY(0); };

    // ── Fetch real data ──────────────────────────────────────────────────────
    const fetchData = useCallback(async () => {
        try {
            const [w, locs, inv] = await Promise.all([
                store.listWards(),
                store.getInventoryLocations(),
                store.getInventory(),
            ]);
            setWards(w);
            setLocations(locs);
            setItems(inv);
        } catch { /* offline — keep stale */ }
    }, []);

    useEffect(() => {
        const initial = setTimeout(fetchData, 0);
        const timer = setInterval(fetchData, 3000);
        return () => { clearTimeout(initial); clearInterval(timer); };
    }, [fetchData]);

    // ── Layout helpers ───────────────────────────────────────────────────────

    const getPos = (id: string, defaultX: number, defaultY: number) => {
        return layout.positions[id] || { x: defaultX, y: defaultY };
    };

    const updatePos = (id: string, x: number, y: number) => {
        setLayout(prev => {
            const next = { ...prev, positions: { ...prev.positions, [id]: { x, y } } };
            saveSiteLayout(next);
            return next;
        });
    };

    const getPivots = (key: string): FieldNode[] => {
        return layout.pivots[key] || [];
    };

    const updatePivots = (key: string, pivots: FieldNode[]) => {
        setLayout(prev => {
            const next = { ...prev, pivots: { ...prev.pivots, [key]: pivots } };
            saveSiteLayout(next);
            return next;
        });
    };

    // ── Default positions for wards/inventory ───────────────────────────────
    const wardPos = (idx: number, total: number) => {
        const angle = ((idx / Math.max(total, 1)) * Math.PI * 0.8) - Math.PI * 0.4 + Math.PI;
        return { x: 50 + Math.cos(angle) * 30, y: 50 + Math.sin(angle) * 25 };
    };

    const invPos = (idx: number, total: number) => {
        const angle = ((idx / Math.max(total, 1)) * Math.PI * 0.8) - Math.PI * 0.4;
        return { x: 50 + Math.cos(angle) * 30, y: 50 + Math.sin(angle) * 25 };
    };

    // ── Mouse handlers ───────────────────────────────────────────────────────

    const handleMouseDown = (e: React.MouseEvent, id: string) => {
        if (!isLeader) return;
        e.preventDefault();
        e.stopPropagation();
        dragging.current = id;
        setCursorStyle('grabbing');
    };

    const handleSiteLineClick = (e: React.MouseEvent, key: string, segmentIdx: number) => {
        if (!isLeader || dragging.current) return;
        e.stopPropagation();
        const rect = svgRef.current?.getBoundingClientRect();
        if (!rect) return;
        // Convert click to SVG coords
        const svgX = ((e.clientX - rect.left) / rect.width) * vbW + vbX;
        const svgY = ((e.clientY - rect.top) / rect.height) * vbH + vbY;

        // Resolve base and endpoint based on key format
        let basePos = { x: 50, y: 50 };
        let endPos = { x: 50, y: 50 };
        if (key.startsWith('home-')) {
            const nodeId = key.replace('home-', '');
            endPos = layout.positions[nodeId] || { x: 50, y: 50 };
        } else if (key.startsWith('ward-')) {
            basePos = { x: 50, y: 70 };
            const match = key.match(/^ward-(.+)-bed-(\d+)$/);
            if (match) endPos = getPos(`wb-${match[1]}-${match[2]}`, 50, 50);
        } else if (key.startsWith('inv-')) {
            basePos = { x: 50, y: 70 };
            const parts = key.split('-');
            const locId = parts[1];
            const itemId = parts.slice(2).join('-');
            endPos = getPos(`iv-${locId}-${itemId}`, 50, 50);
        }
        const pivots = getPivots(key);
        const allPts = [basePos, ...pivots, endPos];

        const from = allPts[segmentIdx];
        const to = allPts[segmentIdx + 1];
        const ax = toPx(from.x, 'x'), ay = toPx(from.y, 'y');
        const bx = toPx(to.x, 'x'), by = toPx(to.y, 'y');
        const A = svgX - ax, B = svgY - ay, C = bx - ax, D = by - ay;
        const dot = A * C + B * D;
        const lenSq = C * C + D * D;
        let t2 = lenSq !== 0 ? dot / lenSq : 0;
        t2 = Math.max(0, Math.min(1, t2));
        const px = ax + t2 * C, py = ay + t2 * D;
        const dist = Math.sqrt((svgX - px) ** 2 + (svgY - py) ** 2);

        if (dist < 15 / zoom) {
            const newPivot: FieldNode = {
                id: nextPivotId(),
                x: toPct(px, 'x'),
                y: toPct(py, 'y'),
                type: 'pivot',
                label: '',
                style: 'straight',
            };
            const newPivots = [...pivots];
            newPivots.splice(segmentIdx, 0, newPivot);
            updatePivots(key, newPivots);
        }
    };

    const setPivotStyle = (key: string, pivotId: string, style: LineStyle) => {
        const pivots = getPivots(key);
        updatePivots(key, pivots.map(p => p.id === pivotId ? { ...p, style } : p));
        setSelectedPivot(null);
    };

    const removePivot = (key: string, pivotId: string) => {
        const pivots = getPivots(key);
        updatePivots(key, pivots.filter(p => p.id !== pivotId));
        setSelectedPivot(null);
    };

    // ── Item counts per location ─────────────────────────────────────────────
    const itemCountByLoc = (locId: string) => items.filter(i => i.locationId === locId).reduce((sum, i) => sum + i.quantity, 0);

    // ── Lock page scroll while hovering the SVG canvas ───────────────────────
    useEffect(() => {
        const svg = svgRef.current;
        if (!svg) return;
        const block = (e: WheelEvent) => e.preventDefault();
        svg.addEventListener('wheel', block, { passive: false });
        return () => svg.removeEventListener('wheel', block);
    }, []);

    // ── Keyboard ─────────────────────────────────────────────────────────────
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                if (selectedPivot) setSelectedPivot(null);
                else if (activeNode) setActiveNode(null);
                else if (view !== 'site') setView('site');
                else onClose();
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [view, selectedPivot, activeNode, onClose]);

    // ── Render ────────────────────────────────────────────────────────────────

    return (
        <div className="sitemap-container">
            {/* Topbar */}
            <div className="sitemap-topbar">
                <span style={{ color: CLR.accent, fontWeight: 700, fontSize: 13 }}>🗺</span>
                {view !== 'site' && (
                    <button
                        onClick={() => { setView('site'); setActiveNode(null); setSelectedPivot(null); zoomReset(); }}
                        style={{
                            background: 'transparent', border: `1px solid ${CLR.border}`, color: CLR.textMuted,
                            padding: '3px 10px', borderRadius: 4, fontSize: 11, cursor: 'pointer',
                        }}
                    >
                        ← Site
                    </button>
                )}
                {view === 'site' && (
                    <button
                        onClick={() => { setView('mesh'); zoomReset(); }}
                        style={{
                            background: 'transparent', border: `1px solid ${CLR.border}`, color: CLR.textMuted,
                            padding: '3px 10px', borderRadius: 4, fontSize: 11, cursor: 'pointer',
                        }}
                    >
                        Mesh
                    </button>
                )}
                <span style={{ color: CLR.text, fontSize: 12, fontWeight: 600 }}>
                    {view === 'site' ? 'Site Map' : view === 'mesh' ? 'Mesh Map'
                        : view === 'ward' ? wards.find(w => w.id === selectedWardId)?.name || 'Ward'
                            : locations.find(l => l.id === selectedInvId)?.name || 'Inventory'}
                </span>
                <span style={{ flex: 1 }} />
                {/* Zoom controls */}
                <button onClick={zoomOut} style={{ background: CLR.surface, border: `1px solid ${CLR.border}`, color: CLR.text, width: 26, height: 26, borderRadius: 4, cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>−</button>
                <span style={{ color: CLR.textMuted, fontSize: 10, minWidth: 36, textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>
                <button onClick={zoomIn} style={{ background: CLR.surface, border: `1px solid ${CLR.border}`, color: CLR.text, width: 26, height: 26, borderRadius: 4, cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
                <button onClick={zoomReset} style={{ background: 'transparent', border: `1px solid ${CLR.border}`, color: CLR.textMuted, padding: '3px 8px', borderRadius: 4, fontSize: 10, cursor: 'pointer', marginLeft: 4 }}>Reset</button>
                <button
                    onClick={onClose}
                    style={{
                        background: 'transparent', border: `1px solid ${CLR.border}`, color: CLR.textMuted,
                        padding: '3px 10px', borderRadius: 4, fontSize: 11, cursor: 'pointer', marginLeft: 8,
                    }}
                >
                    ✕
                </button>
            </div>

            {/* SVG Canvas */}
            <svg
                ref={svgRef}
                viewBox={viewBox}
                preserveAspectRatio="xMidYMid meet"
                style={{ flex: 1, width: '100%', background: CLR.bg, cursor: cursorStyle }}
                onWheel={handleWheel}
                onMouseDown={handlePanStart}
                onMouseMove={handlePanMove}
                onMouseUp={handlePanEnd}
                onMouseLeave={handlePanEnd}
                onContextMenu={e => e.preventDefault()}
                onClick={() => { setActiveNode(null); setSelectedPivot(null); }}
            >
                {/* ── SITE MAP ──────────────────────────────────────────── */}
                {view === 'site' && (
                    <>
                        {/* Connection lines: home → each ward */}
                        {wards.map((ward, wi) => {
                            const def = wardPos(wi, wards.length);
                            const pos = getPos(ward.id, def.x, def.y);
                            const key = `home-${ward.id}`;
                            const pivots = getPivots(key);
                            const allPts = [{ x: 50, y: 50 }, ...pivots, { x: pos.x, y: pos.y }];
                            return (
                                <g key={key}>
                                    {allPts.slice(0, -1).map((from, i) => {
                                        const to = allPts[i + 1];
                                        return (
                                            <line key={`hit-${i}`}
                                                x1={toPx(from.x, 'x')} y1={toPx(from.y, 'y')}
                                                x2={toPx(to.x, 'x')} y2={toPx(to.y, 'y')}
                                                stroke="transparent" strokeWidth={20}
                                                style={{ cursor: isLeader ? 'crosshair' : 'default' }}
                                                onClick={e => handleSiteLineClick(e, key, i)}
                                            />
                                        );
                                    })}
                                    {allPts.slice(0, -1).map((from, i) => {
                                        const to = allPts[i + 1];
                                        const style = i === 0 ? 'straight' as LineStyle : (pivots[i - 1]?.style || 'straight') as LineStyle;
                                        return (
                                            <path key={`path-${i}`}
                                                d={renderPath(toPx(from.x, 'x'), toPx(from.y, 'y'), toPx(to.x, 'x'), toPx(to.y, 'y'), style)}
                                                fill="none" stroke={CLR.ward + '66'}
                                                strokeWidth={style === 'dotted' ? 1 : 2}
                                                strokeDasharray={style === 'dotted' ? '4 4' : 'none'}
                                            />
                                        );
                                    })}
                                    {pivots.map(pivot => (
                                        <circle key={pivot.id}
                                            cx={toPx(pivot.x, 'x')} cy={toPx(pivot.y, 'y')}
                                            r={selectedPivot === `${key}:${pivot.id}` ? 8 : 5}
                                            fill={selectedPivot === `${key}:${pivot.id}` ? CLR.accent : '#fff'}
                                            stroke={CLR.accent} strokeWidth={2}
                                            style={{ cursor: isLeader ? 'grab' : 'default' }}
                                            onMouseDown={e => handleMouseDown(e, `pivot:${key}:${pivot.id}`)}
                                            onClick={e => { e.stopPropagation(); setSelectedPivot(selectedPivot === `${key}:${pivot.id}` ? null : `${key}:${pivot.id}`); }}
                                        />
                                    ))}
                                </g>
                            );
                        })}

                        {/* Connection lines: home → each inventory location */}
                        {locations.map((loc, li) => {
                            const def = invPos(li, locations.length);
                            const pos = getPos(loc.id, def.x, def.y);
                            const key = `home-${loc.id}`;
                            const pivots = getPivots(key);
                            const allPts = [{ x: 50, y: 50 }, ...pivots, { x: pos.x, y: pos.y }];
                            return (
                                <g key={key}>
                                    {allPts.slice(0, -1).map((from, i) => {
                                        const to = allPts[i + 1];
                                        return (
                                            <line key={`hit-${i}`}
                                                x1={toPx(from.x, 'x')} y1={toPx(from.y, 'y')}
                                                x2={toPx(to.x, 'x')} y2={toPx(to.y, 'y')}
                                                stroke="transparent" strokeWidth={20}
                                                style={{ cursor: isLeader ? 'crosshair' : 'default' }}
                                                onClick={e => handleSiteLineClick(e, key, i)}
                                            />
                                        );
                                    })}
                                    {allPts.slice(0, -1).map((from, i) => {
                                        const to = allPts[i + 1];
                                        const style = i === 0 ? 'straight' as LineStyle : (pivots[i - 1]?.style || 'straight') as LineStyle;
                                        return (
                                            <path key={`path-${i}`}
                                                d={renderPath(toPx(from.x, 'x'), toPx(from.y, 'y'), toPx(to.x, 'x'), toPx(to.y, 'y'), style)}
                                                fill="none" stroke={CLR.inventory + '66'}
                                                strokeWidth={style === 'dotted' ? 1 : 2}
                                                strokeDasharray={style === 'dotted' ? '4 4' : 'none'}
                                            />
                                        );
                                    })}
                                    {pivots.map(pivot => (
                                        <circle key={pivot.id}
                                            cx={toPx(pivot.x, 'x')} cy={toPx(pivot.y, 'y')}
                                            r={selectedPivot === `${key}:${pivot.id}` ? 8 : 5}
                                            fill={selectedPivot === `${key}:${pivot.id}` ? CLR.inventory : '#fff'}
                                            stroke={CLR.inventory} strokeWidth={2}
                                            style={{ cursor: isLeader ? 'grab' : 'default' }}
                                            onMouseDown={e => handleMouseDown(e, `pivot:${key}:${pivot.id}`)}
                                            onClick={e => { e.stopPropagation(); setSelectedPivot(selectedPivot === `${key}:${pivot.id}` ? null : `${key}:${pivot.id}`); }}
                                        />
                                    ))}
                                </g>
                            );
                        })}

                        {/* Base (command center) node — fixed at center */}
                        <g>
                            <rect x={toPx(50, 'x') - 30} y={toPx(50, 'y') - 20} width={60} height={40} rx={4} fill={CLR.surface} stroke={CLR.accent} strokeWidth={2} />
                            <polygon points={`${toPx(50, 'x') - 38},${toPx(50, 'y') - 16} ${toPx(50, 'x')},${toPx(50, 'y') - 42} ${toPx(50, 'x') + 38},${toPx(50, 'y') - 16}`} fill={CLR.surface} stroke={CLR.accent} strokeWidth={2} />
                            <rect x={toPx(50, 'x') - 8} y={toPx(50, 'y') - 10} width={16} height={26} rx={2} fill={CLR.bg} stroke={CLR.accent} strokeWidth={1} />
                            <circle cx={toPx(50, 'x') + 4} cy={toPx(50, 'y') + 2} r={2} fill={CLR.accent} />
                            <text x={toPx(50, 'x')} y={toPx(50, 'y') + 32} textAnchor="middle" fill={CLR.accent} fontSize={10} fontWeight={600}>
                                {leaderName || 'Command'}
                            </text>
                        </g>

                        {/* Ward nodes */}
                        <g onClick={e => e.stopPropagation()}>
                            {wards.map((ward, wi) => {
                                const def = wardPos(wi, wards.length);
                                const pos = getPos(ward.id, def.x, def.y);
                                const cx = toPx(pos.x, 'x');
                                const cy = toPx(pos.y, 'y');
                                const isActive = activeNode === ward.id;
                                return (
                                    <g key={ward.id}>
                                        <circle cx={cx} cy={cy} r={35} fill={CLR.surface} stroke={isActive ? CLR.accent : CLR.border} strokeWidth={2} style={{ cursor: 'pointer' }} onClick={() => setActiveNode(isActive ? null : ward.id)} />
                                        <text x={cx} y={cy + 5} textAnchor="middle" fill={CLR.text} fontSize={13} fontWeight={600} style={{ pointerEvents: 'none' }}>{ward.name}</text>
                                        <text x={cx} y={cy + 20} textAnchor="middle" fill={CLR.textMuted} fontSize={10} style={{ pointerEvents: 'none' }}>{ward.rooms.length} beds</text>
                                        {isActive && isLeader && (
                                            <>
                                                <g onClick={e => { e.stopPropagation(); setSelectedWardId(ward.id); setView('ward'); setActiveNode(null); zoomReset(); }} style={{ cursor: 'pointer' }}>
                                                    <circle cx={cx + 50} cy={cy - 15} r={16} fill={CLR.accent} />
                                                    <text x={cx + 50} y={cy - 11} textAnchor="middle" fill={CLR.bg} fontSize={14}>🏥</text>
                                                </g>
                                                <g onMouseDown={e => { e.stopPropagation(); setActiveNode(null); handleMouseDown(e, ward.id); }} style={{ cursor: 'grab' }}>
                                                    <circle cx={cx + 50} cy={cy + 15} r={16} fill={CLR.blue} />
                                                    <text x={cx + 50} y={cy + 19} textAnchor="middle" fill={CLR.bg} fontSize={14}>✥</text>
                                                </g>
                                            </>
                                        )}
                                    </g>
                                );
                            })}
                        </g>

                        {/* Inventory nodes */}
                        <g onClick={e => e.stopPropagation()}>
                            {locations.map((loc, li) => {
                                const def = invPos(li, locations.length);
                                const pos = getPos(loc.id, def.x, def.y);
                                const cx = toPx(pos.x, 'x');
                                const cy = toPx(pos.y, 'y');
                                const isActive = activeNode === loc.id;
                                const count = itemCountByLoc(loc.id);
                                return (
                                    <g key={loc.id}>
                                        <circle cx={cx} cy={cy} r={30} fill={CLR.surface} stroke={isActive ? CLR.inventory : CLR.border} strokeWidth={2} style={{ cursor: 'pointer' }} onClick={() => setActiveNode(isActive ? null : loc.id)} />
                                        <text x={cx} y={cy + 4} textAnchor="middle" fill={CLR.text} fontSize={11} fontWeight={600} style={{ pointerEvents: 'none' }}>{loc.name.length > 10 ? loc.name.slice(0, 9) + '…' : loc.name}</text>
                                        <circle cx={cx + 22} cy={cy - 22} r={10} fill={CLR.inventory} />
                                        <text x={cx + 22} y={cy - 18} textAnchor="middle" fill={CLR.bg} fontSize={9} fontWeight={700} style={{ pointerEvents: 'none' }}>{count}</text>
                                        {isActive && isLeader && (
                                            <>
                                                <g onClick={e => { e.stopPropagation(); setSelectedInvId(loc.id); setView('inventory'); setActiveNode(null); zoomReset(); }} style={{ cursor: 'pointer' }}>
                                                    <circle cx={cx + 45} cy={cy - 10} r={16} fill={CLR.inventory} />
                                                    <text x={cx + 45} y={cy - 6} textAnchor="middle" fill={CLR.bg} fontSize={14}>📦</text>
                                                </g>
                                                <g onMouseDown={e => { e.stopPropagation(); setActiveNode(null); handleMouseDown(e, loc.id); }} style={{ cursor: 'grab' }}>
                                                    <circle cx={cx + 45} cy={cy + 20} r={16} fill={CLR.blue} />
                                                    <text x={cx + 45} y={cy + 24} textAnchor="middle" fill={CLR.bg} fontSize={14}>✥</text>
                                                </g>
                                            </>
                                        )}
                                    </g>
                                );
                            })}
                        </g>

                        {/* Pivot style menu */}
                        {selectedPivot && (() => {
                            const parts = selectedPivot.split(':');
                            const key = parts[0];
                            const pivotId = parts[1];
                            const pivots = getPivots(key);
                            const pivot = pivots.find(p => p.id === pivotId);
                            if (!pivot) return null;
                            const px = toPx(pivot.x, 'x'), py = toPx(pivot.y, 'y');
                            const sx = px + 15, sy = py - 60;
                            const menuItems: { label: string; s: LineStyle }[] = [
                                { label: '─ Straight', s: 'straight' },
                                { label: '↰ Curve L', s: 'curve-left' },
                                { label: '↱ Curve R', s: 'curve-right' },
                                { label: '··· Dotted', s: 'dotted' },
                                { label: '↑ Ascend', s: 'ascending' },
                                { label: '↓ Descend', s: 'descending' },
                            ];
                            return (
                                <g>
                                    <rect x={sx - 4} y={sy - 10} width={100} height={115} rx={6} fill={CLR.surface} stroke={CLR.border} />
                                    {menuItems.map((item, i) => (
                                        <g key={item.s} onClick={() => setPivotStyle(key, pivotId, item.s)} style={{ cursor: 'pointer' }}>
                                            <rect x={sx} y={sy + i * 16} width={92} height={16} fill={pivot.style === item.s ? '#3fb95033' : 'transparent'} rx={3} />
                                            <text x={sx + 6} y={sy + i * 16 + 12} fill={CLR.text} fontSize={11}>{item.label}</text>
                                        </g>
                                    ))}
                                    <g onClick={() => removePivot(key, pivotId)} style={{ cursor: 'pointer' }}>
                                        <rect x={sx} y={sy + 96} width={92} height={14} fill="#e74c3c22" rx={3} />
                                        <text x={sx + 6} y={sy + 106} fill={CLR.red} fontSize={11}>✕ Remove</text>
                                    </g>
                                </g>
                            );
                        })()}

                        {/* Empty state */}
                        {wards.length === 0 && locations.length === 0 && (
                            <text x={toPx(50, 'x')} y={toPx(80, 'y')} textAnchor="middle" fill={CLR.textFaint} fontSize={13}>
                                Create wards or inventory locations to see them here
                            </text>
                        )}
                    </>
                )}

                {/* ── MESH MAP ──────────────────────────────────────────── */}
                {view === 'mesh' && (() => {
                    const onlineClients = clients.filter(c => c.online && !c.stale);
                    const centerX = 50, centerY = 50;
                    const nodePositions = onlineClients.map((client, i) => {
                        const angle = ((Math.PI * 2) / Math.max(onlineClients.length, 1)) * i - Math.PI / 2;
                        const radius = 35;
                        return { ...client, x: centerX + Math.cos(angle) * radius, y: centerY + Math.sin(angle) * radius };
                    });
                    return (
                        <>
                            {nodePositions.map(node => (
                                <line key={`conn-${node.client_id}`}
                                    x1={toPx(centerX, 'x')} y1={toPx(centerY, 'y')}
                                    x2={toPx(node.x, 'x')} y2={toPx(node.y, 'y')}
                                    stroke={CLR.border} strokeWidth={2} />
                            ))}
                            <g>
                                <circle cx={toPx(centerX, 'x')} cy={toPx(centerY, 'y')} r={28} fill={CLR.surface} stroke={CLR.amber} strokeWidth={3} />
                                <circle cx={toPx(centerX, 'x')} cy={toPx(centerY, 'y')} r={22} fill={CLR.amber} opacity={0.2} />
                                <text x={toPx(centerX, 'x')} y={toPx(centerY, 'y') + 4} textAnchor="middle" fill={CLR.amber} fontSize={10} fontWeight={700}>★</text>
                                <text x={toPx(centerX, 'x')} y={toPx(centerY, 'y') + 50} textAnchor="middle" fill={CLR.amber} fontSize={11} fontWeight={600}>{leaderName || 'Leader'}</text>
                            </g>
                            {nodePositions.map(node => {
                                const rosterEntry = roster.find(r => r.name.toLowerCase() === node.name.toLowerCase());
                                const role = rosterEntry?.role || node.role || 'responder';
                                const nodeColor = role === 'medic' ? CLR.medic : role === 'responder' ? CLR.responder : CLR.logistics;
                                const nodeSize = role === 'medic' ? 22 : 18;
                                return (
                                    <g key={node.client_id}>
                                        <circle cx={toPx(node.x, 'x')} cy={toPx(node.y, 'y')} r={nodeSize} fill={CLR.surface} stroke={nodeColor} strokeWidth={2} />
                                        <text x={toPx(node.x, 'x')} y={toPx(node.y, 'y') + 4} textAnchor="middle" fill={CLR.text} fontSize={8} fontWeight={600} style={{ pointerEvents: 'none' }}>{node.name.split(' ').map(n => n[0]).join('')}</text>
                                        <text x={toPx(node.x, 'x')} y={toPx(node.y, 'y') + nodeSize + 14} textAnchor="middle" fill={CLR.text} fontSize={9}>{node.name.split(' ').pop()}</text>
                                        <text x={toPx(node.x, 'x')} y={toPx(node.y, 'y') + nodeSize + 24} textAnchor="middle" fill={CLR.textMuted} fontSize={8}>{role}</text>
                                    </g>
                                );
                            })}
                            <g transform={`translate(${toPx(5, 'x')}, ${toPx(85, 'y')})`}>
                                <rect x={0} y={0} width={180} height={70} rx={6} fill={CLR.surface} stroke={CLR.border} />
                                <text x={10} y={18} fill={CLR.text} fontSize={10} fontWeight={600}>Network Status</text>
                                <circle cx={20} cy={32} r={6} fill={CLR.surface} stroke={CLR.amber} strokeWidth={2} />
                                <text x={32} y={36} fill={CLR.amber} fontSize={9}>Leader</text>
                                <circle cx={20} cy={48} r={5} fill={CLR.surface} stroke={CLR.medic} strokeWidth={2} />
                                <text x={32} y={52} fill={CLR.medic} fontSize={9}>Medic</text>
                                <circle cx={95} cy={48} r={5} fill={CLR.surface} stroke={CLR.responder} strokeWidth={2} />
                                <text x={107} y={52} fill={CLR.responder} fontSize={9}>Responder</text>
                            </g>
                            {onlineClients.length === 0 && (
                                <text x={toPx(50, 'x')} y={toPx(80, 'y')} textAnchor="middle" fill={CLR.textFaint} fontSize={13}>
                                    No clients connected — use QR to onboard team members
                                </text>
                            )}
                        </>
                    );
                })()}

                {/* ── WARD DRILL-DOWN ───────────────────────────────────── */}
                {view === 'ward' && (() => {
                    const ward = wards.find(w => w.id === selectedWardId);
                    if (!ward) return <text x={toPx(50, 'x')} y={toPx(50, 'y')} textAnchor="middle" fill={CLR.textFaint} fontSize={14}>Ward not found</text>;
                    const bedCount = ward.rooms.length;
                    const baseX = 50, baseY = 70;
                    const beds = ward.rooms.map((label, i) => {
                        const angle = (i / Math.max(bedCount, 1)) * Math.PI * 2 - Math.PI / 2;
                        const radius = Math.min(25, 15 + bedCount * 2);
                        const defPos = { x: 50 + Math.cos(angle) * radius, y: 50 + Math.sin(angle) * radius * 0.6 };
                        const pos = getPos(`wb-${ward.id}-${i}`, defPos.x, defPos.y);
                        return { id: `bed-${i}`, label, ...pos, storeId: `wb-${ward.id}-${i}` };
                    });
                    return (
                        <>
                            {/* Connection lines with pivots */}
                            {beds.map((bed, bi) => {
                                const key = `ward-${ward.id}-bed-${bi}`;
                                const pivots = getPivots(key);
                                const allPts = [{ x: baseX, y: baseY }, ...pivots, { x: bed.x, y: bed.y }];
                                return (
                                    <g key={key}>
                                        {allPts.slice(0, -1).map((from, i) => {
                                            const to = allPts[i + 1];
                                            return (
                                                <line key={`hit-${i}`}
                                                    x1={toPx(from.x, 'x')} y1={toPx(from.y, 'y')}
                                                    x2={toPx(to.x, 'x')} y2={toPx(to.y, 'y')}
                                                    stroke="transparent" strokeWidth={20}
                                                    style={{ cursor: isLeader ? 'crosshair' : 'default' }}
                                                    onClick={e => handleSiteLineClick(e, key, i)}
                                                />
                                            );
                                        })}
                                        {allPts.slice(0, -1).map((from, i) => {
                                            const to = allPts[i + 1];
                                            const style = i === 0 ? 'straight' as LineStyle : (pivots[i - 1]?.style || 'straight') as LineStyle;
                                            return (
                                                <path key={`path-${i}`}
                                                    d={renderPath(toPx(from.x, 'x'), toPx(from.y, 'y'), toPx(to.x, 'x'), toPx(to.y, 'y'), style)}
                                                    fill="none" stroke={CLR.accent + '66'}
                                                    strokeWidth={style === 'dotted' ? 1 : 2}
                                                    strokeDasharray={style === 'dotted' ? '4 4' : 'none'}
                                                />
                                            );
                                        })}
                                        {pivots.map(pivot => (
                                            <circle key={pivot.id}
                                                cx={toPx(pivot.x, 'x')} cy={toPx(pivot.y, 'y')}
                                                r={selectedPivot === `${key}:${pivot.id}` ? 8 : 5}
                                                fill={selectedPivot === `${key}:${pivot.id}` ? CLR.accent : '#fff'}
                                                stroke={CLR.accent} strokeWidth={2}
                                                style={{ cursor: isLeader ? 'grab' : 'default' }}
                                                onMouseDown={e => handleMouseDown(e, `pivot:${key}:${pivot.id}`)}
                                                onClick={e => { e.stopPropagation(); setSelectedPivot(selectedPivot === `${key}:${pivot.id}` ? null : `${key}:${pivot.id}`); }}
                                            />
                                        ))}
                                    </g>
                                );
                            })}
                            {/* Base node */}
                            <g>
                                <rect x={toPx(baseX, 'x') - 28} y={toPx(baseY, 'y') - 24} width={56} height={48} fill={CLR.surface} stroke={CLR.amber} strokeWidth={2} />
                                <text x={toPx(baseX, 'x')} y={toPx(baseY, 'y') + 40} textAnchor="middle" fill={CLR.amber} fontSize={10} fontWeight={600}>{ward.name}</text>
                            </g>
                            {/* Bed nodes — draggable */}
                            <g onClick={e => e.stopPropagation()}>
                                {beds.map(bed => {
                                    const isActive = activeNode === bed.storeId;
                                    return (
                                        <g key={bed.id}>
                                            <circle cx={toPx(bed.x, 'x')} cy={toPx(bed.y, 'y')} r={18}
                                                fill={CLR.surface} stroke={isActive ? CLR.accent : CLR.border} strokeWidth={2}
                                                style={{ cursor: isLeader ? 'pointer' : 'default' }}
                                                onClick={() => isLeader && setActiveNode(isActive ? null : bed.storeId)}
                                            />
                                            <text x={toPx(bed.x, 'x')} y={toPx(bed.y, 'y') + 4} textAnchor="middle" fill={CLR.text} fontSize={9} fontWeight={600} style={{ pointerEvents: 'none' }}>{bed.label.length > 6 ? bed.label.slice(0, 5) + '…' : bed.label}</text>
                                            {isActive && isLeader && (
                                                <g onMouseDown={e => { e.stopPropagation(); setActiveNode(null); handleMouseDown(e, bed.storeId); }} style={{ cursor: 'grab' }}>
                                                    <circle cx={toPx(bed.x, 'x') + 28} cy={toPx(bed.y, 'y')} r={12} fill={CLR.blue} />
                                                    <text x={toPx(bed.x, 'x') + 28} y={toPx(bed.y, 'y') + 4} textAnchor="middle" fill={CLR.bg} fontSize={12}>✥</text>
                                                </g>
                                            )}
                                        </g>
                                    );
                                })}
                            </g>
                            {/* Pivot style menu */}
                            {selectedPivot && (() => {
                                const parts = selectedPivot.split(':');
                                const key = parts[0];
                                const pivotId = parts[1];
                                if (!key.startsWith('ward-')) return null;
                                const pivots = getPivots(key);
                                const pivot = pivots.find(p => p.id === pivotId);
                                if (!pivot) return null;
                                const px = toPx(pivot.x, 'x'), py = toPx(pivot.y, 'y');
                                const sx = px + 15, sy = py - 60;
                                const menuItems: { label: string; s: LineStyle }[] = [
                                    { label: '─ Straight', s: 'straight' }, { label: '↰ Curve L', s: 'curve-left' },
                                    { label: '↱ Curve R', s: 'curve-right' }, { label: '··· Dotted', s: 'dotted' },
                                    { label: '↑ Ascend', s: 'ascending' }, { label: '↓ Descend', s: 'descending' },
                                ];
                                return (
                                    <g>
                                        <rect x={sx - 4} y={sy - 10} width={100} height={115} rx={6} fill={CLR.surface} stroke={CLR.border} />
                                        {menuItems.map((item, i) => (
                                            <g key={item.s} onClick={() => setPivotStyle(key, pivotId, item.s)} style={{ cursor: 'pointer' }}>
                                                <rect x={sx} y={sy + i * 16} width={92} height={16} fill={pivot.style === item.s ? '#3fb95033' : 'transparent'} rx={3} />
                                                <text x={sx + 6} y={sy + i * 16 + 12} fill={CLR.text} fontSize={11}>{item.label}</text>
                                            </g>
                                        ))}
                                        <g onClick={() => removePivot(key, pivotId)} style={{ cursor: 'pointer' }}>
                                            <rect x={sx} y={sy + 96} width={92} height={14} fill="#e74c3c22" rx={3} />
                                            <text x={sx + 6} y={sy + 106} fill={CLR.red} fontSize={11}>✕ Remove</text>
                                        </g>
                                    </g>
                                );
                            })()}
                        </>
                    );
                })()}

                {/* ── INVENTORY DRILL-DOWN ──────────────────────────────── */}
                {view === 'inventory' && (() => {
                    const loc = locations.find(l => l.id === selectedInvId);
                    if (!loc) return <text x={toPx(50, 'x')} y={toPx(50, 'y')} textAnchor="middle" fill={CLR.textFaint} fontSize={14}>Location not found</text>;
                    const locItems = items.filter(i => i.locationId === loc.id);
                    const baseX = 50, baseY = 70;
                    const itemNodes = locItems.map((item, i) => {
                        const angle = (i / Math.max(locItems.length, 1)) * Math.PI * 2 - Math.PI / 2;
                        const radius = Math.min(25, 15 + locItems.length * 2);
                        const defPos = { x: 50 + Math.cos(angle) * radius, y: 50 + Math.sin(angle) * radius * 0.6 };
                        const pos = getPos(`iv-${loc.id}-${item.id}`, defPos.x, defPos.y);
                        return { id: item.id, name: item.name, qty: item.quantity, critical: item.quantity < item.minThreshold, ...pos, storeId: `iv-${loc.id}-${item.id}` };
                    });
                    return (
                        <>
                            {/* Connection lines with pivots */}
                            {itemNodes.map(node => {
                                const key = `inv-${loc.id}-${node.id}`;
                                const pivots = getPivots(key);
                                const allPts = [{ x: baseX, y: baseY }, ...pivots, { x: node.x, y: node.y }];
                                return (
                                    <g key={key}>
                                        {allPts.slice(0, -1).map((from, i) => {
                                            const to = allPts[i + 1];
                                            return (
                                                <line key={`hit-${i}`}
                                                    x1={toPx(from.x, 'x')} y1={toPx(from.y, 'y')}
                                                    x2={toPx(to.x, 'x')} y2={toPx(to.y, 'y')}
                                                    stroke="transparent" strokeWidth={20}
                                                    style={{ cursor: isLeader ? 'crosshair' : 'default' }}
                                                    onClick={e => handleSiteLineClick(e, key, i)}
                                                />
                                            );
                                        })}
                                        {allPts.slice(0, -1).map((from, i) => {
                                            const to = allPts[i + 1];
                                            const style = i === 0 ? 'straight' as LineStyle : (pivots[i - 1]?.style || 'straight') as LineStyle;
                                            return (
                                                <path key={`path-${i}`}
                                                    d={renderPath(toPx(from.x, 'x'), toPx(from.y, 'y'), toPx(to.x, 'x'), toPx(to.y, 'y'), style)}
                                                    fill="none" stroke={CLR.inventory + '66'}
                                                    strokeWidth={style === 'dotted' ? 1 : 2}
                                                    strokeDasharray={style === 'dotted' ? '4 4' : 'none'}
                                                />
                                            );
                                        })}
                                        {pivots.map(pivot => (
                                            <circle key={pivot.id}
                                                cx={toPx(pivot.x, 'x')} cy={toPx(pivot.y, 'y')}
                                                r={selectedPivot === `${key}:${pivot.id}` ? 8 : 5}
                                                fill={selectedPivot === `${key}:${pivot.id}` ? CLR.inventory : '#fff'}
                                                stroke={CLR.inventory} strokeWidth={2}
                                                style={{ cursor: isLeader ? 'grab' : 'default' }}
                                                onMouseDown={e => handleMouseDown(e, `pivot:${key}:${pivot.id}`)}
                                                onClick={e => { e.stopPropagation(); setSelectedPivot(selectedPivot === `${key}:${pivot.id}` ? null : `${key}:${pivot.id}`); }}
                                            />
                                        ))}
                                    </g>
                                );
                            })}
                            {/* Base node */}
                            <g>
                                <rect x={toPx(baseX, 'x') - 28} y={toPx(baseY, 'y') - 24} width={56} height={48} fill={CLR.surface} stroke={CLR.inventory} strokeWidth={2} />
                                <text x={toPx(baseX, 'x')} y={toPx(baseY, 'y') + 40} textAnchor="middle" fill={CLR.inventory} fontSize={10} fontWeight={600}>{loc.name}</text>
                            </g>
                            {/* Item nodes — draggable */}
                            <g onClick={e => e.stopPropagation()}>
                                {itemNodes.map(node => {
                                    const isActive = activeNode === node.storeId;
                                    return (
                                        <g key={node.id}>
                                            <circle cx={toPx(node.x, 'x')} cy={toPx(node.y, 'y')} r={18}
                                                fill={CLR.surface} stroke={isActive ? CLR.inventory : (node.critical ? CLR.red : CLR.purple)} strokeWidth={2}
                                                style={{ cursor: isLeader ? 'pointer' : 'default' }}
                                                onClick={() => isLeader && setActiveNode(isActive ? null : node.storeId)}
                                            />
                                            <text x={toPx(node.x, 'x')} y={toPx(node.y, 'y') + 4} textAnchor="middle" fill={CLR.text} fontSize={9} fontWeight={600} style={{ pointerEvents: 'none' }}>{node.name.length > 6 ? node.name.slice(0, 5) + '…' : node.name}</text>
                                            <circle cx={toPx(node.x, 'x') + 14} cy={toPx(node.y, 'y') - 14} r={8} fill={node.critical ? CLR.red : CLR.inventory} />
                                            <text x={toPx(node.x, 'x') + 14} y={toPx(node.y, 'y') - 11} textAnchor="middle" fill={CLR.bg} fontSize={9} fontWeight={700} style={{ pointerEvents: 'none' }}>{node.qty}</text>
                                            {isActive && isLeader && (
                                                <g onMouseDown={e => { e.stopPropagation(); setActiveNode(null); handleMouseDown(e, node.storeId); }} style={{ cursor: 'grab' }}>
                                                    <circle cx={toPx(node.x, 'x') + 28} cy={toPx(node.y, 'y')} r={12} fill={CLR.blue} />
                                                    <text x={toPx(node.x, 'x') + 28} y={toPx(node.y, 'y') + 4} textAnchor="middle" fill={CLR.bg} fontSize={12}>✥</text>
                                                </g>
                                            )}
                                        </g>
                                    );
                                })}
                            </g>
                            {/* Pivot style menu */}
                            {selectedPivot && (() => {
                                const parts = selectedPivot.split(':');
                                const key = parts[0];
                                const pivotId = parts[1];
                                if (!key.startsWith('inv-')) return null;
                                const pivots = getPivots(key);
                                const pivot = pivots.find(p => p.id === pivotId);
                                if (!pivot) return null;
                                const px = toPx(pivot.x, 'x'), py = toPx(pivot.y, 'y');
                                const sx = px + 15, sy = py - 60;
                                const menuItems: { label: string; s: LineStyle }[] = [
                                    { label: '─ Straight', s: 'straight' }, { label: '↰ Curve L', s: 'curve-left' },
                                    { label: '↱ Curve R', s: 'curve-right' }, { label: '··· Dotted', s: 'dotted' },
                                    { label: '↑ Ascend', s: 'ascending' }, { label: '↓ Descend', s: 'descending' },
                                ];
                                return (
                                    <g>
                                        <rect x={sx - 4} y={sy - 10} width={100} height={115} rx={6} fill={CLR.surface} stroke={CLR.border} />
                                        {menuItems.map((item, i) => (
                                            <g key={item.s} onClick={() => setPivotStyle(key, pivotId, item.s)} style={{ cursor: 'pointer' }}>
                                                <rect x={sx} y={sy + i * 16} width={92} height={16} fill={pivot.style === item.s ? '#e67e2233' : 'transparent'} rx={3} />
                                                <text x={sx + 6} y={sy + i * 16 + 12} fill={CLR.text} fontSize={11}>{item.label}</text>
                                            </g>
                                        ))}
                                        <g onClick={() => removePivot(key, pivotId)} style={{ cursor: 'pointer' }}>
                                            <rect x={sx} y={sy + 96} width={92} height={14} fill="#e74c3c22" rx={3} />
                                            <text x={sx + 6} y={sy + 106} fill={CLR.red} fontSize={11}>✕ Remove</text>
                                        </g>
                                    </g>
                                );
                            })()}
                            {locItems.length === 0 && (
                                <text x={toPx(50, 'x')} y={toPx(30, 'y')} textAnchor="middle" fill={CLR.textFaint} fontSize={13}>No items — add supplies in the Inventory tab</text>
                            )}
                        </>
                    );
                })()}
            </svg>
        </div>
    );
}
