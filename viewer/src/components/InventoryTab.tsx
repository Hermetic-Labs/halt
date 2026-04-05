import { useState, useEffect, useCallback, useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import * as store from '../services/PatientStore';
import type { InventoryItem, InventoryLocation, PatientRecord } from '../types';
import type { ActivityEntry } from '../services/PatientStore';
import { useT } from '../services/i18n';
import { normalizeToEnglish } from '../services/i18nDynamic';


function formatTimeAgo(iso: string, t: (key: string, params?: string | Record<string, string>) => string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return t('inv.time_just_now');
    if (mins < 60) return t('inv.time_minutes_ago', { n: String(mins) });
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return t('inv.time_hours_ago', { n: String(hrs) });
    const days = Math.floor(hrs / 24);
    return t('inv.time_days_ago', { n: String(days) });
}

// ─── Add Item Modal ──────────────────────────────────────────────────────────

const DEFAULT_TEMPLATE_IDS = ['custom', 'txa', 'gauze', 'tourniquet', 'fluids', 'ketamine', 'seal'] as const;
const DEFAULT_TEMPLATES_DATA: Record<string, { minThreshold: number }> = {
    custom: { minThreshold: 5 },
    txa: { minThreshold: 3 },
    gauze: { minThreshold: 10 },
    tourniquet: { minThreshold: 5 },
    fluids: { minThreshold: 5 },
    ketamine: { minThreshold: 5 },
    seal: { minThreshold: 8 },
};

function AddItemModal({ locationId, onClose, onAdd }: { locationId: string; onClose: () => void; onAdd: (item: InventoryItem) => void }) {
    const { t, tEn, lang } = useT();
    const [templateId, setTemplateId] = useState('custom');
    const [name, setName] = useState('');
    const [category, setCategory] = useState('');
    const [minThreshold, setMinThreshold] = useState(5);
    const [initialQty, setInitialQty] = useState(0);
    const [alternativesStr, setAlternativesStr] = useState('');

    const handleTemplateChange = (id: string) => {
        setTemplateId(id);
        const data = DEFAULT_TEMPLATES_DATA[id];
        if (id !== 'custom' && data) {
            setName(t(`inv.tpl_${id}_name`));
            setCategory(t(`inv.tpl_${id}_cat`));
            setMinThreshold(data.minThreshold);
            setInitialQty(0);
            setAlternativesStr(t(`inv.tpl_${id}_alts`));
        } else {
            setName('');
            setCategory(t('inv.cat_general'));
            setMinThreshold(5);
            setInitialQty(0);
            setAlternativesStr('');
        }
    };

    const handleSubmit = async () => {
        if (!name.trim()) return;
        let finalName = name.trim();
        let finalCategory = category.trim();
        const alts = alternativesStr.split(',').map(s => s.trim()).filter(Boolean);
        if (alts.length === 0) alts.push(tEn('inv.improvised_alt'));

        if (templateId !== 'custom') {
            // Template items: use canonical English directly — no NLLB round-trip
            finalName = tEn(`inv.tpl_${templateId}_name`);
            finalCategory = tEn(`inv.tpl_${templateId}_cat`);
            const enAlts = tEn(`inv.tpl_${templateId}_alts`).split(',').map(s => s.trim()).filter(Boolean);
            alts.length = 0;
            alts.push(...enAlts);
        } else if (lang !== 'en') {
            // Custom items: normalize user input to English
            const { english: eName } = await normalizeToEnglish(finalName, lang);
            finalName = eName;
            const { english: eCat } = await normalizeToEnglish(finalCategory, lang);
            finalCategory = eCat;
            for (let i = 0; i < alts.length; i++) {
                const { english: eAlt } = await normalizeToEnglish(alts[i], lang);
                alts[i] = eAlt;
            }
        }

        onAdd({
            id: `inv-${Date.now()}`,
            name: finalName,
            quantity: initialQty,
            minThreshold,
            category: finalCategory,
            alternatives: alts,
            locationId
        });
    };

    return (
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(2px)' }}>
            <div style={{ background: 'var(--surface)', padding: 24, borderRadius: 8, width: 450, border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{t("inv.add_supply")}</div>

                <div className="if-field">
                    <label className="if-label">{t("inv.template")}</label>
                    <select className="if-input" value={templateId} onChange={e => handleTemplateChange(e.target.value)}>
                        {DEFAULT_TEMPLATE_IDS.map(id => <option key={id} value={id}>{t(`inv.tpl_${id}_name`)}</option>)}
                    </select>
                </div>

                <div className="if-field">
                    <label className="if-label">{t("inv.item_name")}</label>
                    <input className="if-input" value={name} onChange={e => setName(e.target.value)} placeholder={t('inv.ph_name')} />
                </div>

                <div style={{ display: 'flex', gap: 12 }}>
                    <div className="if-field" style={{ flex: 1 }}>
                        <label className="if-label">{t("inv.category")}</label>
                        <input className="if-input" value={category} onChange={e => setCategory(e.target.value)} placeholder={t('inv.ph_category')} />
                    </div>
                    <div className="if-field" style={{ width: 100 }}>
                        <label className="if-label">{t("inv.alert_at")}</label>
                        <input className="if-input" type="number" min="1" value={minThreshold} onChange={e => setMinThreshold(parseInt(e.target.value) || 1)} />
                    </div>
                    <div className="if-field" style={{ width: 100 }}>
                        <label className="if-label">{t("inv.initial_qty")}</label>
                        <input className="if-input" type="number" min="0" value={initialQty} onChange={e => setInitialQty(parseInt(e.target.value) || 0)} />
                    </div>
                </div>

                <div className="if-field">
                    <label className="if-label">{t("inv.fallback_alts")}</label>
                    <input className="if-input" value={alternativesStr} onChange={e => setAlternativesStr(e.target.value)} placeholder={t('inv.ph_alts')} />
                </div>

                <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
                    <button className="intake-next-btn" style={{ flex: 1 }} onClick={handleSubmit}>{t("inv.create_item")}</button>
                    <button className="intake-back-btn" onClick={onClose}>{t("inv.cancel")}</button>
                </div>
            </div>
        </div>
    );
}

// ── Location Settings Modal ──────────────────────────────────────────────────

function LocationSettings({ config, isNew, onClose, onSave, onDelete }: {
    config: InventoryLocation;
    isNew: boolean;
    onClose: () => void;
    onSave: (c: InventoryLocation) => Promise<void>;
    onDelete: (id: string) => Promise<void>;
}) {
    const { t, lang } = useT();
    const [name, setName] = useState(config.name);
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);

    const handleSave = async () => {
        if (!name.trim()) return;
        setSaving(true);
        try {
            let finalName = name.trim();
            if (lang !== 'en') {
                const { english } = await normalizeToEnglish(finalName, lang);
                finalName = english;
            }
            await onSave({ ...config, name: finalName });
            onClose();
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async () => {
        if (!confirmDelete) {
            setConfirmDelete(true);
            return;
        }
        setDeleting(true);
        try {
            await onDelete(config.id);
            onClose();
        } finally {
            setDeleting(false);
            setConfirmDelete(false);
        }
    };

    return (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ background: 'var(--surface)', padding: 24, borderRadius: 12, width: 400, border: '1px solid var(--border)' }}>
                <h3 style={{ marginBottom: 16 }}>{t("inv.location_config")}</h3>
                <div className="if-field">
                    <label className="if-label">{t("inv.location_name")}</label>
                    <input className="if-input" value={name} onChange={e => setName(e.target.value)} autoFocus />
                </div>
                <div style={{ display: 'flex', gap: 12, marginTop: 20, justifyContent: 'flex-end', alignItems: 'center' }}>
                    {!isNew && config.id !== 'loc-1' && (
                        <button
                            className="if-toggle"
                            style={{
                                color: confirmDelete ? '#fff' : '#e74c3c',
                                background: confirmDelete ? '#e74c3c' : 'transparent',
                                borderColor: '#e74c3c33',
                                marginRight: 'auto'
                            }}
                            onClick={handleDelete}
                            disabled={deleting || saving}
                            onMouseLeave={() => setConfirmDelete(false)}
                        >
                            {deleting ? t('inv.deleting') : confirmDelete ? t('inv.confirm_delete') : t('inv.delete_location')}
                        </button>
                    )}
                    <button className="if-toggle" onClick={onClose} disabled={saving || deleting}>{t('inv.cancel')}</button>
                    <button className="intake-next-btn" onClick={handleSave} disabled={saving || deleting}>{saving ? t('inv.saving') : t('inv.save')}</button>
                </div>
            </div>
        </div>
    );
}

// ── Modify Quantity Modal ────────────────────────────────────────────────────

function ModifyQuantityModal({ item, displayName, type, onClose, onConfirm }: {
    item: InventoryItem;
    displayName: string;
    type: 'add' | 'take';
    onClose: () => void;
    onConfirm: (amount: number) => Promise<void>;
}) {
    const { t } = useT();
    const [amountStr, setAmountStr] = useState('1');
    const [saving, setSaving] = useState(false);

    const parsedAmount = parseInt(amountStr) || 0;

    const handleSubmit = async () => {
        if (parsedAmount < 1) return;
        setSaving(true);
        try {
            await onConfirm(parsedAmount);
            onClose();
        } finally {
            setSaving(false);
        }
    };

    const color = type === 'add' ? '#3fb950' : '#e74c3c';

    return (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ background: 'var(--surface)', padding: 24, borderRadius: 12, width: 350, border: `1px solid ${color}66` }}>
                <h3 style={{ marginBottom: 16, color, textTransform: 'capitalize' }}>{t(`inv.${type}`)} {displayName}</h3>
                <div style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 20 }}>
                    {t('inv.current_qty')} <strong>{item.quantity}</strong>
                </div>

                <div className="if-field">
                    <label className="if-label">{t('inv.qty_to')} {t(`inv.${type}`)}</label>
                    <input
                        className="if-input"
                        type="number"
                        min="1"
                        max={type === 'take' ? item.quantity : 9999}
                        value={amountStr}
                        onChange={e => setAmountStr(e.target.value)}
                        onBlur={() => { if (!amountStr.trim() || parsedAmount < 1) setAmountStr('1'); }}
                        autoFocus
                    />
                </div>

                <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
                    <button
                        className="intake-next-btn"
                        style={{ flex: 1, background: color, borderColor: color }}
                        onClick={handleSubmit}
                        disabled={saving || parsedAmount < 1 || (type === 'take' && parsedAmount > item.quantity)}
                    >
                        {saving ? t('inv.saving') : `${t('inv.confirm')} ${type === 'add' ? '+' : '-'}${parsedAmount || 0}`}
                    </button>
                    <button className="intake-back-btn" onClick={onClose} disabled={saving}>{t('inv.cancel')}</button>
                </div>
            </div>
        </div>
    );
}

