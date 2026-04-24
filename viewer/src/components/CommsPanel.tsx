/**
 * CommsPanel — Communications hub for Eve OS: Triage
 * Teams-style layout: thread sidebar + chat pane + inline call controls.
 */
import { useState, useEffect, useCallback } from 'react';
import { useT } from '../services/i18n';
import { useChat } from '../hooks/useChat';
import { ROLE_COLORS } from '../types/comms';
import ChatMessage from './comms/ChatMessage';
import ThreadList from './comms/ThreadList';
import { apiMutate, ttsSynthesize } from '../services/api';
import { useTranslateLiveCall } from '../hooks/useTranslateLiveCall';
import { getSharedAudioContext } from '../hooks/useTTS';
import { useWebRTC } from '../hooks/useWebRTC';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function CommsPanel({ webRTC }: { webRTC: ReturnType<typeof useWebRTC> }) {
    const { t, lang } = useT();
    const userName = localStorage.getItem('eve-mesh-name') || 'Unknown';
    const userRole = localStorage.getItem('eve-mesh-role') || 'responder';
    const meshMode = localStorage.getItem('eve-mesh-mode') || '';
    const isLeader = meshMode === 'leader';

    const isMobile = window.innerWidth < 700;
    const [showThreads, setShowThreads] = useState(!isMobile);


    const {
        callActive, callTarget, callType, callMuted, callDuration, fmtDuration,
        startCall, endCall, toggleMute, setLocalMicMuted,
        videoRefCallback, remoteVideoRefCallback, remoteAudioRef,
        remoteAudioLevel,
        incomingPayload, sendTranslationPayload,
    } = webRTC;

    const liveCall = useTranslateLiveCall();
    const [showSubtitles, setShowSubtitles] = useState(true);
    const [subtitleText, setSubtitleText] = useState('');
    const [prevPayload, setPrevPayload] = useState<{text: string, lang: string, timestamp: number} | null>(null);
    const [isPlayingTTS, setIsPlayingTTS] = useState(false);

    // Safe render derivation to prevent cascading effect renders
    if (incomingPayload !== prevPayload) {
        setPrevPayload(incomingPayload);
        if (incomingPayload) {
            setSubtitleText(incomingPayload.text);
        }
    }

    // Play incoming TTS payload
    useEffect(() => {
        if (incomingPayload) {
            let isActive = true;
            
            (async () => {
                setIsPlayingTTS(true);
                if (remoteAudioRef.current) remoteAudioRef.current.volume = 0.2;
                
                try {
                    const res = await ttsSynthesize(incomingPayload.text, undefined, 1.0, incomingPayload.lang);
                    const data = await res.json();
                    
                    if (!isActive) return;

                    if (data.audio_base64) {
                        const b64 = data.audio_base64.includes(',') ? data.audio_base64.split(',')[1] : data.audio_base64;
                        const buf = await fetch(`data:audio/wav;base64,${b64}`).then(r => r.arrayBuffer());
                        
                        if (!isActive) return;

                        const ctx = getSharedAudioContext();
                        const decoded = await ctx.decodeAudioData(buf);
                        const src = ctx.createBufferSource();
                        src.buffer = decoded;
                        src.connect(ctx.destination);
                        src.onended = () => {
                            if (!isActive) return;
                            setIsPlayingTTS(false);
                            if (remoteAudioRef.current) remoteAudioRef.current.volume = 1.0;
                        };
                        if (ctx.state === 'suspended') {
                            await ctx.resume().catch(() => {});
                        }
                        src.start();
                    } else {
                        setIsPlayingTTS(false);
                    }
                } catch {
                    if (isActive) setIsPlayingTTS(false);
                }
            })();

            return () => { isActive = false; };
        }
    }, [incomingPayload, remoteAudioRef]);

    useEffect(() => {
        if (subtitleText) {
            const tm = setTimeout(() => setSubtitleText(''), 10000);
            return () => clearTimeout(tm);
        }
    }, [subtitleText]);

    const handlePTTStart = () => {
        setLocalMicMuted(true);
        liveCall.startRecording();
    };

    const handlePTTEnd = () => {
        setLocalMicMuted(false);
        liveCall.stopAndTranslate(lang, lang, (text, translationLang) => {
            sendTranslationPayload(text, translationLang);
        });
    };
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
        if (isMobile) setShowThreads(false);
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
            await apiMutate('react_to_message', `/mesh/chat/${msgId}/react`, { msg_id: msgId, emoji, user: userName }, {
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

            {/* ── Video Call Stage (Immersive Overlay) ───────────────────── */}
            {callActive && (
                <div style={{
                    position: 'absolute', inset: 0, zIndex: 100,
                    background: '#0a0a0a', display: 'flex', flexDirection: 'column'
                }}>
                    {/* Header */}
                    <div style={{
                        padding: isMobile ? 'calc(env(safe-area-inset-top, 24px) + 8px) 16px 16px' : '16px 24px', 
                        display: 'flex', justifyContent: 'space-between',
                        alignItems: 'center', background: 'linear-gradient(to bottom, rgba(0,0,0,0.8), transparent)',
                        position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10, pointerEvents: 'none',
                        flexWrap: 'wrap', gap: 8
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                            <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#e74c3c', animation: 'pulse 1.5s infinite' }} />
                            <div style={{ color: '#fff', fontSize: 18, fontWeight: 600 }}>{callTarget}</div>
                            <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: 14, fontFamily: 'monospace' }}>{fmtDuration(callDuration)}</div>
                            {isPlayingTTS && (
                                <div style={{ 
                                    background: 'rgba(46, 204, 113, 0.2)', color: '#2ecc71', 
                                    padding: '4px 8px', borderRadius: 12, fontSize: 12, fontWeight: 600,
                                    border: '1px solid rgba(46, 204, 113, 0.5)', marginLeft: 8
                                }}>
                                    Translating...
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Main Video Area */}
                    <div style={{ flex: 1, position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {callType === 'video' ? (
                            <video
                                ref={remoteVideoRefCallback}
                                autoPlay playsInline
                                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            />
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}>
                                {/* Voice Call Avatar with Audio Level visualizer */}
                                <div style={{
                                    width: 120, height: 120, borderRadius: '50%',
                                    background: `linear-gradient(135deg, #3498db, #2ecc71)`,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    boxShadow: `0 0 0 ${remoteAudioLevel / 4}px rgba(46, 204, 113, 0.3)`,
                                    transition: 'box-shadow 0.1s ease-out'
                                }}>
                                    <span style={{ fontSize: 48, color: '#fff', fontWeight: 700 }}>{callTarget?.charAt(0).toUpperCase()}</span>
                                </div>
                                <div style={{ color: '#fff', fontSize: 18, opacity: 0.8 }}>Voice Call</div>
                            </div>
                        )}

                        {/* Local PiP */}
                        {callType === 'video' && (
                            <div style={{
                                position: 'absolute', bottom: isMobile ? 120 : 100, right: isMobile ? 16 : 24,
                                width: isMobile ? 90 : 140, height: isMobile ? 130 : 200, borderRadius: 12, overflow: 'hidden',
                                border: '2px solid rgba(255,255,255,0.2)',
                                background: '#111', boxShadow: '0 8px 24px rgba(0,0,0,0.5)', zIndex: 15
                            }}>
                                <video
                                    ref={videoRefCallback}
                                    autoPlay playsInline muted
                                    style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }}
                                />
                            </div>
                        )}

                        {/* Subtitles Overlay */}
                        {subtitleText && showSubtitles && (
                            <div style={{
                                position: 'absolute', bottom: 140, left: '50%', transform: 'translateX(-50%)',
                                background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(10px)',
                                padding: '12px 24px', borderRadius: 8, maxWidth: '80%',
                                color: '#fff', fontSize: 18, textAlign: 'center',
                                border: '1px solid rgba(255,255,255,0.1)',
                                boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
                                zIndex: 20
                            }}>
                                {subtitleText}
                            </div>
                        )}
                    </div>

                    {/* Controls Footer */}
                    <div style={{
                        padding: isMobile ? '16px 12px calc(env(safe-area-inset-bottom, 24px) + 8px)' : '24px', 
                        background: 'linear-gradient(to top, rgba(0,0,0,0.9), transparent)',
                        display: 'flex', justifyContent: 'center', alignItems: 'center', gap: isMobile ? 12 : 24, flexWrap: 'wrap',
                        position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 10
                    }}>
                        {/* Translation Controls (Sender PTT) */}
                        <div style={{
                            display: 'flex', alignItems: 'center', gap: 8,
                            background: 'rgba(255,255,255,0.1)', backdropFilter: 'blur(10px)',
                            padding: '6px 12px', borderRadius: 24, border: '1px solid rgba(255,255,255,0.1)'
                        }}>
                            {/* Subtitles Toggle */}
                            <button
                                onClick={() => setShowSubtitles(s => !s)}
                                style={{
                                    background: showSubtitles ? 'rgba(52, 152, 219, 0.3)' : 'transparent',
                                    color: showSubtitles ? '#fff' : 'rgba(255,255,255,0.6)',
                                    border: 'none', padding: '6px 10px', borderRadius: 12, fontSize: 13, cursor: 'pointer', transition: 'all 0.2s', fontWeight: 600
                                }}
                                title={showSubtitles ? "Hide Subtitles" : "Show Subtitles"}
                            >
                                CC
                            </button>
                            <button
                                onClick={() => {
                                    if (liveCall.state === 'idle') handlePTTStart();
                                    else if (liveCall.state === 'recording') handlePTTEnd();
                                }}
                                disabled={liveCall.state === 'processing'}
                                style={{
                                    background: liveCall.state === 'recording' ? '#e74c3c' : 'rgba(52, 152, 219, 0.2)',
                                    color: liveCall.state === 'recording' ? '#fff' : '#3498db',
                                    border: 'none', padding: '6px 16px', borderRadius: 16,
                                    cursor: liveCall.state === 'processing' ? 'not-allowed' : 'pointer',
                                    fontSize: 13, fontWeight: 600,
                                    transition: 'all 0.2s',
                                    boxShadow: liveCall.state === 'recording' ? '0 0 12px rgba(231, 76, 60, 0.6)' : 'none',
                                    display: 'flex', alignItems: 'center', gap: 6,
                                    opacity: liveCall.state === 'processing' ? 0.6 : 1
                                }}
                            >
                                {liveCall.state === 'recording' ? '🔴 Stop & Send' : 
                                 liveCall.state === 'processing' ? '⏳ Processing' : 
                                 'Tap to Translate'}
                            </button>
                        </div>

                        {/* Mute Button */}
                        <button
                            onClick={toggleMute}
                            style={{
                                width: 56, height: 56, borderRadius: '50%',
                                background: callMuted ? '#fff' : 'rgba(255,255,255,0.2)',
                                color: callMuted ? '#000' : '#fff',
                                border: 'none', fontSize: 24, cursor: 'pointer',
                                backdropFilter: 'blur(10px)', transition: 'all 0.2s',
                                display: 'flex', alignItems: 'center', justifyContent: 'center'
                            }}
                            title={callMuted ? t('comms.unmute', 'Unmute') : t('comms.mute', 'Mute')}
                        >
                            {callMuted ? '🔇' : '🎙️'}
                        </button>

                        {/* End Call Button */}
                        <button
                            onClick={endCall}
                            style={{
                                width: 56, height: 56, borderRadius: '50%',
                                background: '#e74c3c', color: '#fff',
                                border: 'none', fontSize: 24, cursor: 'pointer',
                                boxShadow: '0 4px 12px rgba(231, 76, 60, 0.4)',
                                transition: 'transform 0.1s', display: 'flex', alignItems: 'center', justifyContent: 'center'
                            }}
                            title={t('comms.end_call', 'End Call')}
                        >
                            ❌
                        </button>
                    </div>
                </div>
            )}

            {/* ── Thread Sidebar ──────────────────────────────────────────── */}
            {showThreads && (
                <div style={{
                    width: isMobile ? '100%' : 280,
                    minWidth: isMobile ? undefined : 220,
                    maxWidth: isMobile ? undefined : 320,
                    flexShrink: 0, position: isMobile ? 'absolute' : 'relative',
                    inset: isMobile ? 0 : undefined,
                    zIndex: isMobile ? 10 : undefined,
                    background: 'var(--bg)',
                    display: 'flex', flexDirection: 'column',
                }}>
                    {/* Sidebar header: toggle + online count + clear */}
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '10px 14px', borderBottom: '1px solid var(--border)',
                        background: 'var(--surface)', flexShrink: 0,
                    }}>
                        <button
                            onClick={() => setShowThreads(s => !s)}
                            style={{
                                background: 'none', border: 'none', fontSize: 18,
                                cursor: 'pointer', color: 'var(--text-muted)', padding: '2px 6px',
                                lineHeight: 1,
                            }}
                            title={t('comms.hide_threads', 'Hide threads')}
                        >◀</button>
                        <div style={{ flex: 1, fontSize: 10, color: 'var(--text-faint)' }}>
                            {connectedMembers.length} {t('comms.online', 'online')}
                        </div>
                        {isLeader && (
                            <button
                                onClick={async () => {
                                    if (!confirm(t('comms.clear_confirm', 'Clear all messages from the board?'))) return;
                                    try { await apiMutate('clear_chat', '/mesh/chat', {}, { method: 'DELETE' }); clearMessages(); } catch { /* offline */ }
                                }}
                                style={{ padding: '3px 8px', fontSize: 10, background: 'transparent', border: '1px solid #e74c3c33', borderRadius: 4, color: '#e74c3c', cursor: 'pointer', flexShrink: 0 }}
                                title={t('comms.clear_board', 'Clear Board')}
                            >🗑</button>
                        )}
                    </div>
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
                    {/* Toggle threads button (only when sidebar is hidden) */}
                    {!showThreads && (
                        <button
                            onClick={() => setShowThreads(true)}
                            style={{
                                background: 'none', border: 'none', fontSize: 18,
                                cursor: 'pointer', color: 'var(--text-muted)', padding: '2px 6px',
                                lineHeight: 1,
                            }}
                            title={t('comms.show_threads', 'Show threads')}
                        >☰</button>
                    )}

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
                        <div style={{ flex: 1, fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
                            {t('comms.board', 'Board')}
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

                    {/* Active call — small header indicator */}
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
