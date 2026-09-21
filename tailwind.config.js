import defaultTheme from 'tailwindcss/defaultTheme';
import forms from '@tailwindcss/forms';

/** @type {import('tailwindcss').Config} */
export default {
    content: [
        './vendor/laravel/framework/src/Illuminate/Pagination/resources/views/*.blade.php',
        './storage/framework/views/*.php',
        './resources/views/**/*.blade.php',
    ],

    theme: {
        extend: {
            fontFamily: {
                sans: ['Figtree', ...defaultTheme.fontFamily.sans],
                poppins: ['Poppins', 'sans-serif'],
            },
            colors: {
                brand: {
                    primary: '#059669',
                    accent: '#F59E0B',
                },
                tourism: {
                    primary: '#2E8B57',
                    accent: '#3CB371',
                },
                sunny: {
                    yellow: '#FACC15',
                    light: '#FEF9C3',
                },
                nature: {
                    DEFAULT: '#22C55E',
                    dark: '#16A34A',
                    light: '#DCFCE7',
                    bg: '#F0FDF4',
                },
                cream: {
                    DEFAULT: '#FFFDF5',
                    dark: '#F5F0E8',
                },
            },
            keyframes: {
                'fade-in': {
                    '0%': { opacity: '0' },
                    '100%': { opacity: '1' },
                },
                'slide-up': {
                    '0%': { opacity: '0', transform: 'translateY(30px)' },
                    '100%': { opacity: '1', transform: 'translateY(0)' },
                },
                'ken-burns': {
                    '0%': { transform: 'scale(1)' },
                    '100%': { transform: 'scale(1.03)' },
                },
                'float': {
                    '0%, 100%': { transform: 'translateY(0)' },
                    '50%': { transform: 'translateY(-6px)' },
                },
                'fade-in-up': {
                    '0%': { opacity: '0', transform: 'translateY(20px)' },
                    '100%': { opacity: '1', transform: 'translateY(0)' },
                },
                'scale-in': {
                    '0%': { transform: 'scale(0.95)', opacity: '0' },
                    '100%': { transform: 'scale(1)', opacity: '1' },
                },
                'glow': {
                    '0%, 100%': { boxShadow: '0 0 0 0 rgba(22, 163, 74, 0.4)' },
                    '50%': { boxShadow: '0 0 0 8px rgba(22, 163, 74, 0)' },
                },
                'shimmer': {
                    '0%': { backgroundPosition: '-200% 0' },
                    '100%': { backgroundPosition: '200% 0' },
                },
                'card-lift': {
                    '0%, 100%': { transform: 'translateY(0)' },
                    '50%': { transform: 'translateY(-4px)' },
                },
            },
            animation: {
                'fade-in': 'fade-in 0.6s ease-out forwards',
                'slide-up': 'slide-up 0.5s ease-out forwards',
                'ken-burns': 'ken-burns 40s linear infinite alternate',
                'float': 'float 3s ease-in-out infinite',
                'fade-in-up': 'fade-in-up 0.5s ease-out forwards',
                'scale-in': 'scale-in 0.3s ease-out forwards',
                'glow': 'glow 2s ease-in-out infinite',
                'shimmer': 'shimmer 3s linear infinite',
                'card-lift': 'card-lift 3s ease-in-out infinite',
            },
            backdropBlur: {
                '18': '18px',
            },
        },
    },

    plugins: [forms],
};
