/**
 * useChat — handles message state, polling, sending, filtering,
 *           and localStorage persistence for offline resilience.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import type { ChatMsg, RosterMember } from '../types/comms';
import { API_BASE, POLL_INTERVAL } from '../types/comms';
import { api, apiMutate } from '../services/api';

const STORAGE_CAP = 500; // match server cap

/** localStorage key scoped to user so different identities don't collide */
function storageKey(userName: string) {
    return `eve-mesh-chat-${userName.toLowerCase().trim()}`;
}

/** Load cached messages from localStorage */
function loadCachedMessages(userName: string): ChatMsg[] {
    try {
        const raw = localStorage.getItem(storageKey(userName));
        if (raw) return JSON.parse(raw);
    } catch { /* corrupt data — start fresh */ }
    return [];
}

/** Save messages to localStorage, capped */
function cacheMessages(userName: string, msgs: ChatMsg[]) {
    try {
        const capped = msgs.slice(-STORAGE_CAP);
        localStorage.setItem(storageKey(userName), JSON.stringify(capped));
    } catch { /* storage full — degrade silently */ }
}

/** Merge server + local: server wins for same ID, local fills gaps */
function mergeMessages(server: ChatMsg[], local: ChatMsg[]): ChatMsg[] {
    const byId = new Map<string, ChatMsg>();
    for (const m of local) byId.set(m.id, m);
    for (const m of server) byId.set(m.id, m); // server overwrites
    const merged = Array.from(byId.values());
    merged.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    return merged.slice(-STORAGE_CAP);
}

interface UseChatOptions {
    userName: string;
    userRole: string;
    lang: string;
    isLeader: boolean;
    callActive: boolean;
}

