/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  // O app tem CSS base próprio (styles.css); o preflight do Tailwind o sobrescreveria.
  // Sem preflight, bordas precisam de "border-solid" junto com "border".
  corePlugins: { preflight: false },
  theme: {
    extend: {
      // Todas as cores vêm das variáveis CSS de :root (styles.css): trocar o tema = trocar as variáveis.
      colors: {
        rd: {
          rail: 'var(--bg-0)',
          chat: 'var(--bg-0)',
          sidebar: 'var(--bg-1)',
          input: 'var(--bg-2)',
          hover: 'var(--bg-2)',
          text: 'var(--text)',
          strong: 'var(--text-strong)',
          muted: 'var(--text-dim)',
          accent: 'var(--brass)',
          line: 'var(--brass-dim)',
          danger: 'var(--blood)',
          rust: 'var(--rust)',
        },
      },
    },
  },
};
