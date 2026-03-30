/**
 * ChatMessage — single chat bubble with avatar, sender header, message body,
 * reply-to quote, emoji reactions, and static action tray.
 */
import { useState, useRef, useEffect } from 'react';
import type { ChatMsg, RosterMember } from '../../types/comms';
import { ROLE_COLORS } from '../../types/comms';

interface Props {
    msg: ChatMsg;
    isMe: boolean;
    roster: RosterMember[];
    formatTime: (iso: string) => string;
    allMessages?: ChatMsg[];
    onReply?: (msgId: string) => void;
    onReact?: (msgId: string, emoji: string) => void;
    onCall?: (senderName: string) => void;
    onVideoCall?: (senderName: string) => void;
    userName?: string;
}

const QUICK_EMOJIS = ['👍', '❤️', '😂', '👀', '🩹', '🚨'];

export default function ChatMessage({ msg, isMe, roster, formatTime, allMessages, onReply, onReact, onCall, onVideoCall, userName }: Props) {
    const senderRoster = roster.find(r => r.name.toLowerCase() === msg.sender_name.toLowerCase());
    const avatarUrl = senderRoster?.avatar_url;
    const initial = msg.sender_name.charAt(0).toUpperCase();
    const roleColor = ROLE_COLORS[msg.sender_role] || '#888';
    const [showEmojis, setShowEmojis] = useState(false);
    const emojiRef = useRef<HTMLDivElement>(null);

    // Whether we should show call/video actions (only for messages from others, not system)
    const showCallActions = !isMe && msg.sender_role !== 'system';

    // Close emoji picker on outside click
    useEffect(() => {
        if (!showEmojis) return;
        const handler = (e: MouseEvent) => {
            if (emojiRef.current && !emojiRef.current.contains(e.target as Node)) setShowEmojis(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [showEmojis]);

    // Find the replied-to message
    const repliedMsg = msg.reply_to && allMessages
        ? allMessages.find(m => m.id === msg.reply_to)
        : null;

    return (
        <div
            style={{
                display: 'flex', gap: 8, alignItems: 'flex-start',
                flexDirection: isMe ? 'row-reverse' : 'row',
                alignSelf: isMe ? 'flex-end' : 'flex-start',
                maxWidth: '85%', position: 'relative',
            }}
        >
            {/* Avatar */}
            <div style={{
                width: 28, height: 28, borderRadius: '50%', flexShrink: 0, overflow: 'hidden',
                background: avatarUrl ? 'transparent' : roleColor + '22',
                border: `2px solid ${roleColor}44`,
                display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 2,
            }}>
                {avatarUrl
                    ? <img src={avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <span style={{ fontSize: 11, fontWeight: 700, color: roleColor }}>{initial}</span>
                }
            </div>

            {/* Content */}
            <div style={{ flex: 1, minWidth: 0 }}>
                {/* Header: name → target, time */}
                <div style={{ fontSize: 10, color: 'var(--text-faint)', marginBottom: 2, display: 'flex', gap: 6, alignItems: 'center' }}>
                    <span style={{ color: roleColor, fontWeight: 600 }}>{msg.sender_name}</span>
                    {msg.target_name && <span style={{ color: '#f0a500' }}>→ {msg.target_name}</span>}
                    <span>{formatTime(msg.timestamp)}</span>
                </div>

                {/* Reply-to quote */}
                {repliedMsg && (
                    <div style={{
                        padding: '4px 10px', marginBottom: 2, borderRadius: 6,
                        background: 'var(--bg)', borderLeft: '3px solid #3fb95066',
                        fontSize: 11, color: 'var(--text-faint)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                        <span style={{ fontWeight: 600, color: 'var(--text-muted)' }}>{repliedMsg.sender_name}:</span>{' '}
                        {repliedMsg.message.length > 80 ? repliedMsg.message.slice(0, 80) + '…' : repliedMsg.message}
                    </div>
                )}

                {/* Bubble */}
                <div style={{
                    padding: '8px 14px', borderRadius: 10, fontSize: 13, lineHeight: 1.4,
                    background: isMe ? '#1a2a1a' : 'var(--surface)',
                    border: `1px solid ${isMe ? '#3fb95033' : 'var(--border)'}`,
                    color: 'var(--text)', wordBreak: 'break-word',
                }}>
                    {msg.message}
                </div>

                {/* Reactions */}
                {msg.reactions && Object.keys(msg.reactions).length > 0 && (
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
                        {Object.entries(msg.reactions).map(([emoji, users]) => (
                            <button
                                key={emoji}
                                onClick={() => onReact?.(msg.id, emoji)}
                                title={users.join(', ')}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: 3,
                                    padding: '2px 8px', borderRadius: 10,
                                    background: users.includes(userName || '') ? '#3fb95022' : 'var(--bg)',
                                    border: `1px solid ${users.includes(userName || '') ? '#3fb95044' : 'var(--border)'}`,
                                    fontSize: 12, cursor: 'pointer', color: 'var(--text)',
                                }}
                            >
                                {emoji} <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{users.length}</span>
                            </button>
                        ))}
                    </div>
                )}

                {/* ── Static Action Tray ──────────────────────────────────── */}
                <div style={{
                    display: 'flex', alignItems: 'center', gap: 2, marginTop: 4,
                    position: 'relative',
                }}>
                    {/* Reply */}
                    {onReply && (
                        <button
                            onClick={() => onReply(msg.id)}
                            title="Reply"
                            style={{
                                background: 'none', border: 'none', cursor: 'pointer',
                                padding: '3px 6px', fontSize: 13, borderRadius: 4,
                                color: 'var(--text-faint)', opacity: 0.6,
                                transition: 'opacity 0.15s',
                            }}
                            onMouseEnter={e => { e.currentTarget.style.opacity = '1'; }}
                            onMouseLeave={e => { e.currentTarget.style.opacity = '0.6'; }}
                        >↩</button>
                    )}

                    {/* Emote toggle */}
                    {onReact && (
                        <div ref={emojiRef} style={{ position: 'relative' }}>
                            <button
                                onClick={() => setShowEmojis(!showEmojis)}
                                title="React"
                                style={{
                                    background: showEmojis ? 'var(--surface)' : 'none',
                                    border: showEmojis ? '1px solid var(--border)' : 'none',
                                    cursor: 'pointer',
                                    padding: '3px 6px', fontSize: 13, borderRadius: 4,
                                    color: 'var(--text-faint)', opacity: showEmojis ? 1 : 0.6,
                                    transition: 'opacity 0.15s',
                                }}
                                onMouseEnter={e => { if (!showEmojis) e.currentTarget.style.opacity = '1'; }}
                                onMouseLeave={e => { if (!showEmojis) e.currentTarget.style.opacity = '0.6'; }}
                            >😊</button>
                            {showEmojis && (
                                <div style={{
                                    position: 'absolute', bottom: '100%', left: 0,
                                    display: 'flex', gap: 2, padding: '4px 6px', marginBottom: 4,
                                    background: 'var(--surface)', border: '1px solid var(--border)',
                                    borderRadius: 8, boxShadow: '0 2px 8px #0004', zIndex: 5,
                                    whiteSpace: 'nowrap',
                                }}>
                                    {QUICK_EMOJIS.map(emoji => (
                                        <button
                                            key={emoji}
                                            onClick={() => { onReact(msg.id, emoji); setShowEmojis(false); }}
                                            style={{
                                                background: 'none', border: 'none', cursor: 'pointer',
                                                padding: '3px 5px', fontSize: 16, borderRadius: 4,
                                            }}
                                        >{emoji}</button>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Call / Video (only for other users, not system) */}
                    {showCallActions && onCall && (
                        <button
                            onClick={() => onCall(msg.sender_name)}
                            title={`Call ${msg.sender_name}`}
                            style={{
                                background: 'none', border: 'none', cursor: 'pointer',
                                padding: '3px 6px', fontSize: 13, borderRadius: 4,
                                color: 'var(--text-faint)', opacity: 0.6,
                                transition: 'opacity 0.15s',
                            }}
                            onMouseEnter={e => { e.currentTarget.style.opacity = '1'; }}
                            onMouseLeave={e => { e.currentTarget.style.opacity = '0.6'; }}
                        >📞</button>
                    )}
                    {showCallActions && onVideoCall && (
                        <button
                            onClick={() => onVideoCall(msg.sender_name)}
                            title={`Video call ${msg.sender_name}`}
                            style={{
                                background: 'none', border: 'none', cursor: 'pointer',
                                padding: '3px 6px', fontSize: 13, borderRadius: 4,
                                color: 'var(--text-faint)', opacity: 0.6,
                                transition: 'opacity 0.15s',
                            }}
                            onMouseEnter={e => { e.currentTarget.style.opacity = '1'; }}
                            onMouseLeave={e => { e.currentTarget.style.opacity = '0.6'; }}
                        >📹</button>
                    )}
                </div>
            </div>
        </div>
    );
}
