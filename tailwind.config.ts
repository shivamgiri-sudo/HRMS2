import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
  	container: {
  		center: true,
  		padding: '2rem',
  		screens: {
  			'2xl': '1400px'
  		}
  	},
  	extend: {
  		colors: {
  			border: 'hsl(var(--border))',
  			input: 'hsl(var(--input))',
  			ring: 'hsl(var(--ring))',
  			background: 'hsl(var(--background))',
  			foreground: 'hsl(var(--foreground))',
  			primary: {
  				DEFAULT: 'hsl(var(--primary))',
  				foreground: 'hsl(var(--primary-foreground))'
  			},
  			secondary: {
  				DEFAULT: 'hsl(var(--secondary))',
  				foreground: 'hsl(var(--secondary-foreground))'
  			},
  			destructive: {
  				DEFAULT: 'hsl(var(--destructive))',
  				foreground: 'hsl(var(--destructive-foreground))'
  			},
  			muted: {
  				DEFAULT: 'hsl(var(--muted))',
  				foreground: 'hsl(var(--muted-foreground))'
  			},
  			accent: {
  				DEFAULT: 'hsl(var(--accent))',
  				foreground: 'hsl(var(--accent-foreground))'
  			},
  			popover: {
  				DEFAULT: 'hsl(var(--popover))',
  				foreground: 'hsl(var(--popover-foreground))'
  			},
  			card: {
  				DEFAULT: 'hsl(var(--card))',
  				foreground: 'hsl(var(--card-foreground))'
  			},
  			sidebar: {
  				DEFAULT: 'hsl(var(--sidebar-background))',
  				foreground: 'hsl(var(--sidebar-foreground))',
  				primary: 'hsl(var(--sidebar-primary))',
  				'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
  				accent: 'hsl(var(--sidebar-accent))',
  				'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
  				border: 'hsl(var(--sidebar-border))',
  				ring: 'hsl(var(--sidebar-ring))'
  			},
  			/* GRN Management (/finance/grn) only. Backed by the CSS variables in
  			 * src/styles/grn.css, which are scoped to `.grn-scope` — these utilities
  			 * resolve to nothing outside that wrapper, which is intentional. Channel
  			 * triplets so `/15`-style opacity modifiers keep working. */
  			grn: {
  				ink: 'rgb(var(--grn-ink) / <alpha-value>)',
  				'ink-soft': 'rgb(var(--grn-ink-soft) / <alpha-value>)',
  				paper: 'rgb(var(--grn-paper) / <alpha-value>)',
  				card: 'rgb(var(--grn-card) / <alpha-value>)',
  				line: 'rgb(var(--grn-line) / <alpha-value>)',
  				'line-soft': 'rgb(var(--grn-line-soft) / <alpha-value>)',
  				brand: 'rgb(var(--grn-brand) / <alpha-value>)',
  				'brand-ink': 'rgb(var(--grn-brand-ink) / <alpha-value>)',
  				'brand-soft': 'rgb(var(--grn-brand-soft) / <alpha-value>)',
  				'brand-soft2': 'rgb(var(--grn-brand-soft2) / <alpha-value>)',
  				ok: 'rgb(var(--grn-ok) / <alpha-value>)',
  				'ok-bg': 'rgb(var(--grn-ok-bg) / <alpha-value>)',
  				'ok-line': 'rgb(var(--grn-ok-line) / <alpha-value>)',
  				warn: 'rgb(var(--grn-warn) / <alpha-value>)',
  				'warn-bg': 'rgb(var(--grn-warn-bg) / <alpha-value>)',
  				'warn-line': 'rgb(var(--grn-warn-line) / <alpha-value>)',
  				crit: 'rgb(var(--grn-crit) / <alpha-value>)',
  				'crit-bg': 'rgb(var(--grn-crit-bg) / <alpha-value>)',
  				'crit-line': 'rgb(var(--grn-crit-line) / <alpha-value>)',
  				info: 'rgb(var(--grn-info) / <alpha-value>)',
  				'info-bg': 'rgb(var(--grn-info-bg) / <alpha-value>)',
  				'info-line': 'rgb(var(--grn-info-line) / <alpha-value>)'
  			}
  		},
  		borderRadius: {
  			lg: 'var(--radius)',
  			md: 'calc(var(--radius) - 2px)',
  			sm: 'calc(var(--radius) - 4px)'
  		},
  		keyframes: {
  			'accordion-down': {
  				from: {
  					height: '0'
  				},
  				to: {
  					height: 'var(--radix-accordion-content-height)'
  				}
  			},
  			'accordion-up': {
  				from: {
  					height: 'var(--radix-accordion-content-height)'
  				},
  				to: {
  					height: '0'
  				}
  			}
  		},
  		animation: {
  			'accordion-down': 'accordion-down 0.2s ease-out',
  			'accordion-up': 'accordion-up 0.2s ease-out'
  		},
  		boxShadow: {
  			'2xs': 'var(--shadow-2xs)',
  			xs: 'var(--shadow-xs)',
  			sm: 'var(--shadow-sm)',
  			md: 'var(--shadow-md)',
  			lg: 'var(--shadow-lg)',
  			xl: 'var(--shadow-xl)',
  			'2xl': 'var(--shadow-2xl)'
  		},
  		fontFamily: {
  			sans: [
  				'Inter',
  				'ui-sans-serif',
  				'system-ui',
  				'-apple-system',
  				'BlinkMacSystemFont',
  				'Segoe UI',
  				'Roboto',
  				'Helvetica Neue',
  				'Arial',
  				'Noto Sans',
  				'sans-serif'
  			],
  			serif: [
  				'Lora',
  				'ui-serif',
  				'Georgia',
  				'Cambria',
  				'Times New Roman',
  				'Times',
  				'serif'
  			],
  			/* GRN Management only. `mono` below resolves to Space Mono, which is
  			 * loaded nowhere in this app, so `font-mono` silently falls through to
  			 * ui-monospace. IBM Plex Mono IS loaded (index.html) — this gives the GRN
  			 * page its numerals without changing `font-mono` for every other page. */
  			'grn-mono': [
  				'IBM Plex Mono',
  				'ui-monospace',
  				'SFMono-Regular',
  				'Menlo',
  				'Consolas',
  				'monospace'
  			],
  			mono: [
  				'Space Mono',
  				'ui-monospace',
  				'SFMono-Regular',
  				'Menlo',
  				'Monaco',
  				'Consolas',
  				'Liberation Mono',
  				'Courier New',
  				'monospace'
  			]
  		}
  	}
  },
  plugins: [tailwindcssAnimate],
} satisfies Config;
