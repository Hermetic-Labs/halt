/**
 * CommsPanel — Communications hub for Eve OS: Triage
 * Teams-style layout: thread sidebar + chat pane + inline call controls.
 */
import { useState, useEffect, useCallback } from 'react';
import { useT } from '../services/i18n';
import { useChat } from '../hooks/useChat';
import { useWebRTC } from '../hooks/useWebRTC';
import { useTTS } from '../hooks/useTTS';
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

    // Translation Room state
    const [showTranslateRoom, setShowTranslateRoom] = useState(false);
    const [trInput, setTrInput] = useState('');
    const [trOutput, setTrOutput] = useState('');
    const [trFrom, setTrFrom] = useState('en');
    const [trTo, setTrTo] = useState('es');
    const [trBusy, setTrBusy] = useState(false);
    const { speak: ttsSpeak, stopSpeak: stopTrSpeak, isSpeaking: trSpeaking } = useTTS();

    const TRANSLATE_LANGS: [string, string][] = [
        ['en', 'English'], ['es', 'Español'], ['fr', 'Français'], ['de', 'Deutsch'],
        ['pt', 'Português'], ['it', 'Italiano'], ['ar', 'العربية'], ['zh', '中文'],
        ['ja', '日本語'], ['ko', '한국어'], ['hi', 'हिन्दी'], ['uk', 'Українська'],
    ];

    const handleTranslateRoom = useCallback(async () => {
        if (!trInput.trim() || trBusy) return;
        setTrBusy(true);
        setTrOutput('');
        const text = trInput.trim();
        setTrInput('');
        try {
            const r = await fetch('/api/translate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text, source: trFrom, target: trTo }),
            });
            if (r.ok) {
                const d = await r.json();
                const translated = d.translated || text;
                setTrOutput(translated);
                // Auto-speak via WebSocket streaming TTS
                ttsSpeak(translated, trTo);
            }
        } catch { /* offline */ }
        setTrBusy(false);
    }, [trInput, trBusy, trFrom, trTo, ttsSpeak]);


    const {
        callActive, callTarget, callType, callMuted, callDuration,
        startCall, endCall, toggleMute,
        videoRefCallback, remoteVideoRefCallback,
        fmtDuration,
    } = useWebRTC(userName, userRole);
    const {
        roster, newMsg, setNewMsg,
        targetContact, setTargetContact,
        messagesEndRef,
        sendMessage,
        connectedMembers, filteredMessages, callableMembers,
        formatTime, messages,
    } = useChat({ userName, userRole, lang, isLeader, callActive });

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
                                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
                                    📋 {t('comms.message_board', 'Message Board')}
                                </div>
                                <div style={{ fontSize: 10, color: 'var(--text-faint)' }}>
                                    {connectedMembers.length} {t('comms.online', 'online')}
                                </div>
                            </div>
                            {isLeader && (
                                <button
                                    onClick={async () => {
                                        if (!confirm(t('comms.clear_confirm', 'Clear all messages from the board?'))) return;
                                        try { await fetch('/api/mesh/chat', { method: 'DELETE' }); } catch { /* offline */ }
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

                {/* ═══ Floating Call Popup (FaceTime style) ═══════════════ */}
                {callActive && (
                    <div style={{
                        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                        zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: 'rgba(0, 0, 0, 0.7)', backdropFilter: 'blur(4px)',
                    }}>
                        <div style={{
                            width: '90%', maxWidth: 420, borderRadius: 20,
                            background: '#111', overflow: 'hidden',
                            boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
                            display: 'flex', flexDirection: 'column',
                            maxHeight: '90vh',
                        }}>
                            {/* Video area */}
                            <div style={{ position: 'relative', background: '#000', minHeight: callType === 'video' ? 260 : 140, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                {callType === 'video' ? (
                                    <>
                                        {/* Remote video — full size */}
                                        <video ref={remoteVideoRefCallback} autoPlay playsInline style={{ width: '100%', height: 260, objectFit: 'cover' }} />
                                        {/* Local PiP — small corner */}
                                        <div style={{
                                            position: 'absolute', top: 12, right: 12,
                                            width: 90, height: 68, borderRadius: 10, overflow: 'hidden',
                                            border: '2px solid rgba(255,255,255,0.2)', boxShadow: '0 2px 10px #0008',
                                        }}>
                                            <video ref={videoRefCallback} autoPlay muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                        </div>
                                    </>
                                ) : (
                                    /* Voice call — avatar + name */
                                    <div style={{ textAlign: 'center', padding: 24 }}>
                                        <div style={{
                                            width: 64, height: 64, borderRadius: '50%', margin: '0 auto 12px',
                                            background: '#3fb95022', border: '2px solid #3fb95044',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            fontSize: 24, color: '#3fb950',
                                        }}>{callTarget?.charAt(0).toUpperCase() || '?'}</div>
                                        <div style={{ fontSize: 16, fontWeight: 600, color: '#fff' }}>{callTarget || 'Unknown'}</div>
                                        <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>Voice Call</div>
                                    </div>
                                )}
                                {/* Duration badge */}
                                <div style={{
                                    position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
                                    background: 'rgba(0,0,0,0.6)', padding: '3px 12px', borderRadius: 12,
                                    fontSize: 12, fontFamily: 'var(--font-mono)',
                                    color: callType === 'video' ? '#3498db' : '#3fb950',
                                }}>{fmtDuration(callDuration)}</div>
                            </div>

                            {/* ── Control Bar ─────────────────────────────── */}
                            <div style={{
                                display: 'flex', justifyContent: 'center', gap: 20, padding: '16px 24px',
                                background: '#1a1a1a',
                            }}>
                                {/* Mute */}
                                <button
                                    onClick={toggleMute}
                                    title={callMuted ? 'Unmute' : 'Mute'}
                                    style={{
                                        width: 52, height: 52, borderRadius: '50%',
                                        background: callMuted ? '#f0a50022' : '#ffffff15',
                                        border: `2px solid ${callMuted ? '#f0a500' : '#555'}`,
                                        color: callMuted ? '#f0a500' : '#fff', fontSize: 20, cursor: 'pointer',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        transition: 'all 0.15s',
                                    }}
                                >{callMuted ? '🔇' : '🔊'}</button>

                                {/* End Call */}
                                <button
                                    onClick={endCall}
                                    title="End Call"
                                    style={{
                                        width: 52, height: 52, borderRadius: '50%',
                                        background: '#e74c3c', border: '2px solid #e74c3c',
                                        color: '#fff', fontSize: 20, fontWeight: 700, cursor: 'pointer',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        transition: 'all 0.15s',
                                    }}
                                >✕</button>

                                {/* Translate Toggle */}
                                <button
                                    onClick={() => setShowTranslateRoom(s => !s)}
                                    title="Translation Room"
                                    style={{
                                        width: 52, height: 52, borderRadius: '50%',
                                        background: showTranslateRoom ? '#50C87822' : '#ffffff15',
                                        border: `2px solid ${showTranslateRoom ? '#50C878' : '#555'}`,
                                        color: showTranslateRoom ? '#50C878' : '#fff', fontSize: 20, cursor: 'pointer',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        transition: 'all 0.15s',
                                    }}
                                >🌐</button>
                            </div>

                            {/* ── Translation Room (collapsible) ──────── */}
                            {showTranslateRoom && (
                                <div style={{ padding: '12px 20px 16px', background: '#151515', borderTop: '1px solid #333', maxHeight: 220, overflowY: 'auto' }}>
                                    {/* Language selectors */}
                                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
                                        <select
                                            value={trFrom}
                                            onChange={e => setTrFrom(e.target.value)}
                                            style={{ flex: 1, padding: '5px 8px', background: '#222', border: '1px solid #444', borderRadius: 6, color: '#ddd', fontSize: 12 }}
                                        >
                                            {TRANSLATE_LANGS.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
                                        </select>
                                        <button
                                            onClick={() => { setTrFrom(trTo); setTrTo(trFrom); setTrOutput(''); }}
                                            style={{ background: 'none', border: '1px solid #444', borderRadius: 4, padding: '3px 6px', cursor: 'pointer', color: '#888', fontSize: 12 }}
                                        >⇄</button>
                                        <select
                                            value={trTo}
                                            onChange={e => setTrTo(e.target.value)}
                                            style={{ flex: 1, padding: '5px 8px', background: '#222', border: '1px solid #444', borderRadius: 6, color: '#ddd', fontSize: 12 }}
                                        >
                                            {TRANSLATE_LANGS.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
                                        </select>
                                    </div>
                                    {/* Input + Translate */}
                                    <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                                        <input
                                            style={{ flex: 1, fontSize: 12, padding: '8px 10px', borderRadius: 6, border: '1px solid #444', background: '#222', color: '#ddd' }}
                                            placeholder="Type to translate..."
                                            value={trInput}
                                            onChange={e => setTrInput(e.target.value)}
                                            onKeyDown={e => { if (e.key === 'Enter') handleTranslateRoom(); }}
                                        />
                                        <button
                                            onClick={handleTranslateRoom}
                                            disabled={!trInput.trim() || trBusy}
                                            style={{
                                                padding: '6px 14px', borderRadius: 6, border: 'none', cursor: trInput.trim() && !trBusy ? 'pointer' : 'default',
                                                background: trInput.trim() && !trBusy ? '#50C878' : '#333', color: trInput.trim() && !trBusy ? '#000' : '#666',
                                                fontSize: 12, fontWeight: 600, transition: 'background 0.15s',
                                            }}
                                        >{trBusy ? '…' : '🌐'}</button>
                                    </div>
                                    {/* Output */}
                                    {trOutput && (
                                        <div>
                                            <div style={{
                                                padding: '8px 12px', background: '#222', borderRadius: 6,
                                                border: '1px solid #444', fontSize: 13, lineHeight: 1.4,
                                                color: '#ddd', whiteSpace: 'pre-wrap', marginBottom: 6,
                                            }}>{trOutput}</div>
                                            <div style={{ display: 'flex', gap: 6 }}>
                                                <button
                                                    onClick={trSpeaking ? stopTrSpeak : handleTranslateRoom}
                                                    style={{
                                                        padding: '4px 10px', fontSize: 11, borderRadius: 4, cursor: 'pointer',
                                                        background: trSpeaking ? '#f0a50022' : '#3fb95022',
                                                        border: `1px solid ${trSpeaking ? '#f0a500' : '#3fb950'}44`,
                                                        color: trSpeaking ? '#f0a500' : '#3fb950',
                                                    }}
                                                >{trSpeaking ? '◼ Stop' : '▶ Speak'}</button>
                                                <button
                                                    onClick={() => { stopTrSpeak(); setTrOutput(''); }}
                                                    style={{
                                                        padding: '4px 10px', fontSize: 11, borderRadius: 4, cursor: 'pointer',
                                                        background: 'transparent', border: '1px solid #444', color: '#888',
                                                    }}
                                                >✕</button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                )}

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
                <div style={{
                    borderTop: '1px solid var(--border)', padding: '10px 16px',
                    display: 'flex', gap: 8, alignItems: 'center', background: 'var(--surface)',
                }}>
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
