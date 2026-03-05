const pbthTailwindConfig = {
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      colors: {
        pb: {
          primary: '#00E676',
          secondary: '#39FF14',
          background: '#0F0F0F',
          surface: '#1E1E2E',
          warning: '#FF6D00',
          highlight: '#FFEA00',
          danger: '#FF1744',
          text: '#FFFFFF',
          subtext: '#A0A0B0'
        }
      },
      backgroundImage: {
        splatter:
          'radial-gradient(circle at 10% 10%, rgba(0,230,118,0.12), transparent 35%), radial-gradient(circle at 90% 20%, rgba(57,255,20,0.08), transparent 30%), radial-gradient(circle at 80% 80%, rgba(0,230,118,0.07), transparent 35%)',
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 180ms ease-out',
      },
    }
  }
};

if (typeof globalThis !== 'undefined') {
  globalThis.tailwind = globalThis.tailwind || {};
  globalThis.tailwind.config = pbthTailwindConfig;
}

if (typeof window !== 'undefined') {
  window.tailwind = window.tailwind || {};
  window.tailwind.config = pbthTailwindConfig;
}

if (typeof tailwind !== 'undefined') {
  tailwind.config = pbthTailwindConfig;
}
