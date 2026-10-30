import * as React from 'react';

import { cn } from '@/lib/utils';

function Card({ className, ...props }) {
  return <div className={cn('bg-card text-card-foreground rounded-xl border shadow-sm', className)} {...props} />;
}

function CardHeader({ className, ...props }) {
  return <div className={cn('flex flex-col space-y-1.5 p-6', className)} {...props} />;
}

function CardTitle({ className, ...props }) {
  return <div className={cn('font-semibold leading-none tracking-tight', className)} {...props} />;
}

function CardDescription({ className, ...props }) {
  return <div className={cn('text-muted-foreground text-sm', className)} {...props} />;
}

function CardContent({ className, ...props }) {
  return <div className={cn('p-6 pt-0', className)} {...props} />;
}

function CardFooter({ className, ...props }) {
  return <div className={cn('flex items-center p-6 pt-0', className)} {...props} />;
}

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter };
