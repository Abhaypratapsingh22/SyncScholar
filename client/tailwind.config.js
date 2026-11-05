/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f0f7ff',
          100: '#e0effe',
          200: '#bae0fd',
          300: '#7cc5fa',
          400: '#38a6f6',
          500: '#0e87e9',
          600: '#026bc7',
          700: '#0355a1',
          800: '#074884',
          900: '#0c3d6e',
          950: '#082749',
        },
        classroom: {
          surface: '#ffffff',
          board: '#0f172a',
          ink: '#090d16',
          chalk: '#f8fafc',
          accent: '#1e3a8a',
          amber: '#d97706',
          emerald: '#059669',
          crimson: '#dc2626',
        },
      },
      minHeight: {
        'touch': '44px',
      },
      minWidth: {
        'touch': '44px',
      },
      fontFamily: {
        sans: [
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Roboto',
          '"Helvetica Neue"',
          'Arial',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
};
