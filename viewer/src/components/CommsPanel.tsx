/**
 * CommsPanel — Communications hub for Eve OS: Triage
 * Teams-style layout: thread sidebar + chat pane + inline call controls.
 */
import { useState, useEffect, useCallback } from 'react';
import { useT } from '../services/i18n';
import { useChat } from '../hooks/useChat';
import { useWebRTC } from '../hooks/useWebRTC';
import { ROLE_COLORS } from '../types/comms';
import ChatMessage from './comms/ChatMessage';
import ThreadList from './comms/ThreadList';

export default function CommsPanel() {
    const { t, lang } = useT();
    const userName = localStorage.getItem('eve-mesh-name') || 'Unknown';
    const userRole = localStorage.getItem('eve-mesh-role') || 'responder';
    const meshMode = localStorage.getItem('eve-mesh-mode') || '';
    const isLeader = meshMode === 'leader';

    const [showThreads, setShowThreads] = useState(true);


    const {
        callActive, callDuration, callType, fmtDuration, startCall
    } = useWebRTC(userName, userRole);
    const {
        roster, newMsg, setNewMsg,
        targetContact, setTargetContact,
        messagesEndRef,
        sendMessage, sendAttachment, clearMessages,
        connectedMembers, filteredMessages, callableMembers,
        formatTime, messages,
    } = useChat({ userName, userRole, lang, isLeader, callActive });

    const [chatDragging, setChatDragging] = useState(false);

    // Permissions
    const checkPermissions = useCallback(async () => { }, []);
    useEffect(() => { checkPermissions(); }, [checkPermissions]);

    // Thread selection
    const handleThreadSelect = (threadId: string) => {
        setTargetContact(threadId === 'board' ? '' : threadId);
        // On mobile, close threads panel after selection
        if (window.innerWidth < 700) setShowThreads(false);
    };

    const handleDeleteThread = (threadId: string) => {
        // Clear local thread cache (localStorage-only)
        try {
            const key = `eve-thread-${userName}-${threadId}`.toLowerCase();
            localStorage.removeItem(key);
        } catch { /* ignore */ }
        if (targetContact === threadId) setTargetContact('');
    };

    // Reply state
    const [replyTo, setReplyTo] = useState<string | null>(null);
    const replyMsg = replyTo ? messages.find(m => m.id === replyTo) : null;

    // React handler
    const handleReact = async (msgId: string, emoji: string) => {
        try {
            await fetch(`/api/mesh/chat/${msgId}/react`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ emoji, user: userName }),
            });
            // fetchMessages will pick it up on next poll
        } catch { /* offline */ }
    };

    // Current thread contact info
    const currentContact = targetContact
        ? roster.find(r => r.name.toLowerCase() === targetContact.toLowerCase()) || callableMembers.find(m => m.name.toLowerCase() === targetContact.toLowerCase())
        : null;
    const contactRoleColor = currentContact ? (ROLE_COLORS[currentContact.role] || '#888') : '#3fb950';

    return (
        <div style={{ display: 'flex', height: '100%', overflow: 'hidden', position: 'relative' }}>

            {/* ── Thread Sidebar ──────────────────────────────────────────── */}
            {showThreads && (
                <div style={{
                    width: window.innerWidth < 700 ? '100%' : 280,
                    minWidth: window.innerWidth < 700 ? undefined : 220,
                    maxWidth: window.innerWidth < 700 ? undefined : 320,
                    flexShrink: 0, position: window.innerWidth < 700 ? 'absolute' : 'relative',
                    inset: window.innerWidth < 700 ? 0 : undefined,
                    zIndex: window.innerWidth < 700 ? 10 : undefined,
                    background: 'var(--bg)',
                }}>
                    <ThreadList
                        activeThread={targetContact || 'board'}
                        roster={roster}
                        messages={messages}
                        userName={userName}
                        onSelect={handleThreadSelect}
                        onDelete={handleDeleteThread}
                    />
                </div>
            )}

            {/* ── Chat Pane ───────────────────────────────────────────────── */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>

                {/* Chat Header */}
                <div style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '12px 16px', borderBottom: '1px solid var(--border)',
                    background: 'var(--surface)', flexShrink: 0,
                }}>
                    {/* Toggle threads button */}
                    <button
                        onClick={() => setShowThreads(s => !s)}
                        style={{
                            background: 'none', border: 'none', fontSize: 18,
                            cursor: 'pointer', color: 'var(--text-muted)', padding: '2px 6px',
                            lineHeight: 1,
                        }}
                        title={showThreads ? t('comms.hide_threads', 'Hide threads') : t('comms.show_threads', 'Show threads')}
                    >{showThreads ? '◀' : '☰'}</button>

                    {/* Contact info */}
                    {targetContact ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
                            <div style={{
                                width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                                background: contactRoleColor + '22', border: `2px solid ${contactRoleColor}44`,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                overflow: 'hidden',
                            }}>
                                {currentContact?.avatar_url
                                    ? <img src={currentContact.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                    : <span style={{ fontSize: 12, fontWeight: 700, color: contactRoleColor }}>{targetContact.charAt(0).toUpperCase()}</span>
                                }
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {targetContact}
                                </div>
                                <div style={{ fontSize: 10, color: contactRoleColor }}>
                                    {currentContact?.role || 'member'} · {currentContact?.status === 'connected' ? t('comms.online', 'online') : t('comms.offline', 'offline')}
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ flex: 1 }}>
                                <div style={{ fontSize: 10, color: 'var(--text-faint)' }}>
                                    {connectedMembers.length} {t('comms.online', 'online')}
                                </div>
                            </div>
                            {isLeader && (
                                <button
                                    onClick={async () => {
                                        if (!confirm(t('comms.clear_confirm', 'Clear all messages from the board?'))) return;
                                        try { await fetch('/api/mesh/chat', { method: 'DELETE' }); clearMessages(); } catch { /* offline */ }
                                    }}
                                    style={{ padding: '4px 10px', fontSize: 11, background: 'transparent', border: '1px solid #e74c3c33', borderRadius: 4, color: '#e74c3c', cursor: 'pointer', flexShrink: 0 }}
                                    title={t('comms.clear_board', 'Clear Board')}
                                >🗑 {t('comms.clear_board', 'Clear Board')}</button>
                            )}
                        </div>
                    )}

                    {/* Inline call buttons (DMs only) */}
                    {targetContact && !callActive && (
                        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                            <button
                                onClick={() => {
                                    const member = callableMembers.find(m => m.name.toLowerCase() === targetContact.toLowerCase());
                                    if (member) startCall(member, 'voice');
                                }}
                                style={{
                                    width: 34, height: 34, borderRadius: '50%',
                                    background: '#3fb95022', border: '1px solid #3fb95044',
                                    color: '#3fb950', fontSize: 16, cursor: 'pointer',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                }}
                                title={t('comms.call', 'Call')}
                            >📞</button>
                            <button
                                onClick={() => {
                                    const member = callableMembers.find(m => m.name.toLowerCase() === targetContact.toLowerCase());
                                    if (member) startCall(member, 'video');
                                }}
                                style={{
                                    width: 34, height: 34, borderRadius: '50%',
                                    background: '#3498db22', border: '1px solid #3498db44',
                                    color: '#3498db', fontSize: 16, cursor: 'pointer',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                }}
                                title={t('comms.video', 'Video')}
                            >📹</button>
                        </div>
                    )}

                    {/* Active call — small header indicator (popup has the controls) */}
                    {callActive && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                            <div style={{
                                width: 8, height: 8, borderRadius: '50%',
                                background: callType === 'video' ? '#3498db' : '#3fb950',
                                animation: 'pulse 1.5s ease-in-out infinite',
                            }} />
                            <span style={{ fontSize: 11, color: callType === 'video' ? '#3498db' : '#3fb950', fontFamily: 'var(--font-mono)' }}>
                                {fmtDuration(callDuration)}
                            </span>
                        </div>
                    )}
                </div>

                {/* Message list */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
                    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {filteredMessages.length === 0 ? (
                            <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-faint)', fontSize: 13 }}>
                                {targetContact
                                    ? t('comms.no_dm', `Start a conversation with ${targetContact}`)
                                    : t('comms.no_messages', 'No messages yet')}
                            </div>
                        ) : filteredMessages.map(m => (
                            <ChatMessage
                                key={m.id}
                                msg={m}
                                isMe={m.sender_name.toLowerCase() === userName.toLowerCase()}
                                roster={roster}
                                formatTime={formatTime}
                                allMessages={messages}
                                onReply={(id) => setReplyTo(id)}
                                onReact={handleReact}
                                onCall={(senderName) => {
                                    const member = callableMembers.find(mb => mb.name.toLowerCase() === senderName.toLowerCase());
                                    if (member && !callActive) startCall(member, 'voice');
                                }}
                                onVideoCall={(senderName) => {
                                    const member = callableMembers.find(mb => mb.name.toLowerCase() === senderName.toLowerCase());
                                    if (member && !callActive) startCall(member, 'video');
                                }}
                                userName={userName}
                            />
                        ))}
                        <div ref={messagesEndRef} />
                    </div>
                </div>

                {/* Reply banner */}
                {replyMsg && (
                    <div style={{
                        padding: '8px 16px', borderTop: '1px solid var(--border)',
                        background: 'var(--bg)', display: 'flex', alignItems: 'center', gap: 8,
                    }}>
                        <div style={{ flex: 1, borderLeft: '3px solid #3fb950', paddingLeft: 10, minWidth: 0 }}>
                            <div style={{ fontSize: 10, fontWeight: 600, color: '#3fb950' }}>{replyMsg.sender_name}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {replyMsg.message.length > 80 ? replyMsg.message.slice(0, 80) + '…' : replyMsg.message}
                            </div>
                        </div>
                        <button
                            onClick={() => setReplyTo(null)}
                            style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', fontSize: 16, padding: '2px 6px' }}
                        >×</button>
                    </div>
                )}

                {/* Input bar */}
                <div
                    style={{
                        borderTop: chatDragging ? '2px solid #3fb950' : '1px solid var(--border)', padding: '10px 16px',
                        display: 'flex', gap: 8, alignItems: 'center', background: chatDragging ? '#3fb95011' : 'var(--surface)',
                        transition: 'background 0.15s, border-color 0.15s',
                    }}
                    onDragOver={e => { e.preventDefault(); setChatDragging(true); }}
                    onDragLeave={() => setChatDragging(false)}
                    onDrop={e => {
                        e.preventDefault();
                        setChatDragging(false);
                        const files = e.dataTransfer.files;
                        if (files.length > 0) sendAttachment(files[0]);
                    }}
                >
                    {/* File attach button */}
                    <label style={{ cursor: 'pointer', fontSize: 18, color: 'var(--text-faint)', flexShrink: 0, display: 'flex', alignItems: 'center' }} title={t('comms.attach', 'Attach file')}>
                        📎
                        <input
                            type="file"
                            accept="image/*,.pdf,.doc,.docx"
                            style={{ display: 'none' }}
                            onChange={e => { const f = e.target.files?.[0]; if (f) sendAttachment(f); e.target.value = ''; }}
                        />
                    </label>
                    <input
                        className="if-input"
                        style={{ flex: 1, fontSize: 13, padding: '10px 14px', borderRadius: 20, border: '1px solid var(--border)', background: 'var(--bg)' }}
                        placeholder={targetContact ? t('comms.message_to', { name: targetContact }) || `Message ${targetContact}...` : t('comms.message_all', 'Message everyone...')}
                        value={newMsg}
                        onChange={e => setNewMsg(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') { sendMessage(replyTo || undefined); setReplyTo(null); } }}
                    />
                    <button
                        onClick={() => { sendMessage(replyTo || undefined); setReplyTo(null); }}
                        disabled={!newMsg.trim()}
                        style={{
                            width: 38, height: 38, borderRadius: '50%',
                            background: newMsg.trim() ? '#3fb950' : '#333',
                            border: 'none', cursor: newMsg.trim() ? 'pointer' : 'default',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            transition: 'background 0.15s',
                        }}
                    >
                        <span style={{ fontSize: 16, color: newMsg.trim() ? '#000' : '#666' }}>↑</span>
                    </button>
                </div>
            </div>
        </div>
    );
}
