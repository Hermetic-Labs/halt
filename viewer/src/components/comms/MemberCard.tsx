/**
 * MemberCard — unified roster/callable member card used in both voice and video tabs.
 * Shows avatar, name, role, and call/end button.
 */
import type { RosterMember, CallType } from '../../types/comms';
import { ROLE_COLORS } from '../../types/comms';
import { useT } from '../../services/i18n';

interface Props {
    member: RosterMember;
    callActive: boolean;
    callTarget: string | null;
    callDuration: number;
    callColor: string;
    fmtDuration: (s: number) => string;
    onCall: (member: RosterMember, type: CallType) => void;
    onEndCall: () => void;
    callKind: CallType;
}

export default function MemberCard({ member, callActive, callTarget, callDuration, callColor, fmtDuration, onCall, onEndCall, callKind }: Props) {
    const { t } = useT();
    const isActiveTarget = callActive && callTarget === member.name;
    const roleColor = ROLE_COLORS[member.role] || '#888';

    return (
        <div style={{
            display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
            background: isActiveTarget ? (callKind === 'video' ? '#1a2a3a' : '#0d2116') : 'var(--surface)',
            borderRadius: 8, border: `1px solid ${isActiveTarget ? callColor : 'var(--border)'}`,
        }}>
            <div style={{
                width: 36, height: 36, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: `${roleColor}22`, color: roleColor, fontSize: 14, fontWeight: 700,
            }}>
                {member.name.charAt(0).toUpperCase()}
            </div>
            <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{member.name}</div>
                <div style={{ fontSize: 11, color: roleColor }}>{member.role}</div>
            </div>
            {isActiveTarget ? (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <span style={{ fontSize: 11, color: callColor, fontFamily: 'var(--font-mono)' }}>{fmtDuration(callDuration)}</span>
                    <button onClick={onEndCall} style={{
                        padding: '6px 14px', background: '#e74c3c', border: 'none', borderRadius: 6,
                        color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                    }}>{t('comms.end')}</button>
                </div>
            ) : (
                <button
                    onClick={() => onCall(member, callKind)}
                    disabled={callActive}
                    style={{
                        padding: '6px 14px', background: callActive ? '#333' : `${callColor}22`,
                        border: `1px solid ${callActive ? '#555' : `${callColor}44`}`, borderRadius: 6,
                        color: callActive ? '#666' : callColor, fontSize: 12, fontWeight: 600,
                        cursor: callActive ? 'not-allowed' : 'pointer',
                    }}
                >
                    {callKind === 'video' ? '📹' : '📞'} {callKind === 'video' ? t('comms.video') : t('comms.call')}
                </button>
            )}
        </div>
    );
}
