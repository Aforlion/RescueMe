/**
 * RescueMe Design Tokens
 * 
 * Shared constants for colors, spacing, and typography.
 * Used across Web (Tailwind) and Mobile (StyleSheet).
 */

export const tokens = {
    colors: {
        primary: '#ff4d4f', // Rescue Red
        secondary: '#1890ff', // Info Blue
        success: '#52c41a',
        warning: '#faad14',
        error: '#f5222d',
        background: '#ffffff',
        surface: '#f5f5f5',
        text: {
            primary: '#141414',
            secondary: '#8c8c8c',
            inverse: '#ffffff',
        },
        zinc: {
            950: '#09090b',
            900: '#18181b',
            800: '#27272a',
            500: '#71717a',
        }
    },
    spacing: {
        xs: 4,
        sm: 8,
        md: 16,
        lg: 24,
        xl: 32,
        xxl: 48,
    },
    borderRadius: {
        sm: 4,
        md: 8,
        lg: 12,
        full: 9999,
    }
};
