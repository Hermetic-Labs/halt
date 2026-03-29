/**
 * useWebRTC — handles peer connections, call state, signaling, and media streams.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import type { RosterMember, CallType } from '../types/comms';

const RTC_CONFIG: RTCConfiguration = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

export function useWebRTC(userName: string, userRole: string) {
    const [callActive, setCallActive] = useState(false);
    const [callTarget, setCallTarget] = useState<string | null>(null);
    const [callType, setCallType] = useState<CallType>('voice');
    const [callMuted, setCallMuted] = useState(false);
    const [callDuration, setCallDuration] = useState(0);

    const localVideoRef = useRef<HTMLVideoElement>(null);
    const localStreamRef = useRef<MediaStream | null>(null);
    const callTimerRef = useRef<number | null>(null);
    const callTimeoutRef = useRef<number | null>(null);
    const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
    const remoteStreamRef = useRef<MediaStream | null>(null);
    const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
    const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
    const pendingIceCandidatesRef = useRef<RTCIceCandidateInit[]>([]);

    // Refs to avoid stale closures in the signal listener
    const callTypeRef = useRef<CallType>('voice');
    const callTargetRef = useRef<string | null>(null);
    useEffect(() => { callTypeRef.current = callType; }, [callType]);
    useEffect(() => { callTargetRef.current = callTarget; }, [callTarget]);
    // ── Signaling ────────────────────────────────────────────────────────────

    const sendWebRTC = useCallback((type: 'webrtc_offer' | 'webrtc_answer' | 'webrtc_ice', targetName: string, payload: Record<string, unknown>) => {
        window.dispatchEvent(new CustomEvent('eve-call-send', {
            detail: { type, target_name: targetName, caller_name: userName, ...payload }
        }));
    }, [userName]);

    const sendCallSignal = useCallback((type: string, targetName: string, callKind: CallType) => {
        window.dispatchEvent(new CustomEvent('eve-call-send', {
            detail: { type, target_name: targetName, caller_name: userName, caller_role: userRole, call_type: callKind }
        }));
    }, [userName, userRole]);

    // ── Peer Connection ──────────────────────────────────────────────────────

    const createPeerConnection = useCallback((targetName: string, cType: CallType) => {
        const pc = new RTCPeerConnection(RTC_CONFIG);
        peerConnectionRef.current = pc;
        pendingIceCandidatesRef.current = [];

        pc.onicecandidate = (e) => {
            if (e.candidate) sendWebRTC('webrtc_ice', targetName, { candidate: e.candidate.toJSON() });
        };

        pc.oniceconnectionstatechange = () => {
            console.log('[WebRTC] ICE state:', pc.iceConnectionState);
            if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
                console.warn('[WebRTC] Connection lost');
            }
        };

        pc.ontrack = (e) => {
            console.log('[WebRTC] Remote track received:', e.track.kind);
            if (!remoteStreamRef.current) remoteStreamRef.current = new MediaStream();
            remoteStreamRef.current.addTrack(e.track);

            if (cType === 'voice') {
                if (!remoteAudioRef.current) {
                    const audio = document.createElement('audio');
                    audio.autoplay = true;
                    audio.style.display = 'none';
                    document.body.appendChild(audio);
                    remoteAudioRef.current = audio;
                }
                remoteAudioRef.current.srcObject = remoteStreamRef.current;
            }
            if (cType === 'video' && remoteVideoRef.current) {
                remoteVideoRef.current.srcObject = remoteStreamRef.current;
            }
        };

        if (localStreamRef.current) {
            localStreamRef.current.getTracks().forEach(track => {
                pc.addTrack(track, localStreamRef.current!);
            });
        }

        return pc;
    }, [sendWebRTC]);

    // ── Cleanup ──────────────────────────────────────────────────────────────

    const cleanupWebRTC = useCallback(() => {
        if (peerConnectionRef.current) {
            peerConnectionRef.current.close();
            peerConnectionRef.current = null;
        }
        remoteStreamRef.current = null;
        pendingIceCandidatesRef.current = [];
        if (remoteAudioRef.current) {
            remoteAudioRef.current.srcObject = null;
            remoteAudioRef.current.remove();
            remoteAudioRef.current = null;
        }
        if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = null;
        }
        if (callTimeoutRef.current) {
            clearTimeout(callTimeoutRef.current);
            callTimeoutRef.current = null;
        }
    }, []);

    // ── Call Controls ─────────────────────────────────────────────────────────

    const endCall = useCallback(() => {
        cleanupWebRTC();
        if (localStreamRef.current) {
            localStreamRef.current.getTracks().forEach(t => t.stop());
            localStreamRef.current = null;
        }
        if (callTimerRef.current) clearInterval(callTimerRef.current);
        if (callTargetRef.current) sendCallSignal('call_end', callTargetRef.current, callTypeRef.current);
        setCallActive(false);
        setCallTarget(null);
        setCallDuration(0);
    }, [cleanupWebRTC, sendCallSignal]);

    const startCall = useCallback(async (member: RosterMember, type: CallType) => {
        try {
            const constraints: MediaStreamConstraints = type === 'video'
                ? { audio: true, video: { width: 640, height: 480 } }
                : { audio: true };
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            localStreamRef.current = stream;

            // Attach local video preview
            if (type === 'video' && localVideoRef.current) {
                localVideoRef.current.srcObject = stream;
            }

            setCallTarget(member.name);
            setCallType(type);
            setCallActive(true);
            setCallDuration(0);
            setCallMuted(false);
            callTimerRef.current = window.setInterval(() => setCallDuration(d => d + 1), 1000);
            sendCallSignal('call_request', member.name, type);

            // Auto-cancel after 30s if no answer
            callTimeoutRef.current = window.setTimeout(() => {
                console.warn('[WebRTC] Call timed out — no answer after 30s');
                endCall();
            }, 30_000);

            const stored = localStorage.getItem('eve-perm-state');
            const persisted = stored ? JSON.parse(stored) : {};
            persisted.mic = 'granted';
            if (type === 'video') persisted.camera = 'granted';
            localStorage.setItem('eve-perm-state', JSON.stringify(persisted));
        } catch (err) {
            console.error('[WebRTC] startCall error:', err);
        }
    }, [sendCallSignal, endCall]);

    const toggleMute = useCallback(() => {
        if (localStreamRef.current) {
            localStreamRef.current.getAudioTracks().forEach(t => { t.enabled = !t.enabled; });
            setCallMuted(m => !m);
        }
    }, []);

    // ── Signal Listener ──────────────────────────────────────────────────────

    useEffect(() => {
        const handler = (e: Event) => {
            const msg = (e as CustomEvent).detail;

            if (msg.type === 'call_accept_local') {
                const cType = msg.call_type || 'voice';
                const callerName = msg.caller_name || 'Unknown';
                window.dispatchEvent(new CustomEvent('eve-call-send', {
                    detail: {
                        type: 'call_accept', target_name: callerName,
                        caller_name: userName, caller_role: userRole, call_type: cType,
                    }
                }));
                (async () => {
                    try {
                        const constraints: MediaStreamConstraints = cType === 'video'
                            ? { audio: true, video: { width: 640, height: 480 } }
                            : { audio: true };
                        const stream = await navigator.mediaDevices.getUserMedia(constraints);
                        localStreamRef.current = stream;

                        // Attach local video preview
                        if (cType === 'video' && localVideoRef.current) {
                            localVideoRef.current.srcObject = stream;
                        }

                        setCallTarget(callerName);
                        setCallType(cType);
                        setCallActive(true);
                        setCallDuration(0);
                        setCallMuted(false);
                        callTimerRef.current = window.setInterval(() => setCallDuration(d => d + 1), 1000);
                    } catch { /* permission denied */ }
                })();

            } else if (msg.type === 'call_end' || msg.type === 'call_reject') {
                cleanupWebRTC();
                localStreamRef.current?.getTracks().forEach(t => t.stop());
                localStreamRef.current = null;
                if (callTimerRef.current) clearInterval(callTimerRef.current);
                setCallActive(false);
                setCallTarget(null);
                setCallDuration(0);

            } else if (msg.type === 'call_accept') {
                // Clear unanswered call timeout — peer picked up
                if (callTimeoutRef.current) {
                    clearTimeout(callTimeoutRef.current);
                    callTimeoutRef.current = null;
                }
                console.log('[WebRTC] Call accepted by peer:', msg.caller_name);
                (async () => {
                    try {
                        const cType = callTypeRef.current;
                        const pc = createPeerConnection(msg.caller_name, cType);
                        const offer = await pc.createOffer();
                        await pc.setLocalDescription(offer);
                        sendWebRTC('webrtc_offer', msg.caller_name, {
                            sdp: offer.sdp, sdpType: offer.type, call_type: cType,
                        });
                    } catch (err) {
                        console.error('[WebRTC] Error creating offer:', err);
                    }
                })();

            } else if (msg.type === 'webrtc_offer') {
                (async () => {
                    try {
                        const cType = msg.call_type || 'voice';
                        const pc = createPeerConnection(msg.caller_name, cType);
                        await pc.setRemoteDescription(new RTCSessionDescription({ type: msg.sdpType || 'offer', sdp: msg.sdp }));
                        for (const ic of pendingIceCandidatesRef.current) {
                            await pc.addIceCandidate(new RTCIceCandidate(ic));
                        }
                        pendingIceCandidatesRef.current = [];
                        const answer = await pc.createAnswer();
                        await pc.setLocalDescription(answer);
                        sendWebRTC('webrtc_answer', msg.caller_name, { sdp: answer.sdp, sdpType: answer.type });
                    } catch (err) {
                        console.error('[WebRTC] Error handling offer:', err);
                    }
                })();

            } else if (msg.type === 'webrtc_answer') {
                (async () => {
                    try {
                        const pc = peerConnectionRef.current;
                        if (!pc) return;
                        await pc.setRemoteDescription(new RTCSessionDescription({ type: msg.sdpType || 'answer', sdp: msg.sdp }));
                        for (const ic of pendingIceCandidatesRef.current) {
                            await pc.addIceCandidate(new RTCIceCandidate(ic));
                        }
                        pendingIceCandidatesRef.current = [];
                    } catch (err) {
                        console.error('[WebRTC] Error handling answer:', err);
                    }
                })();

            } else if (msg.type === 'webrtc_ice') {
                (async () => {
                    try {
                        const pc = peerConnectionRef.current;
                        if (pc && pc.remoteDescription) {
                            await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
                        } else {
                            pendingIceCandidatesRef.current.push(msg.candidate);
                        }
                    } catch (err) {
                        console.error('[WebRTC] ICE candidate error:', err);
                    }
                })();
            }
        };
        window.addEventListener('eve-call-signal', handler);
        return () => window.removeEventListener('eve-call-signal', handler);
    }, [userName, userRole, cleanupWebRTC, createPeerConnection, sendWebRTC]);

    // ── Ref Callbacks ────────────────────────────────────────────────────────

    const videoRefCallback = useCallback((node: HTMLVideoElement | null) => {
        localVideoRef.current = node;
        if (node && localStreamRef.current) node.srcObject = localStreamRef.current;
    }, []);

    const remoteVideoRefCallback = useCallback((node: HTMLVideoElement | null) => {
        remoteVideoRef.current = node;
        if (node && remoteStreamRef.current) node.srcObject = remoteStreamRef.current;
    }, []);

    const fmtDuration = (s: number) => `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;

    return {
        callActive, callTarget, callType, callMuted, callDuration,
        startCall, endCall, toggleMute,
        videoRefCallback, remoteVideoRefCallback,
        fmtDuration,
    };
}
