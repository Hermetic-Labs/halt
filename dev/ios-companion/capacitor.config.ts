import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
    appId: 'com.hermeticlabs.halt.companion',
    appName: 'HALT',
    webDir: 'dist',

    // Bundle configuration
    bundledWebRuntime: false,

    // iOS-specific configuration
    ios: {
        // Team ID for signing (update with your Apple Developer Team ID)
        // developmentTeam: 'YOUR_TEAM_ID',

        // Scheme for URL handling
        scheme: 'halt',

        // Content inset adjustment
        contentInset: 'automatic',

        // Allow mixed content (for local development)
        allowsLinkPreview: true,

        // Scroll behavior
        scrollEnabled: true,

        // Background modes
        backgroundColor: '#0a0a0a',

        // Prefer native logging
        loggingBehavior: 'debug',
    },

    // Server configuration for development
    server: {
        // For development: point to your local HALT frontend
        // url: 'http://YOUR_MAC_IP:7778',

        // Allow navigation to HALT backend
        allowNavigation: [
            'localhost',
            '127.0.0.1',
            '*.hermeticlabs.com',
        ],

        // Clear text traffic for local development
        cleartext: true,
    },

    // Plugins configuration
    plugins: {
        // Push Notifications
        PushNotifications: {
            presentationOptions: ['badge', 'sound', 'alert'],
        },

        // Local Notifications
        LocalNotifications: {
            smallIcon: 'ic_stat_icon_config_sample',
            iconColor: '#00FF88',
            sound: 'beep.wav',
        },

        // Keyboard behavior
        Keyboard: {
            resize: 'body',
            style: 'dark',
            resizeOnFullScreen: true,
        },

        // Status bar
        StatusBar: {
            style: 'dark',
            backgroundColor: '#0a0a0a',
        },
    },
};

export default config;
