import * as React from 'react';

import { cn } from '@/lib/utils';

function Input({ className, type, ...props }) {
  return (
    <input
      type={type}
      className={cn(
        'border-input bg-transparent shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring flex h-9 w-full rounded-md border px-3 py-1 text-sm',
        className,
      )}
      {...props}
    />
  );
}

export { Input };