export default function InventoryTab() {
    const { t } = useT();

    // ── Template-aware display helpers ──
    // Items stored in English — map known template IDs to t() keys for display
    const TPL_ID_MAP: Record<string, string> = useMemo(() => ({
        'txa': 'txa',
        'gauze': 'gauze',
        'tourniquet': 'tourniquet',
        'iv-fluid': 'fluids',
        'ketamine': 'ketamine',
        'chest-seal': 'seal',
    }), []);
    const tplKey = useCallback((item: InventoryItem) => {
        const k = item.id.replace('inv-', '');
        return TPL_ID_MAP[k] ?? null;
    }, [TPL_ID_MAP]);
    const tName = useCallback((item: InventoryItem) => { const k = tplKey(item); return k ? t(`inv.tpl_${k}_name`) : item.name; }, [t, tplKey]);
    const tCat = useCallback((item: InventoryItem) => { const k = tplKey(item); return k ? t(`inv.tpl_${k}_cat`) : item.category; }, [t, tplKey]);
    const tAlts = useCallback((item: InventoryItem) => {
        const k = tplKey(item);
        if (k) return t(`inv.tpl_${k}_alts`).split(',').map(s => s.trim());
        return item.alternatives;
    }, [t, tplKey]);

    // Reverse-map English template names for activity log translation
    const TEMPLATE_ENGLISH_NAMES: Record<string, string> = useMemo(() => ({
        'TXA (Tranexamic Acid)': 'txa',
        'Combat Gauze': 'gauze',
        'CAT Tourniquet': 'tourniquet',
        'IV Fluids (Lactated Ringers 1L)': 'fluids',
        'Ketamine (500mg vial)': 'ketamine',
        'Vented Chest Seal': 'seal',
    }), []);
    const tTarget = useCallback((raw: string): string => {
        // Format: "ItemName [LocationName]"  →  translate item, keep location
        const bracketIdx = raw.lastIndexOf(' [');
        const itemName = bracketIdx > 0 ? raw.slice(0, bracketIdx) : raw;
        const locationPart = bracketIdx > 0 ? raw.slice(bracketIdx) : '';
        const tplId = TEMPLATE_ENGLISH_NAMES[itemName];
        const translatedName = tplId ? t(`inv.tpl_${tplId}_name`) : itemName;
        return translatedName + locationPart;
    }, [t, TEMPLATE_ENGLISH_NAMES]);

    const [items, setItems] = useState<InventoryItem[]>([]);
    const [locations, setLocations] = useState<InventoryLocation[]>([]);
    const [activePatients, setActivePatients] = useState<PatientRecord[]>([]);
    const [activeLocId, setActiveLocId] = useState<string>('loc-1');
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [showAddModal, setShowAddModal] = useState(false);
    const [editingLocation, setEditingLocation] = useState<InventoryLocation | null>(null);
    const [modifyingItem, setModifyingItem] = useState<{ item: InventoryItem; type: 'add' | 'take' } | null>(null);
    const [loading, setLoading] = useState(true);
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
    const [activity, setActivity] = useState<ActivityEntry[]>([]);
    const [activityLocFilter, setActivityLocFilter] = useState<string>('all');


    const load = useCallback(async () => {
        try {
            const [data, locs, patients, activityData] = await Promise.all([
                store.getInventory(),
                store.getInventoryLocations(),
                store.listAllPatientsFull('active'),
                store.getInventoryActivity(50).catch(() => [] as ActivityEntry[]),
            ]);
            setItems(data);
            setLocations(locs);
            setActivePatients(patients);
            setActivity(activityData);
            if (locs.length > 0 && !locs.find(l => l.id === activeLocId)) {
                setActiveLocId(locs[0].id);
            }
        } catch (e) {
            console.error("Failed to load inventory", e);
        } finally {
            setLoading(false);
        }
    }, [activeLocId]);

    useEffect(() => {
        load();
        const idx = setInterval(load, 2000);
        return () => clearInterval(idx);
    }, [load]);


    const handleRestock = async (id: string, amount: number) => {
        // Optimistic UI update
        setItems(prev => prev.map(item => item.id === id ? { ...item, quantity: item.quantity + amount } : item));
        try {
            await store.restockInventory(id, amount);
        } catch (e) {
            console.error(e);
            load(); // Revert on failure
        }
    };

    const handleConsume = async (id: string, amount: number) => {
        setItems(prev => prev.map(item => item.id === id ? { ...item, quantity: Math.max(0, item.quantity - amount) } : item));
        try {
            await store.consumeInventory(id, amount);
        } catch (e) {
            console.error(e);
            load();
        }
    };

    const handleAddLocation = () => {
        setEditingLocation({ id: `loc-${Date.now()}`, name: t('inv.new_location') });
    };

    const handleAddItem = async () => {
        setShowAddModal(true);
    };

    const handleDeleteItem = async (id: string) => {
        if (confirmDeleteId !== id) {
            setConfirmDeleteId(id);
            return;
        }
        try {
            await store.deleteInventoryItem(id);
            setItems(prev => prev.filter(i => i.id !== id));
            setExpandedId(null);
            setConfirmDeleteId(null);
        } catch (e) {
            console.error('Failed to delete item', e);
        }
    };

    const criticalItems = items.filter(i => i.quantity < i.minThreshold);
    const displayItems = items.filter(i => i.locationId === activeLocId);

    // Calculate aggregated needs from active patients
    const chartData = useMemo(() => {
        if (!items.length) return [];

        // Map common text plan phrases to Inventory Items roughly
        const needMap: Record<string, number> = {};

        activePatients.forEach(p => {
            const rxs = p.plan?.rx || [];
            const marches = (p.plan?.march || []).flatMap(m => m.actions);
            const allText = [...rxs, ...marches].join(' ').toLowerCase();

            items.forEach(item => {
                const keyword = item.name.toLowerCase().split(' ')[0]; // E.g. "TXA", "Combat"
                // Very rudimentary exact keyword match vs plan payload text
                if (allText.includes(keyword)) {
                    needMap[item.name] = (needMap[item.name] || 0) + 1;
                }
            });
        });

        // Tally global total stock per item type vs Need
        const aggregateStock: Record<string, number> = {};
        items.forEach(i => { aggregateStock[i.name] = (aggregateStock[i.name] || 0) + i.quantity; });

        return Object.keys(aggregateStock).map(n => {
            const matchItem = items.find(i => i.name === n);
            return {
                name: matchItem ? tName(matchItem) : n,
                [t('inv.stock')]: aggregateStock[n],
                [t('inv.need')]: needMap[n] || 0
            };
        }).sort((a, b) => (b[t('inv.need')] as number) - (a[t('inv.need')] as number));
    }, [items, activePatients, t, tName]);

    if (loading && items.length === 0) {
        return (
            <div className="ward-connect">
                <div className="loading">{t("inv.loading")}</div>
            </div>
        );
    }


    return (
        <div style={{ position: 'absolute', inset: 0, overflowY: 'auto', padding: 24 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: 16, flexWrap: 'wrap', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16, minWidth: 0 }}>
                    <div style={{ minWidth: 0 }}>
                        <select
                            className="if-input"
                            style={{ fontSize: 'clamp(16px, 4vw, 24px)', fontWeight: 700, background: 'transparent', border: 'none', padding: '0 8px 0 0', cursor: 'pointer', appearance: 'auto', outline: 'none', color: 'var(--text)', maxWidth: '100%' }}
                            value={activeLocId}
                            onChange={e => setActiveLocId(e.target.value)}
                        >
                            {locations.map(l => (
                                <option key={l.id} value={l.id} style={{ fontSize: 14, background: 'var(--surface)' }}>{l.name}</option>
                            ))}
                        </select>
                        <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>{t("inv.subtitle")}</div>
                    </div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button className="if-toggle" onClick={handleAddLocation}>{t("inv.add_location")}</button>
                    <button className="if-toggle" onClick={handleAddItem}>{t("inv.add_item")}</button>
                    <button className="if-toggle" style={{ padding: '6px 10px' }} onClick={() => {
                        const loc = locations.find(l => l.id === activeLocId);
                        if (loc) setEditingLocation(loc);
                    }}>{`⚙️ ${t('inv.configure')}`}</button>
                </div>
            </div>

            {/* Critical Supply Shortages — shown above chart */}
            {criticalItems.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <h3 style={{ margin: 0, color: '#e74c3c', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 20 }}>⚠️</span> {t('inv.critical_shortages')}
                    </h3>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
                        {criticalItems.map(item => (
                            <div key={item.id} style={{ background: '#e74c3c15', border: '1px solid #e74c3c66', padding: 16, borderRadius: 8 }}>
                                <div style={{ fontSize: 16, fontWeight: 600, color: '#e74c3c', marginBottom: 8 }}>{tName(item)} {t('inv.is_depleted')}</div>
                                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>{t('inv.alternatives')}</div>
                                <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: 'var(--text)' }}>
                                    {tAlts(item).map((alt, i) => (
                                        <li key={i}>{alt}</li>
                                    ))}
                                </ul>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Inventory Overview Chart — always visible for field setup */}
            {chartData.length > 0 && (
                <div style={{ background: 'var(--surface)', padding: 'clamp(12px, 2vw, 24px)', borderRadius: 8, border: '1px solid var(--border)', minHeight: 200, maxHeight: 300, display: 'flex', flexDirection: 'column' }}>
                    <div style={{ fontSize: 'clamp(13px, 2vw, 16px)', fontWeight: 700, marginBottom: 12, display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 4, color: '#fff' }}>
                        <span>{activePatients.length > 0 ? t('inv.needs_vs_stock') : t('inv.stock_overview')}</span>
                        {activePatients.length > 0 && <span style={{ fontSize: 11, color: '#fff' }}>{t('inv.based_on')} {activePatients.length} {t('inv.active_patients')}</span>}
                    </div>
                    <div style={{ height: 220 }}>
                        <ResponsiveContainer width="100%" height="100%" minWidth={100} minHeight={100}>
                            <BarChart data={chartData} margin={{ top: 5, right: 20, left: -20, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                                <XAxis dataKey="name" stroke="#fff" fontSize={12} tickLine={false} axisLine={false} />
                                <YAxis stroke="#fff" fontSize={12} tickLine={false} axisLine={false} />
                                <Tooltip
                                    cursor={{ fill: 'rgba(255, 255, 255, 0.05)' }}
                                    contentStyle={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, color: '#fff' }}
                                    itemStyle={{ fontSize: 14, fontWeight: 600 }}
                                />
                                <Legend wrapperStyle={{ fontSize: 13, paddingTop: 10, color: '#fff' }} />
                                {activePatients.length > 0 && <Bar dataKey={t('inv.need')} fill="#e74c3c" radius={[4, 4, 0, 0]} maxBarSize={60} />}
                                <Bar dataKey={t('inv.stock')} fill="#3fb950" radius={[4, 4, 0, 0]} maxBarSize={60} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16, alignItems: 'start' }}>
                {displayItems.map(item => {
                    const optimal = item.minThreshold * 3; // Make up an optimal threshold based on min
                    const ratio = Math.min(1, item.quantity / optimal);
                    const isCritical = item.quantity < item.minThreshold;
                    const isWarning = item.quantity < (item.minThreshold * 1.5) && !isCritical;
                    const barColor = isCritical ? '#e74c3c' : isWarning ? '#f0a500' : '#3fb950';
                    const isExpanded = expandedId === item.id;

                    return (
                        <div
                            key={item.id}
                            style={{ background: isExpanded ? 'var(--surface2)' : 'var(--surface)', padding: 16, borderRadius: 8, border: `1px solid ${isCritical ? '#e74c3c66' : 'var(--border)'}`, cursor: 'pointer', transition: 'background 0.2s', boxShadow: isExpanded ? '0 4px 12px rgba(0,0,0,0.5)' : 'none' }}
                            onClick={() => setExpandedId(isExpanded ? null : item.id)}
                        >
                            {/* Bar Graph — top-aligned across all cards */}
                            <div style={{ height: 6, background: 'var(--bg)', borderRadius: 3, overflow: 'hidden', marginBottom: 16 }}>
                                <div style={{ height: '100%', width: `${ratio * 100}%`, background: barColor, transition: 'width 0.3s ease, background 0.3s ease' }} />
                            </div>

                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 16 }}>
                                <div style={{ fontSize: 28, fontWeight: 700, color: barColor, lineHeight: 1, minWidth: 36 }}>
                                    {item.quantity}
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontWeight: 600, fontSize: 16 }}>{tName(item)}</div>
                                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{tCat(item)}</div>
                                </div>
                            </div>

                            {/* Controls */}
                            <div style={{ display: 'flex', gap: 8 }} onClick={e => e.stopPropagation()}>
                                <button
                                    className="if-toggle"
                                    style={{ flex: 1, color: '#e74c3c', borderColor: '#e74c3c66', background: '#e74c3c15' }}
                                    disabled={item.quantity === 0}
                                    onClick={() => setModifyingItem({ item, type: 'take' })}
                                >
                                    {t('inv.take')}
                                </button>
                                <button
                                    className="if-toggle"
                                    style={{ flex: 1, color: '#3fb950', borderColor: '#3fb95066', background: '#3fb95015' }}
                                    onClick={() => setModifyingItem({ item, type: 'add' })}
                                >
                                    {t('inv.add')}
                                </button>
                            </div>

                            {/* Expanded Details */}
                            {isExpanded && (
                                <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }} onClick={e => e.stopPropagation()}>
                                    <div style={{ fontSize: 13, marginBottom: 8 }}>
                                        <span style={{ color: 'var(--text-dim)' }}>ID: </span><span style={{ fontFamily: 'var(--font-mono)' }}>{item.id}</span>
                                    </div>
                                    <div style={{ fontSize: 13, marginBottom: 8 }}>
                                        <span style={{ color: 'var(--text-dim)' }}>{t('inv.alert_threshold')} </span><span style={{ fontFamily: 'var(--font-mono)' }}>{item.minThreshold}</span>
                                    </div>
                                    <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 4 }}>{t('inv.fallback')}</div>
                                    <ul style={{ margin: 0, paddingLeft: 20, fontSize: 12, color: 'var(--text)' }}>
                                        {tAlts(item).map((alt, i) => (
                                            <li key={i}>{alt}</li>
                                        ))}
                                    </ul>
                                    <button
                                        className="if-toggle"
                                        style={{
                                            marginTop: 16,
                                            color: confirmDeleteId === item.id ? '#fff' : '#e74c3c',
                                            background: confirmDeleteId === item.id ? '#e74c3c' : 'transparent',
                                            borderColor: '#e74c3c33',
                                            fontSize: 11,
                                            padding: '6px 12px',
                                        }}
                                        onClick={() => handleDeleteItem(item.id)}
                                        onMouseLeave={() => setConfirmDeleteId(null)}
                                    >
                                        {confirmDeleteId === item.id ? t('inv.confirm_delete') : t('inv.delete_item')}
                                    </button>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Activity History — always visible */}
            {(() => {
                const filtered = activityLocFilter === 'all'
                    ? activity
                    : activity.filter(e => e.target.includes(`[${activityLocFilter}]`));
                return (
            <details open={activity.length > 0} style={{ background: 'var(--surface)', borderRadius: 8, border: '1px solid var(--border)', overflow: 'hidden' }}>
                <summary style={{ padding: '14px 20px', cursor: 'pointer', fontSize: 14, fontWeight: 700, color: 'var(--text)', listStyle: 'none', display: 'flex', alignItems: 'center', gap: 10, userSelect: 'none' }}>
                    <span>📋</span> {t('inv.activity_log', 'Activity Log')} <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>({filtered.length})</span>
                    <select
                        className="if-input"
                        value={activityLocFilter}
                        onClick={e => e.stopPropagation()}
                        onChange={e => setActivityLocFilter(e.target.value)}
                        style={{ marginLeft: 'auto', fontSize: 11, padding: '4px 8px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-muted)', cursor: 'pointer', fontWeight: 400 }}
                    >
                        <option value="all">{t('inv.all_locations', 'All Locations')}</option>
                        {locations.map(loc => (
                            <option key={loc.id} value={loc.name}>{loc.name}</option>
                        ))}
                    </select>
                    {activity.length > 0 && (
                        <button
                            onClick={async (e) => { e.stopPropagation(); try { await fetch('/api/inventory/activity', { method: 'DELETE' }); await load(); } catch { /* offline */ } }}
                            style={{ fontSize: 11, padding: '4px 10px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-faint)', cursor: 'pointer', whiteSpace: 'nowrap' }}
                        >
                            {t('inv.clear', 'Clear')}
                        </button>
                    )}
                </summary>
                <div style={{ borderTop: '1px solid var(--border)', maxHeight: 300, overflowY: 'auto' }}>
                    {filtered.length === 0 ? (
                        <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>
                            {activityLocFilter === 'all'
                                ? t('inv.no_activity', 'No activity recorded yet — consume or restock items to see history')
                                : t('inv.no_activity_loc', `No activity for ${activityLocFilter}`)}
                        </div>
                    ) : (
                        filtered.map((entry, i) => {
                            const ago = formatTimeAgo(entry.timestamp, t);
                            const isConsume = entry.action_type === 'consumed' || entry.action.includes('consumed');
                            // Build i18n-safe action string
                            const actionLabel = entry.action_type
                                ? `${t(`inv.action_${entry.action_type}`, entry.action_type)} ${entry.qty ?? ''}x`
                                : entry.action;
                            return (
                                <div key={i} style={{
                                    padding: '10px 20px',
                                    borderBottom: i < filtered.length - 1 ? '1px solid var(--border)' : 'none',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 12,
                                    fontSize: 13,
                                }}>
                                    <span style={{ fontSize: 16, color: isConsume ? '#e74c3c' : '#3fb950', lineHeight: 1 }}>{isConsume ? '▼' : '▲'}</span>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <span style={{ fontWeight: 600, color: 'var(--text)' }}>{entry.who}</span>
                                        <span style={{ color: isConsume ? '#e74c3c' : '#3fb950', margin: '0 6px' }}>{actionLabel}</span>
                                        <span style={{ color: 'var(--text)' }}>{tTarget(entry.target)}</span>
                                    </div>
                                    <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{ago}</span>
                                </div>
                            );
                        })
                    )}
                </div>
            </details>
                );
            })()}

            {showAddModal && (
                <AddItemModal
                    locationId={activeLocId}
                    onClose={() => setShowAddModal(false)}
                    onAdd={async (item) => {
                        try {
                            const added = await store.addInventoryItem(item);
                            setItems(p => [...p, added]);
                            setShowAddModal(false);
                        } catch (e) {
                            console.error("Failed to save item", e);
                        }
                    }}
                />
            )}

            {modifyingItem && (
                <ModifyQuantityModal
                    item={modifyingItem.item}
                    displayName={tName(modifyingItem.item)}
                    type={modifyingItem.type}
                    onClose={() => setModifyingItem(null)}
                    onConfirm={async (amount) => {
                        if (modifyingItem.type === 'add') {
                            await handleRestock(modifyingItem.item.id, amount);
                        } else {
                            await handleConsume(modifyingItem.item.id, amount);
                        }
                    }}
                />
            )}

            {editingLocation && (
                <LocationSettings
                    config={editingLocation}
                    isNew={!locations.some(l => l.id === editingLocation.id)}
                    onClose={() => setEditingLocation(null)}
                    onSave={async (c) => {
                        const isNew = !locations.some(l => l.id === c.id);
                        if (isNew) {
                            await store.addInventoryLocation(c);
                        } else {
                            await store.updateInventoryLocation(c.id, c);
                        }
                        await load();
                        setActiveLocId(c.id);
                        setEditingLocation(null);
                    }}
                    onDelete={async (id) => {
                        await store.deleteInventoryLocation(id);
                        setActiveLocId('loc-1');
                        await load();
                        setEditingLocation(null);
                    }}
                />
            )}
        </div>
        </div>
    );
}
