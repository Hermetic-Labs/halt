import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';

// ── Battery-Save / Low Power Context ────────────────────────────────
// When battery < 20% or manually toggled:
//   - Disable CSS animations
//   - Reduce network polling intervals
//   - Show amber LOW POWER indicator

interface PowerState {
    lowPower: boolean;
    batteryLevel: number | null;  // 0-1 or null if unsupported
    charging: boolean | null;
    toggleLowPower: () => void;
}

const PowerCtx = createContext<PowerState>({
    lowPower: false,
    batteryLevel: null,
    charging: null,
    toggleLowPower: () => { },
});

// eslint-disable-next-line react-refresh/only-export-components
export function usePower() {
    return useContext(PowerCtx);
}

export function PowerProvider({ children }: { children: ReactNode }) {
    const [lowPower, setLowPower] = useState(false);
    const [batteryLevel, setBatteryLevel] = useState<number | null>(null);
    const [charging, setCharging] = useState<boolean | null>(null);

    // Battery API
    useEffect(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let battery: any = null;
        const update = () => {
            if (!battery) return;
            setBatteryLevel(battery.level);
            setCharging(battery.charging);
            // Auto-enable low power when battery drops below 20% and not charging
            if (battery.level < 0.2 && !battery.charging) {
                setLowPower(true);
            }
        };

        if ('getBattery' in navigator) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (navigator as any).getBattery().then((b: any) => {
                battery = b;
                update();
                b.addEventListener('levelchange', update);
                b.addEventListener('chargingchange', update);
            }).catch(() => { });
        }

        return () => {
            if (battery) {
                battery.removeEventListener('levelchange', update);
                battery.removeEventListener('chargingchange', update);
            }
        };
    }, []);

    // Inject CSS to kill animations in low power mode
    useEffect(() => {
        const id = 'eve-low-power-style';
        let el = document.getElementById(id);
        if (lowPower) {
            if (!el) {
                el = document.createElement('style');
                el.id = id;
                document.head.appendChild(el);
            }
            el.textContent = `
                *, *::before, *::after {
                    animation-duration: 0s !important;
                    animation-delay: 0s !important;
                    transition-duration: 0s !important;
                    transition-delay: 0s !important;
                }
            `;
        } else {
            el?.remove();
        }
        return () => { document.getElementById(id)?.remove(); };
    }, [lowPower]);

    const toggleLowPower = useCallback(() => {
        setLowPower(prev => !prev);
    }, []);

    return (
        <PowerCtx.Provider value={{ lowPower, batteryLevel, charging, toggleLowPower }}>
            {children}
        </PowerCtx.Provider>
    );
}
