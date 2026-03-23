import { ReactNode } from 'react';

// --- Card ---
export function Card({ 
  children, 
  className = '', 
  hover = true,
  onClick 
}: { 
  children: ReactNode, 
  className?: string, 
  hover?: boolean,
  onClick?: () => void 
}) {
  return (
    <div 
      onClick={onClick}
      className={`rounded-[28px] border border-slate-200 bg-white p-5 shadow-soft transition-all 
        ${hover ? 'hover:border-primary-200 hover:shadow-md' : ''} 
        ${onClick ? 'cursor-pointer active:scale-[0.98]' : ''} 
        ${className}`}
    >
      {children}
    </div>
  );
}

// --- Button ---
export function Button({ 
  children, 
  onClick, 
  variant = 'primary', 
  className = '',
  icon: Icon
}: { 
  children: ReactNode, 
  onClick?: () => void, 
  variant?: 'primary' | 'secondary' | 'ghost' | 'outline',
  className?: string,
  icon?: any
}) {
  const variants = {
    primary: 'bg-primary-600 text-white hover:bg-primary-700',
    secondary: 'bg-slate-100 text-slate-900 hover:bg-slate-200',
    outline: 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
    ghost: 'text-slate-600 hover:bg-slate-100',
  };

  return (
    <button 
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition active:scale-95 ${variants[variant]} ${className}`}
    >
      {Icon && <Icon className="h-4 w-4" />}
      {children}
    </button>
  );
}

// --- Badge ---
export function Badge({ children, status = 'default', className = '' }: { children: ReactNode, status?: 'default' | 'success' | 'warning' | 'error' | 'info', className?: string }) {
  const colors = {
    default: 'bg-slate-100 text-slate-600',
    success: 'bg-emerald-50 text-emerald-700',
    warning: 'bg-amber-50 text-amber-700',
    error: 'bg-rose-50 text-rose-700',
    info: 'bg-blue-50 text-blue-700',
  };

  return (
    <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-widest ${colors[status]} ${className}`}>
      {children}
    </span>
  );
}
