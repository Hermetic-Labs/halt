/**
 * ThreadList — sidebar showing Message Board + active DM threads.
 * Teams-style: left panel on desktop, slide-over on mobile.
 */
import { useMemo, useState, useEffect } from 'react';
import { useT } from '../../services/i18n';
import { ROLE_COLORS } from '../../types/comms';
import type { RosterMember, ChatMsg } from '../../types/comms';

// Module-level cache so thread preview translations persist across re-renders
const _threadPreviewCache = new Map<string, string>();

export interface ThreadInfo {
    id: string;           // 'board' or member name
    name: string;         // display name
    role: string;
    lastMessage?: string;
    lastTime?: string;
    unread: number;
    avatarUrl?: string;
}

interface Props {
    activeThread: string;       // 'board' or member name
    roster: RosterMember[];
    messages: ChatMsg[];
    userName: string;
    onSelect: (threadId: string) => void;
    onDelete?: (threadId: string) => void;
    onNewChat?: () => void;
}

export default function ThreadList({ activeThread, roster, messages, userName, onSelect, onDelete }: Props) {
    const { t, lang } = useT();

    // Build thread list from messages — find all unique DM partners
    const threads = useMemo<ThreadInfo[]>(() => {
        const board: ThreadInfo = {
            id: 'board', name: t('comms.message_board', 'Message Board'), role: 'board',
            lastMessage: messages.filter(m => !m.target_name).slice(-1)[0]?.message,
            lastTime: messages.filter(m => !m.target_name).slice(-1)[0]?.timestamp,
            unread: 0,
        };

        // Find DM partners from messages
        const partnerMap = new Map<string, { lastMsg: ChatMsg; count: number }>();
        for (const msg of messages) {
            if (!msg.target_name) continue;
            const partner = msg.sender_name.toLowerCase() === userName.toLowerCase()
                ? msg.target_name
                : msg.sender_name;
            const key = partner.toLowerCase();
            const existing = partnerMap.get(key);
            if (!existing || new Date(msg.timestamp) > new Date(existing.lastMsg.timestamp)) {
                partnerMap.set(key, { lastMsg: msg, count: (existing?.count || 0) + 1 });
            }
        }

        const dmThreads: ThreadInfo[] = [];
        partnerMap.forEach(({ lastMsg }, key) => {
            const rosterMember = roster.find(r => r.name.toLowerCase() === key);
            const displayName = rosterMember?.name || lastMsg.sender_name.toLowerCase() === userName.toLowerCase()
                ? lastMsg.target_name : lastMsg.sender_name;
            dmThreads.push({
                id: displayName,
                name: displayName,
                role: rosterMember?.role || lastMsg.sender_role || 'responder',
                lastMessage: lastMsg.message,
                lastTime: lastMsg.timestamp,
                unread: 0,
                avatarUrl: rosterMember?.avatar_url,
            });
        });

        // Sort DMs by most recent
        dmThreads.sort((a, b) => {
            if (!a.lastTime || !b.lastTime) return 0;
            return new Date(b.lastTime).getTime() - new Date(a.lastTime).getTime();
        });

        return [board, ...dmThreads];
    }, [messages, roster, userName, t]);

    // Counter bumped when async translations arrive — triggers re-render to read from cache
    const [, setTranslationTick] = useState(0);

    // Translate thread previews for non-English users (async only — no sync setState)
    useEffect(() => {
        if (lang === 'en') return;
        let cancelled = false;
        const toTranslate = threads.filter(th => th.lastMessage && !_threadPreviewCache.has(`${th.id}:${lang}:${th.lastMessage}`));
        for (const th of toTranslate) {
            const cacheKey = `${th.id}:${lang}:${th.lastMessage}`;
            fetch('/api/translate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: th.lastMessage, source: 'en', target: lang }),
            })
                .then(r => r.ok ? r.json() : null)
                .then(d => {
                    if (cancelled || !d) return;
                    const translated = d.translated || d.text || '';
                    if (translated && translated !== th.lastMessage) {
                        _threadPreviewCache.set(cacheKey, translated);
                        setTranslationTick(n => n + 1);
                    }
                })
                .catch(() => {});
        }
        return () => { cancelled = true; };
    }, [threads, lang]);

    const formatPreviewTime = (iso?: string) => {
        if (!iso) return '';
        try {
            const d = new Date(iso);
            const now = new Date();
            if (d.toDateString() === now.toDateString()) {
                return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            }
            return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
        } catch { return ''; }
    };

    return (
        <div style={{
            display: 'flex', flexDirection: 'column', height: '100%',
            borderRight: '1px solid var(--border)', background: 'var(--bg)',
            width: '100%', overflow: 'hidden',
        }}>
            {/* Header */}
            <div style={{
                padding: '16px 16px 12px', borderBottom: '1px solid var(--border)',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
                    💬 {t('comms.chats', 'Chats')}
                </span>
            </div>

            {/* Thread items */}
            <div style={{ flex: 1, overflowY: 'auto' }}>
                {threads.map(thread => {
                    const isActive = activeThread === thread.id;
                    const roleColor = thread.id === 'board' ? '#3fb950' : (ROLE_COLORS[thread.role] || '#888');
                    return (
                        <div
                            key={thread.id}
                            onClick={() => onSelect(thread.id)}
                            style={{
                                display: 'flex', alignItems: 'center', gap: 10,
                                padding: '10px 16px', cursor: 'pointer',
                                background: isActive ? 'var(--surface)' : 'transparent',
                                borderLeft: isActive ? '3px solid #3fb950' : '3px solid transparent',
                                transition: 'background 0.15s',
                            }}
                            onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'var(--surface)'; }}
                            onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                        >
                            {/* Avatar */}
                            {thread.id === 'board' ? (
                                <div style={{
                                    width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                                    background: '#3fb95022', display: 'flex', alignItems: 'center',
                                    justifyContent: 'center', fontSize: 16,
                                }}>📋</div>
                            ) : (
                                <div style={{
                                    width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                                    background: roleColor + '22', border: `2px solid ${roleColor}44`,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    overflow: 'hidden',
                                }}>
                                    {thread.avatarUrl
                                        ? <img src={thread.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                        : <span style={{ fontSize: 13, fontWeight: 700, color: roleColor }}>{thread.name.charAt(0).toUpperCase()}</span>
                                    }
                                </div>
                            )}

                            {/* Info */}
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                                    <span style={{
                                        fontSize: 13, fontWeight: 600,
                                        color: isActive ? 'var(--text)' : 'var(--text-muted)',
                                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                    }}>{thread.name}</span>
                                    <span style={{ fontSize: 10, color: 'var(--text-faint)', whiteSpace: 'nowrap', flexShrink: 0 }}>
                                        {formatPreviewTime(thread.lastTime)}
                                    </span>
                                </div>
                                {thread.lastMessage && (
                                    <div style={{
                                        fontSize: 11, color: 'var(--text-faint)', marginTop: 2,
                                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                    }}>
                                {(() => {
                                    const cacheKey = `${thread.id}:${lang}:${thread.lastMessage}`;
                                    const displayText = (lang !== 'en' && _threadPreviewCache.get(cacheKey)) || thread.lastMessage;
                                    return displayText!.length > 60
                                        ? displayText!.slice(0, 60) + '…'
                                        : displayText;
                                })()}
                                    </div>
                                )}
                            </div>

                            {/* Delete button (DMs only) */}
                            {thread.id !== 'board' && onDelete && (
                                <button
                                    onClick={e => { e.stopPropagation(); onDelete(thread.id); }}
                                    style={{
                                        background: 'none', border: 'none', color: 'var(--text-faint)',
                                        cursor: 'pointer', fontSize: 14, padding: '2px 4px', opacity: 0.4,
                                        lineHeight: 1,
                                    }}
                                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.opacity = '1'}
                                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.opacity = '0.4'}
                                    title={t('comms.delete_thread', 'Delete thread')}
                                >×</button>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* ── People (roster) — click to start a DM ─────────────── */}
            {(() => {
                const others = roster.filter(r => r.name.toLowerCase() !== userName.toLowerCase());
                if (others.length === 0) return null;
                // Exclude people who already have a thread
                const threadNames = new Set(threads.filter(t => t.id !== 'board').map(t => t.name.toLowerCase()));
                const newContacts = others.filter(r => !threadNames.has(r.name.toLowerCase()));
                if (newContacts.length === 0) return null;
                return (
                    <>
                        <div style={{
                            padding: '10px 16px 6px', fontSize: 10, fontWeight: 700,
                            color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.08em',
                            borderTop: '1px solid var(--border)',
                        }}>
                            👥 {t('comms.people', 'People')}
                        </div>
                        {newContacts.map(member => {
                            const roleColor = ROLE_COLORS[member.role] || '#888';
                            const isOnline = member.status === 'connected';
                            const isActive = activeThread === member.name;
                            return (
                                <div
                                    key={member.id}
                                    onClick={() => onSelect(member.name)}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: 10,
                                        padding: '8px 16px', cursor: 'pointer',
                                        background: isActive ? 'var(--surface)' : 'transparent',
                                        borderLeft: isActive ? '3px solid #3fb950' : '3px solid transparent',
                                        transition: 'background 0.15s',
                                    }}
                                    onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'var(--surface)'; }}
                                    onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                                >
                                    {/* Avatar with online dot */}
                                    <div style={{ position: 'relative', flexShrink: 0 }}>
                                        <div style={{
                                            width: 32, height: 32, borderRadius: '50%',
                                            background: roleColor + '22', border: `2px solid ${roleColor}44`,
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            overflow: 'hidden',
                                        }}>
                                            {member.avatar_url
                                                ? <img src={member.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                                : <span style={{ fontSize: 12, fontWeight: 700, color: roleColor }}>{member.name.charAt(0).toUpperCase()}</span>
                                            }
                                        </div>
                                        <div style={{
                                            position: 'absolute', bottom: -1, right: -1,
                                            width: 10, height: 10, borderRadius: '50%',
                                            background: isOnline ? '#3fb950' : '#484f58',
                                            border: '2px solid var(--bg)',
                                        }} />
                                    </div>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{
                                            fontSize: 12, fontWeight: 600, color: 'var(--text-muted)',
                                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                        }}>{member.name}</div>
                                        <div style={{ fontSize: 10, color: roleColor }}>{member.role}</div>
                                    </div>
                                </div>
                            );
                        })}
                    </>
                );
            })()}
        </div>
    );
}
