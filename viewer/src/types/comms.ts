/**
 * Shared types for the Communications system.
 * Used by CommsPanel, NetworkTab, and extracted hooks/components.
 */

export interface ChatMsg {
    id: string;
    sender_name: string;
    sender_role: string;
    message: string;
    target_name: string;
    timestamp: string;
    reply_to?: string;
    reactions?: Record<string, string[]>;
    translations?: Record<string, string>;
    attachment_url?: string;
    attachment_name?: string;
}

export interface RosterMember {
    id: string;
    name: string;
    role: string;
    status: string;
    avatar_url?: string;
}

export type CallType = 'voice' | 'video';
export type SubTab = 'messages' | 'voice' | 'video';

export const API_BASE = '';
export const POLL_INTERVAL = 2000;

export const ROLE_COLORS: Record<string, string> = {
    leader: '#e74c3c',
    medic: '#3498db',
    doctor: '#9b59b6',
    responder: '#3fb950',
};
