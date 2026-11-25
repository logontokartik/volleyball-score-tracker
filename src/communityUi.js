// Shared visual language for the New England community surfaces (Play / Players / Me).
// Kept as class strings so pages stay consistent without a heavy component library.

export const pageShell =
  'relative min-h-[calc(100vh-var(--site-header-h))] overflow-hidden bg-slate-950 text-slate-100';

export const pageGlow =
  'pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(245,158,11,0.12),_transparent_55%),radial-gradient(ellipse_at_bottom_right,_rgba(14,165,233,0.10),_transparent_50%)]';

export const pageInner = 'relative z-10 max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-12';

export const heroTitle =
  'font-display text-3xl sm:text-5xl font-bold tracking-tight text-white animate-fade-up';

export const heroSub =
  'mt-3 max-w-2xl text-base sm:text-lg text-slate-300/90 leading-relaxed animate-fade-up-delay';

export const cardClass =
  'rounded-2xl border border-slate-700/60 bg-slate-900/60 backdrop-blur-sm p-4 sm:p-5 shadow-lg shadow-black/20 transition-all duration-300 hover:border-amber-500/40 hover:bg-slate-900/80 hover:-translate-y-0.5';

export const cardQuiet =
  'rounded-2xl border border-slate-700/50 bg-slate-900/50 backdrop-blur-sm p-4 sm:p-5';

export const primaryButtonClass =
  'inline-flex items-center justify-center gap-2 min-h-[48px] px-5 rounded-xl bg-amber-500 text-slate-900 font-bold hover:bg-amber-400 active:scale-[0.98] transition-all disabled:opacity-50 disabled:pointer-events-none';

export const secondaryButtonClass =
  'inline-flex items-center justify-center gap-2 min-h-[44px] px-4 rounded-xl border border-slate-600 bg-slate-800/80 text-white font-semibold hover:bg-slate-700 active:scale-[0.98] transition-all disabled:opacity-50';

export const ghostButtonClass =
  'inline-flex items-center justify-center gap-2 min-h-[44px] px-3 rounded-xl text-slate-300 font-semibold hover:text-white hover:bg-white/5 transition-colors';

export const inputClass =
  'w-full min-h-[48px] rounded-xl border border-slate-600/80 bg-slate-950/70 px-4 text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-400/60 focus:border-amber-400/40 transition';

export const labelClass = 'block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5';

export const chipClass =
  'inline-flex items-center gap-1 rounded-lg border border-slate-600/70 bg-slate-800/60 px-2.5 py-1 text-xs font-semibold text-slate-200';

export const chipActiveClass =
  'inline-flex items-center gap-1 rounded-lg border border-amber-400/50 bg-amber-400/15 px-2.5 py-1 text-xs font-semibold text-amber-200';

export const sectionLabel =
  'text-xs font-bold uppercase tracking-[0.14em] text-amber-400/90';