export function useChat({ userName, userRole, lang, isLeader, callActive }: UseChatOptions) {
    // Initialize from localStorage for instant display before first poll
    const [messages, setMessages] = useState<ChatMsg[]>(() => loadCachedMessages(userName));
    const [roster, setRoster] = useState<RosterMember[]>([]);
    const [newMsg, setNewMsg] = useState('');
    const [targetContact, setTargetContact] = useState('');
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const prevMsgCountRef = useRef(0);

    // ── Fetch ────────────────────────────────────────────────────────────────

    const fetchMessages = useCallback(async () => {
        try {
            const serverMsgs = await api<ChatMsg[]>('list_chat', '/mesh/chat?limit=200', { limit: 200 });
            setMessages(prev => {
                const merged = mergeMessages(serverMsgs, prev);
                cacheMessages(userName, merged);
                return merged;
            });
        } catch { /* offline — keep showing cached messages */ }
    }, [userName]);

    const fetchRoster = useCallback(async () => {
        try {
            const data = await api<RosterMember[]>('list_roster', '/roster');
            setRoster(data);
        } catch { /* offline */ }
    }, []);

    // Poll (pauses during active calls to prevent video re-renders)
    useEffect(() => {
        queueMicrotask(() => { fetchMessages(); fetchRoster(); });
        const poll = setInterval(() => { if (!callActive) { fetchMessages(); fetchRoster(); } }, POLL_INTERVAL);
        return () => clearInterval(poll);
    }, [fetchMessages, fetchRoster]); // eslint-disable-line react-hooks/exhaustive-deps

    // Auto-scroll only on genuinely new messages
    useEffect(() => {
        if (messages.length > prevMsgCountRef.current) {
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
        prevMsgCountRef.current = messages.length;
    }, [messages]);

    // ── Clear ────────────────────────────────────────────────────────────────

    const clearMessages = useCallback(() => {
        setMessages([]);
        cacheMessages(userName, []);
    }, [userName]);

    // ── Send ─────────────────────────────────────────────────────────────────

    const sendMessage = useCallback(async (replyTo?: string) => {
        if (!newMsg.trim()) return;

        // Non-English speakers: translate to English before sending
        let messageToSend = newMsg.trim();
        if (lang !== 'en') {
            try {
                const tr = await fetch(`${API_BASE}/api/translate`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: messageToSend, source: lang, target: 'en' }),
                });
                if (tr.ok) {
                    const td = await tr.json();
                    messageToSend = td.translated || messageToSend;
                }
            } catch { /* fallback to original */ }
        }

        try {
            const chatPayload = {
                sender_name: userName,
                sender_role: userRole,
                message: messageToSend,
                target_name: targetContact,
                ...(replyTo ? { reply_to: replyTo } : {}),
            };
            const entry = await apiMutate<ChatMsg>('send_chat', '/mesh/chat', chatPayload, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(chatPayload),
            });
            setNewMsg('');
            if (entry) {
                setMessages(prev => {
                    const updated = [...prev, entry];
                    cacheMessages(userName, updated);
                    return updated;
                });
            } else {
                fetchMessages();
            }
        } catch { /* offline */ }
    }, [newMsg, lang, userName, userRole, targetContact, fetchMessages]);

    const sendAttachment = useCallback(async (file: File) => {
        const fd = new FormData();
        fd.append('file', file);
        try {
            const uploadRes = await fetch(`${API_BASE}/api/mesh/chat/upload`, { method: 'POST', body: fd });
            if (!uploadRes.ok) return;
            const { url, filename } = await uploadRes.json();
            const r = await fetch(`${API_BASE}/api/mesh/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sender_name: userName,
                    sender_role: userRole,
                    message: '',
                    target_name: targetContact,
                    attachment_url: url,
                    attachment_name: filename,
                }),
            });
            if (r.ok) {
                const entry: ChatMsg = await r.json();
                setMessages(prev => {
                    const updated = [...prev, entry];
                    cacheMessages(userName, updated);
                    return updated;
                });
            } else {
                fetchMessages();
            }
        } catch { /* offline */ }
    }, [userName, userRole, targetContact, fetchMessages]);

    // ── Filter ───────────────────────────────────────────────────────────────

    const connectedMembers = roster.filter(m => m.status === 'connected');

    const filteredMessages = (() => {
        if (isLeader) {
            if (targetContact) {
                return messages.filter(m =>
                    (m.target_name?.toLowerCase() === targetContact.toLowerCase() &&
                        m.sender_name.toLowerCase() === userName.toLowerCase()) ||
                    (m.sender_name.toLowerCase() === targetContact.toLowerCase() &&
                        (!m.target_name || m.target_name.toLowerCase() === userName.toLowerCase()))
                );
            }
            return messages;
        }
        // Client: broadcasts (no target) + messages involving me
        const myMsgs = messages.filter(m =>
            !m.target_name ||
            m.target_name.toLowerCase() === userName.toLowerCase() ||
            m.sender_name.toLowerCase() === userName.toLowerCase()
        );
        if (targetContact) {
            return myMsgs.filter(m =>
                m.sender_name.toLowerCase() === targetContact.toLowerCase() ||
                m.target_name?.toLowerCase() === targetContact.toLowerCase()
            );
        }
        return myMsgs;
    })();

    // Callable members: filter out self, always show Base for clients
    const callableMembers = (() => {
        const filtered = connectedMembers.filter(m => m.name.toLowerCase() !== userName.toLowerCase());
        if (!isLeader) {
            const leaderAlreadyInList = filtered.some(m => m.role === 'leader');
            if (!leaderAlreadyInList) {
                const storedLeader = localStorage.getItem('eve-mesh-leader');
                const rosterLeader = roster.find(m => m.role === 'leader');
                const msgLeader = messages.find(m =>
                    m.sender_name.toLowerCase() !== userName.toLowerCase() &&
                    m.target_name?.toLowerCase() === userName.toLowerCase()
                );
                const leaderName = storedLeader || (rosterLeader ? rosterLeader.name : '') || (msgLeader ? msgLeader.sender_name : '') || 'Base';
                filtered.unshift({ id: 'leader-base', name: leaderName, role: 'leader', status: 'connected' });
            }
        }
        return filtered;
    })();

    const formatTime = (iso: string) => {
        try { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
        catch { return ''; }
    };

    return {
        messages, roster, newMsg, setNewMsg,
        targetContact, setTargetContact,
        messagesEndRef,
        sendMessage, sendAttachment, fetchMessages, fetchRoster, clearMessages,
        connectedMembers, filteredMessages, callableMembers,
        formatTime,
    };
}
