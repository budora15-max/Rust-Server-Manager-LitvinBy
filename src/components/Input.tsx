import { forwardRef, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/utils';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  icon?: ReactNode;
  togglePassword?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, hint, icon, togglePassword, type = 'text', className, id, ...props }, ref) => {
    const [show, setShow] = useState(false);
    const inputId = id || (label ? `field-${label.replace(/\s+/g, '-').toLowerCase()}` : undefined);
    const isPassword = togglePassword || type === 'password';
    const resolvedType = isPassword && show ? 'text' : type;

    return (
      <div className={cn('w-full', className)}>
        {label && (
          <label htmlFor={inputId} className="mb-1.5 block text-sm font-medium text-textMain">
            {label}
          </label>
        )}
        <div className="relative">
          {icon && (
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-textMuted">
              {icon}
            </span>
          )}
          <input
            ref={ref}
            id={inputId}
            type={resolvedType}
            className={cn(
              'h-11 w-full rounded-lg border bg-[#1a1e26] px-3 text-sm text-textMain transition-colors',
              'placeholder:text-textMuted/60 focus:outline-none focus:ring-2',
              icon ? 'pl-10' : '',
              isPassword ? 'pr-10' : '',
              error
                ? 'border-red-500/50 focus:border-red-500 focus:ring-red-500/20'
                : 'border-[#2a2f3a] hover:border-[#3a4150] focus:border-accent focus:ring-accent/25'
            )}
            {...props}
          />
          {isPassword && togglePassword && (
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-textMuted transition-colors hover:text-textMain"
              tabIndex={-1}
              aria-label={show ? 'Hide password' : 'Show password'}
            >
              {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          )}
        </div>
        {error && <p className="mt-1.5 text-xs text-red-400">{error}</p>}
        {hint && !error && <p className="mt-1.5 text-xs text-textMuted">{hint}</p>}
      </div>
    );
  }
);
Input.displayName = 'Input';
