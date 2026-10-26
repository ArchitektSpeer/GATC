// Minimal shadcn/ui-style primitives used by the workbench shell.
import { useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { X } from 'lucide-react';

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

type Variant = 'default' | 'primary' | 'ghost' | 'danger';

const variants: Record<Variant, string> = {
  default: 'border border-[var(--border)] bg-[var(--panel)] hover:bg-slate-100 dark:hover:bg-slate-800',
  primary: 'bg-blue-600 text-white hover:bg-blue-500 border border-blue-600',
  ghost: 'hover:bg-slate-100 dark:hover:bg-slate-800',
  danger: 'bg-red-600 text-white hover:bg-red-500',
};

export function Button({
  variant = 'default',
  size = 'md',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'icon' }) {
  const sizes = { sm: 'h-7 px-2 text-xs', md: 'h-8 px-3 text-[13px]', icon: 'h-8 w-8 justify-center' };
  return (
    <button
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'h-8 w-full rounded-md border border-[var(--border)] bg-[var(--panel)] px-2 text-[13px] outline-none focus:ring-2 focus:ring-blue-500/40',
        className,
      )}
      {...props}
    />
  );
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'h-8 rounded-md border border-[var(--border)] bg-[var(--panel)] px-2 text-[13px] outline-none focus:ring-2 focus:ring-blue-500/40',
        className,
      )}
      {...props}
    />
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-[var(--muted)]">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-[var(--muted)]">{hint}</span>}
    </label>
  );
}

export function Badge({ children, tone = 'slate' }: { children: ReactNode; tone?: 'slate' | 'green' | 'red' | 'amber' | 'blue' }) {
  const tones = {
    slate: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
    green: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
    red: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
    amber: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
    blue: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  };
  return <span className={cn('inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium', tones[tone])}>{children}</span>;
}

export function Dialog({
  open,
  onClose,
  title,
  children,
  width = 720,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[8vh]" onMouseDown={onClose}>
      <div
        className="flex max-h-[84vh] w-full flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)] shadow-2xl"
        style={{ maxWidth: width }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
          <div className="text-[15px] font-semibold">{title}</div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="关闭">
            <X size={16} />
          </Button>
        </div>
        <div className="overflow-auto p-4">{children}</div>
      </div>
    </div>
  );
}

export function Tabs<T extends string>({
  value,
  onChange,
  items,
}: {
  value: T;
  onChange: (v: T) => void;
  items: Array<{ value: T; label: ReactNode }>;
}) {
  return (
    <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5">
      {items.map((it) => (
        <button
          key={it.value}
          onClick={() => onChange(it.value)}
          className={cn(
            'rounded-md px-2.5 py-1 text-xs font-medium whitespace-nowrap',
            value === it.value ? 'bg-[var(--panel)] shadow-sm' : 'text-[var(--muted)] hover:text-[var(--text)]',
          )}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}
